import type { ProfileSummary } from '../profile-store.js'
import { Gitlab } from '@gitbeaker/rest'
import { input as promptInput, select as promptSelect } from '@inquirer/prompts'
import pc from 'picocolors'
import { logger } from '../logger.js'
import {
  deleteProfile,
  listProfiles,
  loadProfileStore,

  saveProfileStore,
  setDefaultProfile,
  upsertProfile,
} from '../profile-store.js'
import { promptYesNo, runPromptWithEsc, selectFromPagedList } from './prompt-helpers.js'

function slugifyProfileName(source: string) {
  return source.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile'
}

async function promptText(message: string, defaultValue = '', required = false) {
  const result = await runPromptWithEsc(promptInput, {
    message,
    default: defaultValue,
    validate: (value: string) => {
      if (!required) {
        return true
      }
      return value.trim().length > 0 ? true : 'This field is required.'
    },
  })

  if (result.cancelled) {
    return undefined
  }
  return (result.value ?? '').trim()
}

async function fetchGitlabUser(baseUrl: string, token: string) {
  const client = new Gitlab({ host: baseUrl, token })
  const usersApi = client.Users as any
  if (usersApi && typeof usersApi.showCurrent === 'function') {
    return await usersApi.showCurrent()
  }
  const response = await client.requester.get('user')
  return (response as any)?.body ?? response
}

function formatProfileSummary(summary: ProfileSummary, activeProfile?: string) {
  const display = summary.profile.displayName
    ?? summary.profile.username
    ?? summary.profile.email
    ?? summary.name
  const base = summary.profile.baseUrl ?? 'https://gitlab.com'
  const markers = [
    summary.isDefault ? pc.green('default') : undefined,
    summary.name === activeProfile ? pc.cyan('active') : undefined,
  ].filter(Boolean).join(', ')
  const markerText = markers ? ` ${pc.dim(`[${markers}]`)}` : ''
  return `${pc.bold(display)} ${pc.dim(`<${summary.profile.email ?? 'unknown'}>`)} @ ${base}${markerText}`
}

async function promptProfileSelection(profiles: ProfileSummary[], activeProfile?: string) {
  const selection = await selectFromPagedList(profiles, {
    title: 'Manage profiles',
    formatItem: item => formatProfileSummary(item, activeProfile),
  })
  return selection
}

export async function launchProfileManager(options: {
  activeProfile?: string
  onActiveProfileChange?: (name?: string) => void
}): Promise<boolean> {
  let activeProfile = options.activeProfile
  while (true) {
    const store = await loadProfileStore()
    const summaries = listProfiles(store)
    const hasProfiles = summaries.length > 0

    const menuChoices = [
      { name: `${pc.green('➕')} Add profile`, value: 'add' },
    ]
    if (hasProfiles) {
      menuChoices.push(
        { name: `${pc.cyan('🔀')} Switch active profile`, value: 'switch' },
        { name: `${pc.yellow('★')} Set default profile`, value: 'set-default' },
        { name: `${pc.red('🗑')} Remove profile`, value: 'remove' },
      )
    }
    menuChoices.push({ name: `${pc.dim('↩')} Back`, value: 'back' })

    const result = await runPromptWithEsc(promptSelect, {
      message: 'Profile manager',
      choices: menuChoices,
      default: hasProfiles ? 'switch' : 'add',
      loop: false,
    })

    if (result.cancelled || result.value === 'back') {
      return true
    }

    if (result.value === 'add') {
      const baseUrl = await promptText('GitLab Base URL', 'https://gitlab.com', true)
      if (!baseUrl) {
        continue
      }
      const token = await promptText('GitLab Personal Access Token', '', true)
      if (!token) {
        continue
      }
      try {
        const user = await fetchGitlabUser(baseUrl, token)
        const defaultName = slugifyProfileName(user.username ?? user.name ?? 'profile')
        const profileName = await promptText('Profile key', defaultName, true)
        if (!profileName) {
          continue
        }
        const displayName = `${user.name ?? user.username ?? profileName}${user.email ? ` <${user.email}>` : ''}`
        upsertProfile(store, profileName, {
          baseUrl,
          token,
          displayName,
          email: typeof user.email === 'string' ? user.email : undefined,
          username: user.username ?? undefined,
        })
        await saveProfileStore(store)
        logger.success(`Added profile ${profileName}.`)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to fetch GitLab user: ${message}`)
      }
      continue
    }

    if (!hasProfiles) {
      continue
    }

    if (result.value === 'switch') {
      const selected = await promptProfileSelection(summaries, activeProfile)
      if (!selected) {
        continue
      }
      activeProfile = selected.name
      options.onActiveProfileChange?.(activeProfile)
      logger.success(`Active profile set to ${selected.name}.`)
      continue
    }

    if (result.value === 'set-default') {
      const selected = await promptProfileSelection(summaries, activeProfile)
      if (!selected) {
        continue
      }
      setDefaultProfile(store, selected.name)
      await saveProfileStore(store)
      logger.success(`Default profile set to ${selected.name}.`)
      continue
    }

    if (result.value === 'remove') {
      const selected = await promptProfileSelection(summaries, activeProfile)
      if (!selected) {
        continue
      }
      const confirmed = await promptYesNo(`Remove profile ${selected.name}?`, false)
      if (!confirmed) {
        continue
      }
      deleteProfile(store, selected.name)
      await saveProfileStore(store)
      if (activeProfile === selected.name) {
        activeProfile = store.defaultProfile
        options.onActiveProfileChange?.(activeProfile)
      }
      logger.success(`Removed profile ${selected.name}.`)
      continue
    }
  }
}
