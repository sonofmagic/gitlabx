#!/usr/bin/env node
import process from 'node:process'
import { Command } from 'commander'
import { registerCommentCommand } from './commands/comment.js'
import { registerListCommand } from './commands/list.js'
import { registerMergeCommand } from './commands/merge.js'
import { registerProfileCommand } from './commands/profile.js'
import { registerReviewAssignedCommand } from './commands/review-assigned.js'
import { handleCliError } from './error-handler.js'
import { launchInteractiveHome } from './interactive.js'

const program = new Command()
program
  .name('gitlab-cli')
  .description('Minimal helper CLI to interact with GitLab merge requests')
  .showHelpAfterError()
  .showSuggestionAfterError(true)

registerCommentCommand(program)
registerMergeCommand(program)
registerListCommand(program)
registerReviewAssignedCommand(program)
registerProfileCommand(program)

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    const handled = await launchInteractiveHome()
    if (!handled) {
      program.outputHelp()
    }
    return
  }

  await program.parseAsync(process.argv)
}

main().catch(handleCliError)
