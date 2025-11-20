import type { AcceptMergeRequestOptions, AllMergeRequestsOptions } from '@gitbeaker/rest'

import type { ResolvedProfile } from './config'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { Gitlab } from '@gitbeaker/rest'
import { maybeBootstrapGlobalConfig } from './bootstrap'
import { resolveGitlabConfig, resolveGitlabProfiles } from './config'

export interface BaseOptions {
  projectId?: string
  projectPath?: string
  token?: string
  baseUrl?: string
  // Multi-profile controls
  profile?: string
  allProfiles?: boolean
}

export interface CommentCommandOptions extends BaseOptions {
  mr: string
  message?: string
  messageFile?: string
  dryRun?: boolean
}

export interface MergeCommandOptions extends BaseOptions {
  mr: string
  sha?: string
  squash?: boolean
  removeSourceBranch?: boolean
  mergeWhenPipelineSucceeds?: boolean
  commitMessage?: string
  squashMessage?: string
  dryRun?: boolean
}

export interface ListCommandOptions extends BaseOptions {
  state?: string
  author?: string
  targetBranch?: string
  sourceBranch?: string
  labels?: string
  search?: string
  match?: string
  limit?: string
  json?: boolean
}

export interface ReviewAssignedCommandOptions extends ListCommandOptions {
  comment?: string
  dryRun?: boolean
}

export interface GitbeakerRequestError extends Error {
  description?: string
  response?: {
    status?: number
    body?: unknown
  }
}

export interface MergeRequestMatchSource {
  title?: string | null
  description?: string | null
}

export interface MergeRequestSummary extends MergeRequestMatchSource {
  id?: number
  iid?: number
  state?: string | null
  source_branch?: string | null
  target_branch?: string | null
  updated_at?: string | null
  web_url?: string | null
  labels?: string[]
  author?: {
    username?: string | null
    name?: string | null
  } | null
}

interface MergeRequestListOptions extends AllMergeRequestsOptions {
  projectId: string | number
  withLabelsDetails?: false
}

export const DEFAULT_COMMENT_BODY = 'review: ok'
const MR_STATES = ['opened', 'closed', 'locked', 'merged'] as const
type MergeRequestState = typeof MR_STATES[number]
const ALLOWED_MR_STATES = new Set<MergeRequestState>(MR_STATES)

function normalizeStateOption(value?: string | null): MergeRequestState | undefined {
  if (!value || value === 'undefined') {
    return 'opened'
  }

  const lowered = value.toLowerCase()
  if (lowered === 'all') {
    return undefined
  }

  if (!ALLOWED_MR_STATES.has(lowered as MergeRequestState)) {
    throw new Error('Invalid --state value. Use opened, closed, merged, locked, or all.')
  }

  return lowered as MergeRequestState
}

async function readFromStdin() {
  if (process.stdin.isTTY) {
    return ''
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    chunks.push(bufferChunk)
  }

  const data = Buffer.concat(chunks).toString('utf8')
  return data.trim().length > 0 ? data : ''
}

export function parseMergeRequestIid(value: string) {
  const normalized = value.trim().replace(/^!/, '')
  const iid = Number.parseInt(normalized, 10)

  if (!Number.isFinite(iid) || iid <= 0) {
    throw new Error(`Invalid merge request IID: ${value}`)
  }

  return iid
}

export async function resolveCommentBody(options: CommentCommandOptions) {
  if (options.message) {
    if (!options.message.trim()) {
      throw new Error('Comment body is empty.')
    }

    return options.message
  }

  if (options.messageFile) {
    const absolute = path.resolve(process.cwd(), options.messageFile)
    const fileContent = await readFile(absolute, 'utf8')

    if (!fileContent.trim()) {
      throw new Error(`Comment file ${absolute} is empty.`)
    }

    return fileContent
  }

  const stdinBody = await readFromStdin()
  if (stdinBody) {
    return stdinBody
  }

  return DEFAULT_COMMENT_BODY
}

export function createGitlabSdk(options: BaseOptions) {
  const config = resolveGitlabConfig(options)
  const client = new Gitlab({
    host: config.baseUrl,
    token: config.token,
  })

  return {
    client,
    projectRef: config.projectRef,
  }
}

export async function createGitlabSdksForProfiles(options: BaseOptions, extra?: { requireProject?: boolean }) {
  // Ensure a minimal global config exists for first-time users
  await maybeBootstrapGlobalConfig()
  const requireProject = extra?.requireProject !== false
  const profiles: ResolvedProfile[] = await resolveGitlabProfiles(options, { requireProject })
  return profiles.map((cfg) => {
    if (requireProject && !cfg.projectRef) {
      throw new Error('Missing project reference for resolved profile.')
    }
    const client = new Gitlab({
      host: cfg.baseUrl,
      token: cfg.token,
    })
    return {
      name: cfg.name,
      client,
      projectRef: cfg.projectRef ?? '',
    }
  })
}

export function buildMergeOptions(options: MergeCommandOptions): AcceptMergeRequestOptions {
  const payload: AcceptMergeRequestOptions = {}

  if (options.sha) {
    payload.sha = options.sha
  }
  if (options.squash) {
    payload.squash = true
  }
  if (options.removeSourceBranch) {
    payload.shouldRemoveSourceBranch = true
  }
  if (options.mergeWhenPipelineSucceeds) {
    payload.mergeWhenPipelineSucceeds = true
  }
  if (options.commitMessage) {
    payload.mergeCommitMessage = options.commitMessage
  }
  if (options.squashMessage) {
    payload.squashCommitMessage = options.squashMessage
  }

  return payload
}

export function buildListFetchOptions(projectRef: string, options: ListCommandOptions): MergeRequestListOptions {
  const fetchOptions: MergeRequestListOptions = {
    projectId: projectRef,
  }

  const normalizedState = normalizeStateOption(options.state)
  if (normalizedState) {
    fetchOptions.state = normalizedState
  }

  if (options.author) {
    fetchOptions.authorUsername = options.author
  }

  if (options.targetBranch) {
    fetchOptions.targetBranch = options.targetBranch
  }

  if (options.sourceBranch) {
    fetchOptions.sourceBranch = options.sourceBranch
  }

  if (options.labels) {
    fetchOptions.labels = options.labels
  }

  if (options.search) {
    fetchOptions.search = options.search
  }

  return fetchOptions
}

export function applyMatchFilter<T extends MergeRequestMatchSource>(items: T[], match?: string) {
  const needle = match?.trim().toLowerCase()
  if (!needle) {
    return items
  }

  return items.filter((item) => {
    const haystack = `${item.title ?? ''}\n${item.description ?? ''}`.toLowerCase()
    return haystack.includes(needle)
  })
}

export function formatMergeRequestSummary(mr: MergeRequestSummary) {
  const numericId = typeof mr.id === 'number' ? mr.id : 'unknown'
  const author = mr.author?.username ?? mr.author?.name ?? 'unknown'
  const title = mr.title ?? '(no title)'
  const state = mr.state ?? 'unknown'
  const source = mr.source_branch ?? ''
  const target = mr.target_branch ?? ''
  const updated = mr.updated_at ? new Date(mr.updated_at).toISOString() : 'unknown'
  const web = mr.web_url ?? ''
  const labels = Array.isArray(mr.labels) && mr.labels.length > 0 ? ` | labels: ${mr.labels.join(', ')}` : ''

  return [
    `!${mr.iid ?? '?'} (id: ${numericId}) [${state}] ${title}`,
    `  author: ${author} | branches: ${source} -> ${target}${labels}`,
    `  updated: ${updated}${web ? ` | ${web}` : ''}`,
  ].join('\n')
}

export function parseLimitOption(value?: string) {
  if (!value) {
    return undefined
  }

  const limit = Number.parseInt(value, 10)
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Invalid --limit value. Provide a positive integer.')
  }

  return limit
}

export function isGitbeakerError(error: unknown): error is GitbeakerRequestError {
  return Boolean(
    error
    && typeof error === 'object'
    && ('response' in error || 'description' in error),
  )
}
