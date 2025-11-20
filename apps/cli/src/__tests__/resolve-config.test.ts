import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function setupTempCwd() {
  const base = path.resolve(__dirname, '../../.tmp-tests')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  const dir = mkdtempSync(path.join(base, 'cwd-'))
  const prevCwd = process.cwd()
  process.chdir(dir)
  return { dir, prevCwd }
}

function setupTempHome() {
  const base = path.resolve(__dirname, '../../.tmp-tests')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  const dir = mkdtempSync(path.join(base, 'home-'))
  process.env.HOME = dir
  process.env.XDG_CONFIG_HOME = path.join(dir, '.config')
  return dir
}

describe('resolveGitlabProfiles precedence', () => {
  let prevEnv: NodeJS.ProcessEnv
  let currentHome: string

  beforeEach(() => {
    prevEnv = { ...process.env }
    currentHome = setupTempHome()
  })
  afterEach(() => {
    process.env = prevEnv
  })

  it('CLI options override config and env', async () => {
    setupTempCwd()
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({
      token: 'cli-token',
      projectId: '333',
      baseUrl: 'https://cli.example.com',
    })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('cli-token')
    expect(profiles[0].projectRef).toBe('333')
    expect(profiles[0].baseUrl).toBe('https://cli.example.com')
  })

  it('config top-level used when no CLI and no env', async () => {
    const { dir, prevCwd: _ } = setupTempCwd()
    const configPath = path.join(dir, 'gitlab-cli.config.json')
    writeFileSync(configPath, `${JSON.stringify({
      token: 'conf-token',
      projectId: '111',
      baseUrl: 'https://conf.example.com',
    }, null, 2)}\n`)
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({})
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('conf-token')
    expect(profiles[0].projectRef).toBe('111')
    expect(profiles[0].baseUrl).toBe('https://conf.example.com')
  })

  it('env multi-profiles used when no CLI and no config', async () => {
    setupTempCwd()
    process.env.GITLAB_PROFILES = 'A,B'
    process.env.GITLAB_A_TOKEN = 'token-a'
    process.env.GITLAB_A_PROJECT_ID = '100'
    process.env.GITLAB_B_TOKEN = 'token-b'
    process.env.GITLAB_B_PROJECT_PATH = 'group/b'
    // default base url
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({ allProfiles: true })
    expect(profiles).toHaveLength(2)
    const names = profiles.map(p => p.name)
    expect(names).toContain('A')
    expect(names).toContain('B')
    const profA = profiles.find(p => p.name === 'A')!
    const profB = profiles.find(p => p.name === 'B')!
    expect(profA.token).toBe('token-a')
    expect(profA.projectRef).toBe('100')
    expect(profB.token).toBe('token-b')
    expect(profB.projectRef).toBe('group/b')
    expect(profA.baseUrl).toBe('https://gitlab.com')
    expect(profB.baseUrl).toBe('https://gitlab.com')
  })

  it('allows overriding project reference via CLI while keeping profile token', async () => {
    const { dir } = setupTempCwd()
    const configPath = path.join(dir, 'gitlab-cli.config.json')
    writeFileSync(configPath, `${JSON.stringify({
      defaultProfile: 'teamA',
      profiles: {
        teamA: {
          token: 'token-a',
          projectId: '111',
        },
      },
    }, null, 2)}\n`)
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({ profile: 'teamA', projectId: '999' })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('token-a')
    expect(profiles[0].projectRef).toBe('999')
  })

  it('resolves profile without project when requireProject=false', async () => {
    const { dir } = setupTempCwd()
    const configPath = path.join(dir, 'gitlab-cli.config.json')
    writeFileSync(configPath, `${JSON.stringify({
      token: 'only-token',
    }, null, 2)}\n`)
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({}, { requireProject: false })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('only-token')
    expect(profiles[0].projectRef).toBeUndefined()
  })

  it('falls back to ~/.config/gitlab-cli/config.json when no other config exists', async () => {
    setupTempCwd()
    const homeDir = currentHome
    const configDir = path.join(homeDir, '.config', 'gitlab-cli')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    const file = path.join(configDir, 'config.json')
    writeFileSync(file, `${JSON.stringify({
      token: 'global-token',
      projectId: '555',
      baseUrl: 'https://global.example.com',
    }, null, 2)}\n`)
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({})
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('global-token')
    expect(profiles[0].projectRef).toBe('555')
    expect(profiles[0].baseUrl).toBe('https://global.example.com')
  })

  it('loads env token without project when requireProject=false', async () => {
    setupTempCwd()
    process.env.GITLAB_TOKEN = 'env-token'
    delete process.env.GITLAB_PROJECT_ID
    delete process.env.GITLAB_PROJECT_PATH
    const { resolveGitlabProfiles } = await import('../config.js')
    const profiles = await resolveGitlabProfiles({}, { requireProject: false })
    expect(profiles).toHaveLength(1)
    expect(profiles[0].token).toBe('env-token')
    expect(profiles[0].projectRef).toBeUndefined()
  })
})
