import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import path from 'node:path'
// @vitest-environment node
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGlobalConfigPath } from '../bootstrap.js'
import { registerProfileCommand } from '../commands/profile.js'

function setupTempHome() {
  // Ensure temp dir is inside workspace to satisfy sandbox write constraints
  const base = path.resolve(__dirname, '../../.tmp-tests')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  const dir = mkdtempSync(path.join(base, 'home-'))
  process.env.HOME = dir
  return dir
}

function readGlobalConfigJson() {
  const { file } = getGlobalConfigPath()
  const raw = readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

function createCli() {
  const program = new Command()
  program.name('gitlab-cli-test')
  registerProfileCommand(program)
  return program
}

describe('profile commands', () => {
  beforeEach(() => {
    setupTempHome()
  })

  it('profile use writes defaultProfile and baseUrl to global config', async () => {
    const program = createCli()
    await program.parseAsync(['profile', 'use', '--profile', 'teamA', '--base-url', 'https://example.com'], { from: 'user' })

    const json = readGlobalConfigJson()
    expect(json.defaultProfile).toBe('teamA')
    expect(json.baseUrl).toBe('https://example.com')
  })

  it('profile set-base-url updates global baseUrl', async () => {
    const program = createCli()
    await program.parseAsync(['profile', 'set-base-url', '--url', 'https://another.com'], { from: 'user' })

    const json = readGlobalConfigJson()
    expect(json.baseUrl).toBe('https://another.com')
  })

  it('profile set-base-url updates profile-specific baseUrl', async () => {
    const program = createCli()
    await program.parseAsync(['profile', 'set-base-url', '--profile', 'teamB', '--url', 'https://teamb.example.com'], { from: 'user' })
    const json = readGlobalConfigJson()
    expect(json.profiles).toBeTruthy()
    expect(json.profiles.teamB.baseUrl).toBe('https://teamb.example.com')
  })

  it('profile list prints profiles and defaults', async () => {
    const program = createCli()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await program.parseAsync(['profile', 'list'], { from: 'user' })
      // We don't assert exact lines, just that something was printed
      expect(info).toHaveBeenCalled()
    }
    finally {
      info.mockRestore()
    }
  })
})
