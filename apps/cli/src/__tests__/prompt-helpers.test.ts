// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('prompt helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.unmock('@inquirer/prompts')
  })

  it('returns back when escape is pressed in repo action menu', async () => {
    const select = vi.fn().mockImplementation(({ signal }) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve('comment'), 50)
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new Error('aborted'))
        })
      })
    })

    vi.doMock('@inquirer/prompts', () => ({
      select,
      input: vi.fn(),
      confirm: vi.fn(),
    }))

    const { promptRepoActionMenu } = await import('../interactive/prompt-helpers')

    const resultPromise = promptRepoActionMenu({
      projectRef: '123',
      label: 'IT',
      isFavorite: false,
    })

    process.stdin.emit('keypress', '', { name: 'escape' })
    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result).toBe('back')
  })
})
