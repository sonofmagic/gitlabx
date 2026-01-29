import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import path from 'node:path'
// @vitest-environment node
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGlobalConfigPath } from '../bootstrap'

function setupTempHome() {
  const base = path.resolve(__dirname, '../../.tmp-tests')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  const dir = mkdtempSync(path.join(base, 'home-'))
  process.env['HOME'] = dir
  process.env['XDG_CONFIG_HOME'] = path.join(dir, '.config')
  return dir
}

function readGlobalConfigJson() {
  const { file } = getGlobalConfigPath()
  const raw = readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

describe('interactive bootstrap', () => {
  beforeEach(() => {
    setupTempHome()
  })
  afterEach(() => {
    vi.resetModules()
    vi.unmock('@inquirer/prompts')
    vi.unmock('node:process')
  })

  it('prompts for baseUrl and writes global config when none exists (profile use)', async () => {
    const answers = ['https://gitlab.interactive.com']
    vi.doMock('@inquirer/prompts', () => ({
      input: async () => answers.shift() ?? '',
      select: async () => undefined,
      confirm: async () => false,
    }))
    // Make input appear TTY
    process.env['CI'] = ''
    vi.doMock('node:process', () => ({
      stdin: { isTTY: true },
      stdout: { write: (_: string) => {} },
      env: process.env,
    }))

    const { registerProfileCommand } = await import('../commands/profile')
    const program = new Command().name('gitlab-cli-test')
    registerProfileCommand(program)
    await program.parseAsync(['profile', 'use'], { from: 'user' })

    const json = readGlobalConfigJson()
    expect(json.baseUrl).toBe('https://gitlab.interactive.com')
  })
})
