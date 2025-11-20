import type { InteractiveProjectChoice } from './helpers'
import process, { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline'
import { confirm as promptConfirm, input as promptInput, select as promptSelect } from '@inquirer/prompts'
import pc from 'picocolors'
import { logger } from '../logger'
import { formatProjectLine } from './helpers'

const PAGER_HELP_TEXT = '↑/↓ move  ·  ←/→ change page  ·  1-9 quick select  ·  Enter confirm  ·  Esc cancel'
const DEFAULT_PAGE_SIZE = 10

export interface PromptRunResult<T> {
  cancelled: boolean
  value?: T
}

export async function runPromptWithEsc<T, O extends Record<string, any>>(
  fn: (options: O) => Promise<T>,
  options: O,
): Promise<PromptRunResult<T>> {
  const stdin = input as NodeJS.ReadStream
  readline.emitKeypressEvents(stdin)
  const controller = new AbortController()
  const wasRaw = Boolean(stdin.isRaw)

  const onKeypress = (_chunk: string, key?: readline.Key) => {
    if (key?.name === 'escape') {
      controller.abort()
    }
  }

  stdin.on('keypress', onKeypress)
  if (!wasRaw) {
    stdin.setRawMode?.(true)
  }

  try {
    const value = await fn({
      ...options,
      signal: controller.signal,
    })
    return {
      cancelled: false,
      value,
    }
  }
  catch (error) {
    if (controller.signal.aborted) {
      return {
        cancelled: true,
      }
    }
    throw error
  }
  finally {
    stdin.off('keypress', onKeypress)
    if (!wasRaw) {
      stdin.setRawMode?.(false)
    }
  }
}

export interface PagedSelectOptions<T> {
  title: string
  formatItem: (item: T, index: number) => string | string[]
  helpText?: string | null
  pageSize?: number
  onToggleFavorite?: (item: T, index: number) => Promise<void> | void
}

export async function selectFromPagedList<T>(
  items: T[],
  {
    title,
    formatItem,
    helpText = PAGER_HELP_TEXT,
    pageSize = DEFAULT_PAGE_SIZE,
    onToggleFavorite,
  }: PagedSelectOptions<T>,
) {
  if (items.length === 0) {
    return undefined
  }

  const renderLines = (item: T, index: number) => {
    const raw = formatItem(item, index)
    if (Array.isArray(raw)) {
      return raw
    }
    return String(raw).split('\n')
  }

  const fallbackSelect = async () => {
    const choices = items.map((item, idx) => ({
      name: renderLines(item, idx)[0] ?? title,
      value: idx,
    }))
    choices.push({ name: 'Cancel', value: -1 })
    const result = await runPromptWithEsc(promptSelect, {
      message: title,
      choices,
      default: choices.length > 0 ? choices[0].value : -1,
      loop: false,
    })
    if (result.cancelled || result.value === -1) {
      return undefined
    }
    return items[result.value as number]
  }

  const ttyInput = input as NodeJS.ReadStream
  const ttyOutput = output as NodeJS.WriteStream
  if (!ttyInput.isTTY || !ttyOutput.isTTY || typeof ttyInput.setRawMode !== 'function') {
    return await fallbackSelect()
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  let selectionIndex = 0
  let pageIndex = 0
  let lastRenderLines = 0

  readline.emitKeypressEvents(ttyInput)
  const wasRaw = Boolean(ttyInput.isRaw)
  if (!wasRaw) {
    ttyInput.setRawMode(true)
  }
  ttyInput.resume()

  return await new Promise<T | undefined>((resolve) => {
    let cleaned = false
    let keypressHandler: (chunk: string, key?: readline.Key) => void

    function ensureSelectionVisible() {
      const start = pageIndex * pageSize
      const end = Math.min(start + pageSize - 1, items.length - 1)
      if (selectionIndex < start) {
        selectionIndex = start
      }
      else if (selectionIndex > end) {
        selectionIndex = end
      }
    }

    function renderPage() {
      ensureSelectionVisible()
      const lines: string[] = []
      lines.push(`${pc.bold(title)} ${pc.dim(`(page ${pageIndex + 1}/${totalPages})`)}`)
      if (helpText) {
        lines.push(pc.dim(helpText))
      }
      lines.push('')

      const start = pageIndex * pageSize
      const end = Math.min(start + pageSize, items.length)
      for (let idx = start; idx < end; idx++) {
        const entryLines = renderLines(items[idx], idx)
        const isSelected = idx === selectionIndex
        entryLines.forEach((line, lineIdx) => {
          const pointer = lineIdx === 0 ? (isSelected ? pc.cyan('▸') : pc.dim('•')) : ' '
          const text = (() => {
            if (isSelected) {
              return lineIdx === 0 ? pc.cyan(pc.bold(line)) : pc.cyan(line)
            }
            return line
          })()
          lines.push(`${pointer} ${text}`)
        })
        lines.push('')
      }

      lines.push(pc.dim(`Page ${pageIndex + 1}/${totalPages}`))
      lines.push('')

      const frame = lines.join('\n')
      if (lastRenderLines > 0) {
        readline.moveCursor(ttyOutput, 0, -lastRenderLines)
        readline.clearScreenDown(ttyOutput)
      }
      ttyOutput.write(`${frame}\n`)
      lastRenderLines = lines.length + 1
    }

    const cleanup = () => {
      if (cleaned) {
        return
      }
      cleaned = true
      ttyInput.off('keypress', keypressHandler)
      if (!wasRaw) {
        ttyInput.setRawMode(false)
      }
      if (lastRenderLines > 0) {
        readline.moveCursor(ttyOutput, 0, -lastRenderLines)
        readline.clearScreenDown(ttyOutput)
        lastRenderLines = 0
      }
      ttyOutput.write('\n')
    }

    const finish = (choice?: T) => {
      cleanup()
      resolve(choice)
    }

    keypressHandler = (_chunk: string, key?: readline.Key) => {
      if (!key) {
        return
      }

      if (key.ctrl && key.name === 'c') {
        cleanup()
        process.kill(process.pid, 'SIGINT')
        return
      }

      switch (key.name) {
        case 'left':
        case 'pageup':
          if (pageIndex > 0) {
            pageIndex -= 1
            ensureSelectionVisible()
            renderPage()
          }
          return
        case 'right':
        case 'pagedown':
          if (pageIndex < totalPages - 1) {
            pageIndex += 1
            ensureSelectionVisible()
            renderPage()
          }
          return
        case 'up':
          if (selectionIndex > 0) {
            selectionIndex -= 1
            pageIndex = Math.floor(selectionIndex / pageSize)
            renderPage()
          }
          return
        case 'down':
          if (selectionIndex < items.length - 1) {
            selectionIndex += 1
            pageIndex = Math.floor(selectionIndex / pageSize)
            renderPage()
          }
          return
        case 'return':
        case 'enter':
          finish(items[selectionIndex])
          return
        case 'escape':
          finish(undefined)
          return
        case 'f':
          if (typeof onToggleFavorite === 'function') {
            const current = items[selectionIndex]
            if (current) {
              Promise.resolve(onToggleFavorite(current, selectionIndex))
                .then(() => {
                  ensureSelectionVisible()
                  renderPage()
                })
                .catch((error) => {
                  const message = error instanceof Error ? error.message : String(error)
                  logger.warn(`Favorite toggle failed: ${message}`)
                  ensureSelectionVisible()
                  renderPage()
                })
            }
          }
          return
        default:
          break
      }

      const sequence = key.sequence ?? ''
      if (/^[1-9]$/.test(sequence)) {
        const digit = Number(sequence)
        const start = pageIndex * pageSize
        const target = start + (digit - 1)
        if (target < items.length && target < start + pageSize) {
          selectionIndex = target
          renderPage()
        }
      }
    }

    ttyInput.on('keypress', keypressHandler)
    renderPage()
  })
}

export async function promptProjectSelection(
  projects: InteractiveProjectChoice[],
  options?: { onToggleFavorite?: (choice: InteractiveProjectChoice, index: number) => Promise<void> | void },
) {
  const helpText = options?.onToggleFavorite
    ? `${PAGER_HELP_TEXT}  ·  ${pc.yellow('★')} toggle favorite (${pc.cyan('f')})`
    : `${PAGER_HELP_TEXT}`
  return await selectFromPagedList(projects, {
    title: 'Select a project',
    pageSize: DEFAULT_PAGE_SIZE,
    formatItem: (choice, idx) => formatProjectLine(choice, idx),
    helpText,
    onToggleFavorite: options?.onToggleFavorite,
  })
}

export async function promptRepoListMode(
  hasFavorites: boolean,
  favoriteCount: number,
  activeProfileLabel?: string,
) {
  const profileInfo = activeProfileLabel ? ` (profile: ${pc.cyan(activeProfileLabel)})` : ''
  const choices = [
    { name: `All repositories${profileInfo}`, value: 'all' },
    {
      name: hasFavorites
        ? `★ Favorite repositories (${pc.yellow(String(favoriteCount))})`
        : '★ Favorite repositories (empty)',
      value: 'favorites',
    },
    { name: `${pc.blue('👥')} Manage profiles`, value: 'profiles' },
    { name: 'Cancel', value: 'cancel' },
  ]

  const result = await runPromptWithEsc(promptSelect, {
    message: 'Choose repository list',
    choices,
    default: hasFavorites ? 'favorites' : 'all',
    loop: false,
  })

  if (result.cancelled || result.value === 'cancel') {
    return undefined
  }
  return result.value as 'all' | 'favorites' | 'profiles'
}

export async function promptRepoActionMenu(choice: InteractiveProjectChoice) {
  const toggleLabel = choice.isFavorite
    ? `${pc.yellow('★')} Remove from favorites`
    : `${pc.yellow('☆')} Add to favorites`

  const result = await runPromptWithEsc(promptSelect, {
    message: `What do you want to do with ${choice.label}?`,
    choices: [
      { name: `${pc.cyan('📝')} Comment on merge request`, value: 'comment' },
      { name: `${pc.green('🚀')} Merge merge request`, value: 'merge' },
      { name: `${toggleLabel}`, value: 'toggle' },
      { name: `${pc.dim('↩')} Back to repository list`, value: 'back' },
      { name: `${pc.red('✖')} Exit`, value: 'cancel' },
    ],
    default: 'comment',
    loop: false,
  })

  if (result.cancelled) {
    return 'back'
  }

  return result.value as 'comment' | 'merge' | 'toggle' | 'back' | 'cancel'
}

export async function promptYesNo(message: string, defaultValue = false) {
  const result = await runPromptWithEsc(promptConfirm, {
    message,
    default: defaultValue,
  })

  if (result.cancelled) {
    return undefined
  }

  return result.value as boolean
}

export async function promptCommentBody(defaultMessage: string) {
  const result = await runPromptWithEsc(promptInput, {
    message: `Comment message (default: ${defaultMessage})`,
    default: defaultMessage,
  })

  if (result.cancelled) {
    return undefined
  }

  const text = (result.value ?? '').trim()
  return text.length > 0 ? text : defaultMessage
}
