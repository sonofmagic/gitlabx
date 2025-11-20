import process from 'node:process'
import { logger } from './logger'
import { isGitbeakerError } from './shared'

export function handleCliError(error: unknown) {
  if (isGitbeakerError(error)) {
    const status = error.response?.status
    const body = typeof error.response?.body === 'string'
      ? error.response.body
      : JSON.stringify(error.response?.body)
    const details = [error.message || error.description, status && `status: ${status}`, body]
      .filter(Boolean)
      .join(' | ')
    logger.error(details || 'GitLab request failed')
  }
  else if (error instanceof Error) {
    logger.error(error.message)
  }
  else {
    logger.error('Unknown error occurred')
  }

  process.exitCode = 1
}
