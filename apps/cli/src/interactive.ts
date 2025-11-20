import type { FavoriteProjectRecord } from './favorites.js'
import type { InteractiveProjectChoice, MergeRequestRecord } from './interactive/helpers.js'
import process from 'node:process'
import pc from 'picocolors'
import { runCommentWorkflow } from './commands/comment.js'
import { runMergeWorkflow } from './commands/merge.js'
import {
  favoriteKey,

  loadFavoriteProjects,
  saveFavoriteProjects,
} from './favorites.js'
import {
  buildFavoriteChoiceList,
  buildProjectOptions,

  markFavoriteState,

} from './interactive/helpers.js'
import { launchProfileManager } from './interactive/profile-manager.js'
import {
  promptCommentBody,
  promptProjectSelection,
  promptRepoActionMenu,
  promptRepoListMode,
  promptYesNo,
  selectFromPagedList,
} from './interactive/prompt-helpers.js'
import { logger } from './logger.js'
import { listProfiles, loadProfileStore } from './profile-store.js'
import { createGitlabSdksForProfiles, DEFAULT_COMMENT_BODY } from './shared.js'

interface GitlabProjectSummary {
  id?: number
  name?: string | null
  name_with_namespace?: string | null
  path_with_namespace?: string | null
  last_activity_at?: string | null
  web_url?: string | null
}

const PROJECT_FETCH_PER_PAGE = 50
const PROJECT_FETCH_MAX_PAGES = 10
const MR_FETCH_PER_PAGE = 50
const MR_FETCH_MAX_PAGES = 5

type ActionChoice = 'comment' | 'merge'
function isInteractiveSession() {
  return Boolean(process.stdin?.isTTY && process.stdout?.isTTY)
}

function isMergeRequestMergeable(mr: MergeRequestRecord) {
  if (mr.work_in_progress || mr.draft) {
    return false
  }
  const mergeStatus = mr.merge_status ?? mr.detailed_merge_status
  if (mergeStatus && mergeStatus !== 'can_be_merged') {
    return false
  }
  return typeof mr.iid === 'number'
}

function formatMergeRequestLines(mr: MergeRequestRecord) {
  const iid = typeof mr.iid === 'number' ? `!${mr.iid}` : '! ?'
  const title = mr.title ?? '(no title)'
  const status = mr.merge_status ?? mr.detailed_merge_status ?? mr.state ?? ''
  const statusBadge = status ? pc.dim(`[${status}]`) : ''
  const author = mr.author?.username ?? mr.author?.name ?? 'unknown'
  const branches = `${mr.source_branch ?? 'unknown'} → ${mr.target_branch ?? 'unknown'}`
  const updated = mr.updated_at ? new Date(mr.updated_at).toISOString() : 'unknown'
  const web = mr.web_url ? pc.dim(mr.web_url) : ''

  return [
    `${pc.green(iid)} ${statusBadge ? `${statusBadge} ` : ''}${title}`,
    `  ${author} | ${branches}`,
    `  updated: ${updated}${web ? ` | ${web}` : ''}`,
  ]
}

async function collectRecentProjects(profileName?: string): Promise<InteractiveProjectChoice[]> {
  const options = profileName ? { profile: profileName } : {}
  const sdks = await createGitlabSdksForProfiles(options, { requireProject: false })
  if (sdks.length === 0) {
    return []
  }

  const choices: InteractiveProjectChoice[] = []
  await Promise.all(sdks.map(async ({ client, name }) => {
    try {
      const projects = await client.Projects.all({
        membership: true,
        orderBy: 'last_activity_at',
        sort: 'desc',
        perPage: PROJECT_FETCH_PER_PAGE,
        maxPages: PROJECT_FETCH_MAX_PAGES,
      }) as GitlabProjectSummary[]

      projects.forEach((project) => {
        const id = typeof project.id === 'number' ? String(project.id) : undefined
        const label = project.name_with_namespace ?? project.path_with_namespace ?? project.name ?? id
        const projectRef = id ?? project.path_with_namespace ?? ''
        if (!projectRef || !label) {
          return
        }
        choices.push({
          projectRef,
          label,
          lastActivity: project.last_activity_at ?? undefined,
          profileName: name,
          webUrl: project.web_url ?? undefined,
        })
      })
    }
    catch (error) {
      const prefix = name ? `[${name}]` : '[default]'
      const err = error instanceof Error ? error : new Error('Unknown error')
      logger.warn(`${prefix} Failed to load recent projects: ${err.message}`)
    }
  }))

  choices.sort((a, b) => {
    const aTime = a.lastActivity ? Date.parse(a.lastActivity) : 0
    const bTime = b.lastActivity ? Date.parse(b.lastActivity) : 0
    return bTime - aTime
  })

  return choices
}

async function fetchMergeRequestsForChoice(choice: InteractiveProjectChoice, activeProfile?: string) {
  const overrides = buildProjectOptions(choice)
  const profileFilter = choice.profileName ?? activeProfile
  const sdks = await createGitlabSdksForProfiles(
    profileFilter ? { ...overrides, profile: profileFilter } : overrides,
  )
  const target = choice.profileName
    ? sdks.find(sdk => sdk.name === choice.profileName)
    : sdks[0]

  if (!target) {
    throw new Error('Failed to resolve a GitLab profile for the selected project.')
  }

  const mergeRequests = await target.client.MergeRequests.all({
    projectId: target.projectRef,
    state: 'opened',
    orderBy: 'updated_at',
    sort: 'desc',
    perPage: MR_FETCH_PER_PAGE,
    maxPages: MR_FETCH_MAX_PAGES,
  }) as MergeRequestRecord[]

  return mergeRequests
}

async function promptMergeRequestSelection(
  choice: InteractiveProjectChoice,
  action: ActionChoice,
  activeProfile?: string,
) {
  logger.info(pc.dim('Fetching merge requests...'))
  const mergeRequests = await fetchMergeRequestsForChoice(choice, activeProfile)
  const candidates = mergeRequests.filter(isMergeRequestMergeable)

  if (candidates.length === 0) {
    logger.warn('No merge requests ready for action in this project.')
    return undefined
  }

  const title = action === 'comment'
    ? 'Select a merge request to comment'
    : 'Select a merge request to merge'

  return await selectFromPagedList(candidates, {
    title,
    formatItem: mr => formatMergeRequestLines(mr),
  })
}

async function handleCommentFlow(choice: InteractiveProjectChoice, mr: MergeRequestRecord) {
  const message = await promptCommentBody(DEFAULT_COMMENT_BODY)
  if (!message) {
    return false
  }
  await runCommentWorkflow({
    ...buildProjectOptions(choice),
    mr: String(mr.iid),
    message,
  })
  return true
}

async function handleMergeFlow(choice: InteractiveProjectChoice, mr: MergeRequestRecord) {
  const squash = await promptYesNo('Squash commits?', false)
  if (squash === undefined) {
    return false
  }
  const removeSourceBranch = await promptYesNo('Remove source branch after merge?', false)
  if (removeSourceBranch === undefined) {
    return false
  }
  const mwps = await promptYesNo('Merge when pipeline succeeds?', false)
  if (mwps === undefined) {
    return false
  }
  await runMergeWorkflow({
    ...buildProjectOptions(choice),
    mr: String(mr.iid),
    squash,
    removeSourceBranch,
    mergeWhenPipelineSucceeds: mwps,
  })
  return true
}

function applyFavoriteState(
  projects: InteractiveProjectChoice[],
  favoriteRecords: FavoriteProjectRecord[],
) {
  const favoriteSet = new Set(favoriteRecords.map(record => favoriteKey(record.projectRef, record.profile)))
  markFavoriteState(projects, favoriteSet)
  const favoriteChoices = buildFavoriteChoiceList(favoriteRecords, projects)
  return { favoriteSet, favoriteChoices }
}

export async function launchInteractiveHome() {
  if (!isInteractiveSession()) {
    return false
  }

  const loadProfiles = async () => {
    const store = await loadProfileStore()
    const summaries = listProfiles(store)
    return { store, summaries }
  }

  let { summaries: profileSummaries } = await loadProfiles()
  let activeProfileName: string | undefined = profileSummaries.find(p => p.isDefault)?.name
    ?? profileSummaries[0]?.name

  const refreshProfileState = async () => {
    const data = await loadProfiles()
    profileSummaries = data.summaries
    if (activeProfileName && !profileSummaries.some(profile => profile.name === activeProfileName)) {
      activeProfileName = profileSummaries.find(p => p.isDefault)?.name ?? profileSummaries[0]?.name
    }
  }

  const getActiveProfileLabel = () => {
    if (!activeProfileName) {
      return 'default'
    }
    const summary = profileSummaries.find(p => p.name === activeProfileName)
    return summary?.profile.displayName
      ?? summary?.profile.email
      ?? summary?.profile.username
      ?? activeProfileName
  }

  let favoriteRecords = await loadFavoriteProjects()
  let favoriteSet = new Set<string>()
  let favoriteChoices: InteractiveProjectChoice[] = []
  let projects: InteractiveProjectChoice[] = []

  const refreshProjects = async () => {
    projects = await collectRecentProjects(activeProfileName)
    if (projects.length === 0) {
      logger.warn('No recent projects found. Configure a GitLab profile or run a command first.')
    }
    const state = applyFavoriteState(projects, favoriteRecords)
    favoriteSet = state.favoriteSet
    favoriteChoices = state.favoriteChoices
  }

  await refreshProfileState()
  await refreshProjects()
  if (projects.length === 0) {
    return false
  }

  const persistFavorites = async (records: FavoriteProjectRecord[]) => {
    favoriteRecords = records
    const next = applyFavoriteState(projects, favoriteRecords)
    favoriteSet = next.favoriteSet
    favoriteChoices = next.favoriteChoices
    await saveFavoriteProjects(favoriteRecords)
  }

  const toggleFavorite = async (choice: InteractiveProjectChoice) => {
    const key = favoriteKey(choice.projectRef, choice.profileName)
    const isFavorite = favoriteSet.has(key)
    if (isFavorite) {
      const filtered = favoriteRecords.filter(record => favoriteKey(record.projectRef, record.profile) !== key)
      await persistFavorites(filtered)
      logger.info(pc.dim(`Removed ${choice.label} from favorites.`))
    }
    else {
      const filtered = favoriteRecords.filter(record => favoriteKey(record.projectRef, record.profile) !== key)
      filtered.push({
        projectRef: choice.projectRef,
        profile: choice.profileName,
        label: choice.label,
        webUrl: choice.webUrl,
        lastActivity: choice.lastActivity,
      })
      await persistFavorites(filtered)
      logger.info(pc.dim(`Added ${choice.label} to favorites.`))
    }
    choice.isFavorite = !isFavorite
  }

  while (true) {
    const mode = await promptRepoListMode(
      favoriteRecords.length > 0,
      favoriteRecords.length,
      getActiveProfileLabel(),
    )
    if (!mode) {
      logger.info(pc.dim('Cancelled.'))
      return true
    }

    if (mode === 'profiles') {
      await launchProfileManager({
        activeProfile: activeProfileName,
        onActiveProfileChange: (name) => {
          activeProfileName = name
        },
      })
      await refreshProfileState()
      await refreshProjects()
      continue
    }

    const pool = mode === 'favorites' ? favoriteChoices : projects
    if (pool.length === 0) {
      if (mode === 'favorites') {
        logger.info(pc.dim('No favorites yet. Choose "All repositories" to add some.'))
        continue
      }
      logger.warn('No repositories available.')
      return true
    }

    const selection = await promptProjectSelection(pool, {
      onToggleFavorite: async (item) => {
        await toggleFavorite(item)
      },
    })
    if (!selection) {
      logger.info(pc.dim('Cancelled.'))
      continue
    }

    let stayInRepo = true
    while (stayInRepo) {
      const menuChoice = await promptRepoActionMenu(selection)
      if (menuChoice === 'toggle') {
        await toggleFavorite(selection)
        continue
      }
      if (menuChoice === 'back') {
        stayInRepo = false
        break
      }
      if (menuChoice === 'cancel') {
        logger.info(pc.dim('Cancelled.'))
        return true
      }

      const action = menuChoice as ActionChoice
      const mergeRequest = await promptMergeRequestSelection(selection, action, activeProfileName)
      if (!mergeRequest) {
        logger.info(pc.dim('No merge request selected. Returning to menu...'))
        continue
      }

      const actionCompleted = action === 'comment'
        ? await handleCommentFlow(selection, mergeRequest)
        : await handleMergeFlow(selection, mergeRequest)

      if (!actionCompleted) {
        logger.info(pc.dim('Action cancelled. Returning to menu...'))
        continue
      }

      const profileLabel = selection.profileName ? `profile ${selection.profileName}` : 'default profile'
      const iidLabel = typeof mergeRequest.iid === 'number' ? `!${mergeRequest.iid}` : 'merge request'
      logger.success(
        `${pc.bold(selection.label)} ${pc.dim(`(${selection.projectRef})`)} ${iidLabel} via ${profileLabel}.`,
      )

      logger.info(pc.dim('Action completed. Choose another option or back to repositories.'))
    }
  }
}
