import { mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process, { stdin as input, stdout as output } from 'node:process'
import { input as promptInput } from '@inquirer/prompts'

interface ProfilesConfig {
  token?: string
  baseUrl?: string
  defaultProfile?: string
  profiles?: Record<string, unknown>
}

function isInteractive() {
  // Avoid prompting in CI or when stdin is not a TTY
  return Boolean(input.isTTY && !process.env.CI)
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

export function getGlobalConfigPath() {
  // Respect XDG_CONFIG_HOME when available, otherwise default to ~/.config.
  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(homedir(), '.config')
  const dir = path.join(configHome, 'gitlab-cli')
  const file = path.join(dir, 'config.json')
  return { dir, file }
}

async function readGlobalConfigOnly(): Promise<ProfilesConfig> {
  const { file } = getGlobalConfigPath()
  try {
    const content = await (await import('node:fs/promises')).readFile(file, 'utf8')
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed ? parsed : {}
  }
  catch {
    return {}
  }
}

export async function maybeBootstrapGlobalConfig() {
  // Check strictly the global config for a token. If not present, prompt.
  const globalOnly = await readGlobalConfigOnly()
  const hasTopLevelToken = Boolean(globalOnly && globalOnly.token)
  const hasProfiles = Boolean(globalOnly && globalOnly.profiles && Object.keys(globalOnly.profiles || {}).length > 0)

  // If some global/local config exists, skip bootstrap
  if (hasProfiles || hasTopLevelToken) {
    return
  }

  // If not interactive, skip silently (commands may still provide CLI args)
  if (!isInteractive()) {
    return
  }

  // Prompt user for minimal global defaults
  const defaultBase = 'https://gitlab.com'
  const baseUrlAnswer = await promptInput({
    message: 'GitLab Base URL',
    default: defaultBase,
  })
  const baseUrl = baseUrlAnswer.trim() || defaultBase
  const token = (await promptInput({
    message: 'GitLab Token (api scope)',
    validate: value => (value.trim().length > 0 ? true : 'Token is required'),
  })).trim()

  const { dir, file } = getGlobalConfigPath()
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true })
  }
  // Only write token + baseUrl; projectId/projectPath can be provided later.
  const payload = {
    token,
    baseUrl,
    profiles: {
      default: {
        token,
        baseUrl,
      },
    },
    defaultProfile: 'default',
  }
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  output.write(`[gitlab-cli] Global config saved to ${file}\n`)
}
