import type { Command } from 'commander'

export function withProjectOptions(command: Command) {
  return command
    .option('--project-id <id>', 'GitLab project ID')
    .option('--project-path <path>', 'GitLab namespace/project path (e.g. team/project)')
    .option('--token <token>', 'GitLab access token (defaults to $GITLAB_TOKEN)')
    .option('--base-url <url>', 'GitLab base URL, defaults to https://gitlab.com')
    // Multi-profile support:
    // - --profile accepts a single name or a comma-separated list of names.
    // - --all-profiles instructs the command to run for every profile declared in config (or $GITLAB_PROFILES).
    .option('--profile <name>', 'Named profile(s) from config or $GITLAB_PROFILES (comma-separated supported)')
    .option('--all-profiles', 'Run against all profiles from config or $GITLAB_PROFILES')
}
