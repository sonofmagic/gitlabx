// @vitest-environment node
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createProgram() {
  const program = new Command()
  program.name('gitlab-cli-test')
  return program
}

describe('list --json aggregation', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('prints MR array for single profile (back-compat)', async () => {
    const writes: string[] = []
    vi.doMock('node:process', () => ({
      default: {
        stdout: {
          write: (chunk: unknown) => {
            writes.push(String(chunk))
            return true
          },
        },
        env: process.env,
      },
      stdout: {
        write: (chunk: unknown) => {
          writes.push(String(chunk))
          return true
        },
      },
      env: process.env,
    }))
    vi.doMock('../shared.js', async () => {
      const actual = await vi.importActual<any>('../shared.js')
      return {
        ...actual,
        createGitlabSdksForProfiles: vi.fn(async () => ([
          {
            name: undefined,
            projectRef: '123',
            client: {
              MergeRequests: {
                all: vi.fn().mockResolvedValue([
                  { iid: 1, title: 'One' },
                  { iid: 2, title: 'Two' },
                ]),
              },
            },
          },
        ])),
      }
    })
    const { registerListCommand } = await import('../commands/list.js')
    const program = createProgram()
    registerListCommand(program)

    await program.parseAsync(['list', '--json'], { from: 'user' })

    const jsonStr = writes.find(c => c.trim().startsWith('[') || c.trim().startsWith('{')) as string
    const parsed = JSON.parse(jsonStr)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].iid).toBe(1)
  })

  it('prints array of {profile, projectRef, mergeRequests} for multi profiles', async () => {
    const writes: string[] = []
    vi.doMock('node:process', () => ({
      default: {
        stdout: {
          write: (chunk: unknown) => {
            writes.push(String(chunk))
            return true
          },
        },
        env: process.env,
      },
      stdout: {
        write: (chunk: unknown) => {
          writes.push(String(chunk))
          return true
        },
      },
      env: process.env,
    }))
    vi.doMock('../shared.js', async () => {
      const actual = await vi.importActual<any>('../shared.js')
      return {
        ...actual,
        createGitlabSdksForProfiles: vi.fn(async () => ([
          {
            name: 'A',
            projectRef: '111',
            client: {
              MergeRequests: {
                all: vi.fn().mockResolvedValue([{ iid: 1, title: 'A-1' }]),
              },
            },
          },
          {
            name: 'B',
            projectRef: '222',
            client: {
              MergeRequests: {
                all: vi.fn().mockResolvedValue([{ iid: 2, title: 'B-2' }, { iid: 3, title: 'B-3' }]),
              },
            },
          },
        ])),
      }
    })
    const { registerListCommand } = await import('../commands/list.js')
    const program = createProgram()
    registerListCommand(program)

    await program.parseAsync(['list', '--json'], { from: 'user' })

    const jsonStr = writes.find(c => c.trim().startsWith('[')) as string
    const parsed = JSON.parse(jsonStr)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toHaveProperty('profile')
    expect(parsed[0]).toHaveProperty('projectRef')
    expect(parsed[0]).toHaveProperty('mergeRequests')
    const names = parsed.map((r: any) => r.profile)
    expect(names).toEqual(['A', 'B'])
  })
})
