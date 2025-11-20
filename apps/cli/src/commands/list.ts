import type { Command } from 'commander'
import type { ListCommandOptions } from '../shared'

import process from 'node:process'
import { logger } from '../logger'
import { withProjectOptions } from '../project-options'
import {
  applyMatchFilter,
  buildListFetchOptions,
  createGitlabSdksForProfiles,
  formatMergeRequestSummary,
  parseLimitOption,
} from '../shared'

export function registerListCommand(program: Command) {
  return withProjectOptions(
    program.command('list')
      .description('List merge requests for the configured project')
      .option('--state <state>', 'State filter (opened, closed, merged, locked, all)', 'opened')
      .option('--author <username>', 'Filter by author username')
      .option('--target-branch <branch>', 'Filter by target branch')
      .option('--source-branch <branch>', 'Filter by source branch')
      .option('--labels <labels>', 'Comma-separated labels to include')
      .option('--search <text>', 'Server-side search query')
      .option('--match <text>', 'Client-side substring filter on title/description')
      .option('--limit <count>', 'Limit number of results displayed')
      .option('--json', 'Print raw JSON output instead of formatted text')
      .action(async (options: ListCommandOptions) => {
        const sdks = await createGitlabSdksForProfiles(options)
        const limit = parseLimitOption(options.limit)

        if (options.json) {
          const results = await Promise.all(sdks.map(async ({ name, client, projectRef }) => {
            const fetchOptions = buildListFetchOptions(projectRef, options)
            const mergeRequests = await client.MergeRequests.all(fetchOptions)
            const filtered = applyMatchFilter(mergeRequests, options.match)
            const subset = typeof limit === 'number' ? filtered.slice(0, limit) : filtered
            return {
              profile: name ?? 'default',
              projectRef,
              mergeRequests: subset,
              total: filtered.length,
              limited: typeof limit === 'number' ? Math.min(limit, filtered.length) : filtered.length,
            }
          }))
          // Backward-compatible JSON: if single profile, print the MR array directly.
          const payload = results.length === 1 ? results[0].mergeRequests : results
          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
          return
        }

        for (const { name, client, projectRef } of sdks) {
          const header = name ? `[${name}]` : '[default]'
          const fetchOptions = buildListFetchOptions(projectRef, options)
          const mergeRequests = await client.MergeRequests.all(fetchOptions)
          const filtered = applyMatchFilter(mergeRequests, options.match)
          const subset = typeof limit === 'number' ? filtered.slice(0, limit) : filtered

          logger.info(`${header} project: ${projectRef}`)

          if (subset.length === 0) {
            logger.info('No merge requests found.')
            continue
          }

          subset.forEach((mr) => {
            logger.info(formatMergeRequestSummary(mr))
          })

          if (limit && filtered.length > limit) {
            logger.info(`Displayed ${limit} of ${filtered.length} merge requests (increase --limit to view more).`)
          }
        }
      }),
  )
}
