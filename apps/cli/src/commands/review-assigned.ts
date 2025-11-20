import type { Gitlab } from '@gitbeaker/rest'
import type { Command } from 'commander'
import type { MergeRequestSummary, ReviewAssignedCommandOptions } from '../shared'
import { logger } from '../logger'
import { withProjectOptions } from '../project-options'
import {
  buildListFetchOptions,
  createGitlabSdksForProfiles,
  DEFAULT_COMMENT_BODY,
} from '../shared'

interface GitlabUser {
  id?: number
  username?: string | null
  name?: string | null
}

interface MergeRequestAssignee {
  id?: number
  username?: string | null
  name?: string | null
}

interface MergeRequestWithAssignees extends MergeRequestSummary {
  iid?: number
  assignee?: MergeRequestAssignee | null
  assignees?: MergeRequestAssignee[] | null
  assignee_id?: number | null
}

interface MergeRequestNote {
  id?: number
  body?: string | null
}

type GitlabClient = InstanceType<typeof Gitlab>

function normalizeCommentBody(comment?: string) {
  const trimmed = comment?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_COMMENT_BODY
}

function isAssignedToUser(mr: MergeRequestWithAssignees, user: GitlabUser) {
  if (!user.id) {
    return false
  }

  if (mr.assignee?.id === user.id) {
    return true
  }

  if (typeof mr.assignee_id === 'number' && mr.assignee_id === user.id) {
    return true
  }

  if (Array.isArray(mr.assignees)) {
    return mr.assignees.some(assignee => assignee?.id === user.id)
  }

  return false
}

async function verifyCommentExists(
  client: GitlabClient,
  projectRef: string,
  mrIid: number,
  note: MergeRequestNote,
  expectedBody: string,
) {
  if (!note.id) {
    throw new Error('Unable to verify comment without note id returned by GitLab')
  }

  const fetched = await client.MergeRequestNotes.show(projectRef, mrIid, note.id)
  const body = typeof fetched?.body === 'string' ? fetched.body.trim() : ''

  if (!body.includes(expectedBody)) {
    throw new Error('Comment verification failed: body mismatch')
  }
}

async function processMergeRequest(
  client: GitlabClient,
  projectRef: string,
  mr: MergeRequestWithAssignees,
  commentBody: string,
  dryRun?: boolean,
) {
  const iid = mr.iid
  if (!iid) {
    logger.warn('Skipping merge request without IID')
    return
  }

  const title = mr.title ?? '(no title)'
  logger.info(`Processing !${iid} - ${title}`)

  if (dryRun) {
    logger.info(`[dry-run] Would comment and merge !${iid}`)
    return
  }

  const note = await client.MergeRequestNotes.create(projectRef, iid, commentBody)
  await verifyCommentExists(client, projectRef, iid, note, commentBody)
  logger.success(`Comment posted for !${iid}`)

  await client.MergeRequests.accept(projectRef, iid, {})
  logger.success(`Merge triggered for !${iid}`)
}

export function registerReviewAssignedCommand(program: Command) {
  return withProjectOptions(
    program.command('review-assigned')
      .description('Automatically comment and merge merge requests assigned to the authenticated user')
      .option('--state <state>', 'State filter (opened, closed, merged, locked, all)', 'opened')
      .option('--comment <text>', `Override comment body (default: ${DEFAULT_COMMENT_BODY})`)
      .option('--dry-run', 'Print actions instead of executing them')
      .action(async (options: ReviewAssignedCommandOptions) => {
        const commentBody = normalizeCommentBody(options.comment)
        const sdks = await createGitlabSdksForProfiles(options)
        let hadFailuresOverall = false

        for (const { name, client, projectRef } of sdks) {
          const profileTag = name ? ` [profile: ${name}]` : ''
          const currentUser = await client.Users.showCurrentUser()
          const fetchOptions = buildListFetchOptions(projectRef, options)
          const mergeRequests = await client.MergeRequests.all(fetchOptions)
          const assigned = mergeRequests.filter((mr: MergeRequestWithAssignees) => isAssignedToUser(mr, currentUser))

          if (assigned.length === 0) {
            logger.info(`No merge requests assigned to you were found${profileTag}.`)
            continue
          }

          let hadFailures = false
          for (const mr of assigned) {
            try {
              await processMergeRequest(client, projectRef, mr, commentBody, options.dryRun)
            }
            catch (error) {
              hadFailures = true
              hadFailuresOverall = true
              const message = error instanceof Error ? error.message : 'Unknown error'
              const identifier = typeof mr.iid === 'number' ? `!${mr.iid}` : 'unknown MR'
              logger.error(`Failed to process ${identifier}${profileTag}: ${message}`)
            }
          }

          if (hadFailures) {
            logger.warn(`At least one merge request failed${profileTag}. See logs above for details.`)
          }
        }

        if (hadFailuresOverall) {
          throw new Error('At least one merge request failed across profiles. See logs above for details.')
        }
      }),
  )
}
