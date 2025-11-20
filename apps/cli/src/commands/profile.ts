import type { Command } from 'commander'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { stdin as input, stdout as output } from 'node:process'
import { input as promptInput, select as promptSelect } from '@inquirer/prompts'
import { loadConfig } from 'c12'
import { getGlobalConfigPath } from '../bootstrap.js'
import { logger } from '../logger.js'

interface ProfilesConfig {
  defaultProfile?: string
  baseUrl?: string
  token?: string
  profiles?: Record<string, {
    baseUrl?: string
    token?: string
    projectId?: string
    projectPath?: string
  }>
}

async function fileExists(p: string) {
  try {
    await stat(p)
    return true
  }
  catch {
    return false
  }
}

async function readGlobalConfig(): Promise<ProfilesConfig> {
  const { file, dir } = getGlobalConfigPath()
  if (!(await fileExists(dir))) {
    return {}
  }
  if (!(await fileExists(file))) {
    return {}
  }
  const raw = await readFile(file, 'utf8').catch(() => '{}')
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  }
  catch {
    return {}
  }
}

async function writeGlobalConfig(config: ProfilesConfig) {
  const { file, dir } = getGlobalConfigPath()
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return file
}

function trimBaseUrl(url: string) {
  const trimmed = url.trim()
  return trimmed.replace(/\/+$/, '') || trimmed
}

async function promptBaseUrl(message: string, defaultValue: string) {
  const answer = await promptInput({
    message,
    default: defaultValue,
  })
  return trimBaseUrl(answer || defaultValue)
}

const NONE_VALUE = '__PROFILE_NONE__'

async function selectFromList(title: string, items: string[], allowNone = false) {
  if (items.length === 0) {
    return undefined
  }
  const choices = items.map(name => ({ name, value: name }))
  if (allowNone) {
    choices.unshift({ name: '(none)', value: NONE_VALUE })
  }
  const value = await promptSelect({
    message: title,
    choices,
    loop: false,
    pageSize: Math.max(choices.length, 6),
  })
  if (allowNone && value === NONE_VALUE) {
    return undefined
  }
  return value as string
}

export function registerProfileCommand(program: Command) {
  const profileCmd = program.command('profile')
    .description('Manage profiles and base URL')

  profileCmd
    .command('list')
    .description('List configured profiles and current defaults')
    .action(async () => {
      const { config } = await loadConfig<ProfilesConfig>({
        name: 'gitlab-cli',
        globalRc: true,
        dotenv: false,
      })
      const c = config || {}
      const names = Object.keys(c.profiles || {})
      logger.info(`Profiles: ${names.length > 0 ? names.join(', ') : '(none found)'}`)
      logger.info(`Default profile: ${c.defaultProfile ?? '(none)'}`)
      logger.info(`Global base URL: ${c.baseUrl ?? '(not set, defaults to https://gitlab.com)'}`)
    })

  profileCmd
    .command('use')
    .description('Interactively select a default profile and base URL')
    .option('--profile <name>', 'Profile to set as default (skips selection)')
    .option('--base-url <url>', 'Base URL to use globally (skips selection)')
    .action(async (opts: { profile?: string, baseUrl?: string }) => {
      const { config } = await loadConfig<ProfilesConfig>({
        name: 'gitlab-cli',
        globalRc: true,
        dotenv: false,
      })
      const merged = config || {}
      const globalCfg = await readGlobalConfig()
      const current = { ...merged, ...globalCfg }
      const names = Object.keys(current.profiles || {})

      let selectedProfile: string | undefined = opts.profile
      if (!selectedProfile && names.length > 0 && input.isTTY) {
        selectedProfile = await selectFromList('Select a profile (or 0 for none):', names, true)
      }
      else if (!selectedProfile && names.length === 0) {
        logger.info('No profiles defined. Will use no default profile.')
      }

      let baseUrl = opts.baseUrl
      if (!baseUrl && input.isTTY) {
        const candidates = new Set<string>()
        const defaultBase = current.baseUrl || 'https://gitlab.com'
        candidates.add(defaultBase)
        if (selectedProfile && current.profiles?.[selectedProfile]?.baseUrl) {
          candidates.add(current.profiles[selectedProfile].baseUrl as string)
        }
        const unique = Array.from(candidates).map(trimBaseUrl).filter(Boolean)
        if (unique.length > 0) {
          output.write('Known base URLs:\n')
          unique.forEach((u, i) => output.write(`  ${i + 1}. ${u}\n`))
        }
        baseUrl = await promptBaseUrl(`Base URL`, defaultBase)
      }
      baseUrl = trimBaseUrl(baseUrl || current.baseUrl || 'https://gitlab.com')

      // Persist to global config.json
      const writable = await readGlobalConfig()
      if (selectedProfile) {
        writable.defaultProfile = selectedProfile
      }
      else {
        delete writable.defaultProfile
      }
      writable.baseUrl = baseUrl
      const file = await writeGlobalConfig(writable)
      logger.success(`Updated global config: ${file}`)
      logger.info(`Default profile: ${selectedProfile ?? '(none)'}`)
      logger.info(`Global base URL: ${baseUrl}`)
    })

  profileCmd
    .command('set-base-url')
    .description('Set base URL globally or for a specific profile')
    .option('--profile <name>', 'Profile name to update (omit to update global)')
    .option('--url <url>', 'Base URL to set')
    .action(async (opts: { profile?: string, url?: string }) => {
      const { config } = await loadConfig<ProfilesConfig>({
        name: 'gitlab-cli',
        globalRc: true,
        dotenv: false,
      })
      const merged = config || {}
      const names = Object.keys(merged.profiles || {})

      let targetProfile = opts.profile
      if (!targetProfile && names.length > 0 && input.isTTY) {
        targetProfile = await selectFromList('Select a profile (or 0 for global):', names, true)
      }

      let url = opts.url
      if (!url && input.isTTY) {
        const defaultUrl = targetProfile
          ? (merged.profiles?.[targetProfile]?.baseUrl || merged.baseUrl || 'https://gitlab.com')
          : (merged.baseUrl || 'https://gitlab.com')
        url = await promptBaseUrl('Base URL', defaultUrl)
      }
      if (!url) {
        throw new Error('Missing --url and not in interactive mode.')
      }
      url = trimBaseUrl(url)

      const writable = await readGlobalConfig()
      if (targetProfile) {
        if (!writable.profiles) {
          writable.profiles = {}
        }
        writable.profiles[targetProfile] = {
          ...(writable.profiles[targetProfile] || {}),
          baseUrl: url,
        }
        logger.success(`Set base URL for profile "${targetProfile}" -> ${url}`)
      }
      else {
        writable.baseUrl = url
        logger.success(`Set global base URL -> ${url}`)
      }
      const file = await writeGlobalConfig(writable)
      logger.info(`Updated global config: ${file}`)
    })

  return profileCmd
}
