import type { FavoriteProjectRecord } from '../favorites.js'
import type { MergeRequestSummary } from '../shared.js'
import pc from 'picocolors'
import { favoriteKey } from '../favorites.js'

export interface InteractiveProjectChoice {
  projectRef: string
  label: string
  profileName?: string
  lastActivity?: string
  webUrl?: string
  isFavorite?: boolean
}

export interface ProjectOverrideOptions {
  projectId?: string
  projectPath?: string
  profile?: string
}

export type MergeRequestRecord = MergeRequestSummary & {
  merge_status?: string | null
  detailed_merge_status?: string | null
  work_in_progress?: boolean
  draft?: boolean
}

export function formatDate(value?: string) {
  if (!value) {
    return 'unknown'
  }
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    return value
  }
  return new Date(time).toISOString()
}

export function formatProjectLine(choice: InteractiveProjectChoice, index: number) {
  const profileTag = choice.profileName ? pc.magenta(`[${choice.profileName}]`) : pc.dim('[default]')
  const lastActive = pc.green(formatDate(choice.lastActivity))
  const web = choice.webUrl ? ` ${pc.dim('|')} ${pc.blue(choice.webUrl)}` : ''
  const star = choice.isFavorite ? pc.yellow('★') : pc.dim('☆')
  const label = pc.bold(choice.label ?? choice.projectRef)
  const projectRef = pc.blue(choice.projectRef)
  const numberTag = pc.dim(`#${index + 1}`)

  return [
    `${star} ${numberTag} ${profileTag} ${label} ${pc.dim('(')}${projectRef}${pc.dim(')')}`,
    `   ${pc.dim('last activity:')} ${lastActive}${web}`,
  ]
}

export function buildProjectOptions(choice: InteractiveProjectChoice): ProjectOverrideOptions {
  const overrides: ProjectOverrideOptions = {}
  if (/^\d+$/.test(choice.projectRef)) {
    overrides.projectId = choice.projectRef
  }
  else {
    overrides.projectPath = choice.projectRef
  }
  if (choice.profileName) {
    overrides.profile = choice.profileName
  }
  return overrides
}

export function markFavoriteState(choices: InteractiveProjectChoice[], favoriteSet: Set<string>) {
  choices.forEach((choice) => {
    const key = favoriteKey(choice.projectRef, choice.profileName)
    choice.isFavorite = favoriteSet.has(key)
  })
}

export function buildFavoriteChoiceList(
  records: FavoriteProjectRecord[],
  projects: InteractiveProjectChoice[],
) {
  const choiceMap = new Map<string, InteractiveProjectChoice>()
  projects.forEach((choice) => {
    choiceMap.set(favoriteKey(choice.projectRef, choice.profileName), choice)
  })

  return records.map<InteractiveProjectChoice>((record) => {
    const key = favoriteKey(record.projectRef, record.profile)
    const existing = choiceMap.get(key)
    if (existing) {
      existing.isFavorite = true
      return existing
    }
    return {
      projectRef: record.projectRef,
      label: record.label ?? record.projectRef,
      profileName: record.profile ?? undefined,
      lastActivity: record.lastActivity,
      webUrl: record.webUrl,
      isFavorite: true,
    }
  })
}
