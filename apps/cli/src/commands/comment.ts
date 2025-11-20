import type { Command } from 'commander'
import type { CommentCommandOptions } from '../shared.js'

import { logger } from '../logger.js'
import { withProjectOptions } from '../project-options.js'
import { createGitlabSdksForProfiles, parseMergeRequestIid, resolveCommentBody } from '../shared.js'

export async function runCommentWorkflow(options: CommentCommandOptions) {
  const mrIid = parseMergeRequestIid(options.mr)
  const commentBody = await resolveCommentBody(options)
  const sdks = await createGitlabSdksForProfiles(options)

  for (const { client, projectRef, name } of sdks) {
    const profileTag = name ? ` [profile: ${name}]` : ''
    if (options.dryRun) {
      logger.info(`[dry-run] Would comment on !${mrIid}${profileTag} with:\n${commentBody}`)
      continue
    }

    await client.MergeRequestNotes.create(projectRef, mrIid, commentBody)
    logger.success(`Comment added to merge request !${mrIid}${profileTag}`)
  }
}

export function registerCommentCommand(program: Command) {
  return withProjectOptions(
    program.command('comment')
      .description('Add a comment to a merge request')
      .requiredOption('--mr <iid>', 'Merge request IID (!123)')
      .option('-m, --message <text>', 'Comment body text')
      .option('-f, --message-file <file>', 'Read comment body from a file')
      .option('--dry-run', 'Print payload instead of posting to GitLab')
      .action(runCommentWorkflow),
  )
}
