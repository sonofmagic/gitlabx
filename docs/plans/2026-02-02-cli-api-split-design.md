# CLI/API Split for apps/cli

## Overview

Split the current CLI entry into a dedicated `cli` entrypoint while exposing a stable library API at `@gitlabx/cli`. This keeps CLI behavior unchanged while enabling programmatic use via `createProgram()` and `runCli()`.

## Goals

- Make `src/cli.ts` the default CLI entry.
- Provide `createProgram()` and `runCli()` from `@gitlabx/cli`.
- Keep existing commands and interactive behavior intact.

## Non-goals

- Changing command behavior or naming.
- Refactoring command implementations.

## Design

### Public API

- `createProgram(): Command`
  - Builds and returns a configured Commander instance with all commands registered.
  - Sets name, description, and version from `apps/cli/package.json`.
- `runCli(argv?: string[]): Promise<void>`
  - Uses `createProgram()` and the same control flow as the current CLI.
  - If `argv` is empty, attempts to launch the interactive home screen.
  - Otherwise parses the arguments and executes the matching command.

### CLI Entry

- New `src/cli.ts` is the only bin entrypoint and calls `runCli().catch(handleCliError)`.
- Shebang stays on the CLI entry to preserve executable behavior.

### Build and Packaging

- `tsdown.config.ts` builds two entries: `src/index.ts` and `src/cli.ts`.
- `package.json` `bin` points to `./dist/cli.cjs` for both `gitlabx` and `gbx`.
- `exports` remains focused on `dist/index.*` so `@gitlabx/cli` is the library API.

## Error Handling

- `runCli()` does not swallow errors; the CLI entry handles errors via `handleCliError`.

## Testing

- Existing tests should continue to pass as command registration and behavior are unchanged.
- Optional: add a unit test for `createProgram()`/`runCli()` if desired.
