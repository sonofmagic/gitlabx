import pc from 'picocolors'

const prefix = pc.cyan('[gitlab-cli]')

function logWith(method: 'info' | 'warn' | 'error', message: string) {
  console[method](`${prefix} ${message}`)
}

export const logger = {
  info(message: string) {
    logWith('info', message)
  },
  warn(message: string) {
    logWith('warn', pc.yellow(message))
  },
  error(message: string) {
    logWith('error', pc.red(message))
  },
  success(message: string) {
    logWith('info', pc.green(message))
  },
}
