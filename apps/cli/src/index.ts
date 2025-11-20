#!/usr/bin/env node
import process from 'node:process'
import { Command } from 'commander'
import { registerCommentCommand } from './commands/comment'
import { registerListCommand } from './commands/list'
import { registerMergeCommand } from './commands/merge'
import { registerProfileCommand } from './commands/profile'
import { registerReviewAssignedCommand } from './commands/review-assigned'
import { handleCliError } from './error-handler'
import { launchInteractiveHome } from './interactive'

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
