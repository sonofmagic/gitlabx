import { readFileSync } from 'node:fs'
import process from 'node:process'
import { Command } from 'commander'
import { registerCommentCommand } from './commands/comment'
import { registerListCommand } from './commands/list'
import { registerMergeCommand } from './commands/merge'
import { registerProfileCommand } from './commands/profile'
import { registerReviewAssignedCommand } from './commands/review-assigned'
import { launchInteractiveHome } from './interactive'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version?: string }

export function createProgram() {
  const program = new Command()
  program
    .name('gitlab-cli')
    .description('Minimal helper CLI to interact with GitLab merge requests')
    .version(packageJson.version ?? '0.0.0', '-v, --version')
    .showHelpAfterError()
    .showSuggestionAfterError(true)

  registerCommentCommand(program)
  registerMergeCommand(program)
  registerListCommand(program)
  registerReviewAssignedCommand(program)
  registerProfileCommand(program)

  return program
}

export async function runCli(argv: string[] = process.argv.slice(2)) {
  const program = createProgram()
  if (argv.length === 0) {
    const handled = await launchInteractiveHome()
    if (!handled) {
      program.outputHelp()
    }
    return
  }

  const parseArgv = ['node', program.name(), ...argv]
  await program.parseAsync(parseArgv)
}
