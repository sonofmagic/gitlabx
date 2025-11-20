import type { Command } from 'commander'
import type { MergeCommandOptions } from '../shared'

import { logger } from '../logger'
import { withProjectOptions } from '../project-options'
import { buildMergeOptions, createGitlabSdksForProfiles, parseMergeRequestIid } from '../shared'

export async function runMergeWorkflow(options: MergeCommandOptions) {
  const mrIid = parseMergeRequestIid(options.mr)
  const payload = buildMergeOptions(options)
  const sdks = await createGitlabSdksForProfiles(options)

  for (const { client, projectRef, name } of sdks) {
    const profileTag = name ? ` [profile: ${name}]` : ''
    if (options.dryRun) {
      logger.info(`[dry-run] Would merge !${mrIid}${profileTag} with payload:\n${JSON.stringify(payload, null, 2)}`)
      continue
    }

    await client.MergeRequests.accept(projectRef, mrIid, payload)
    logger.success(`Merge triggered for !${mrIid}${profileTag}`)
  }
}

export function registerMergeCommand(program: Command) {
  return withProjectOptions(
    program.command('merge')
      .description('Merge a merge request')
      .requiredOption('--mr <iid>', 'Merge request IID (!123)')
      .option('--sha <sha>', 'Ensure the MR is still at this SHA')
      .option('--squash', 'Enable squash when merging')
      .option('--remove-source-branch', 'Remove the source branch after merging')
      .option('--merge-when-pipeline-succeeds', 'Wait for the current pipeline before merging')
      .option('--commit-message <text>', 'Custom merge commit message')
      .option('--squash-message <text>', 'Custom squash commit message')
      .option('--dry-run', 'Print payload instead of merging')
      .action(runMergeWorkflow),
  )
}
