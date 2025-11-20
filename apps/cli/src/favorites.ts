import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getGlobalConfigPath } from './bootstrap'

export interface FavoriteProjectRecord {
  projectRef: string
  profile?: string
  label?: string
  webUrl?: string
  lastActivity?: string
}

const FAVORITES_FILE = path.join(getGlobalConfigPath().dir, 'favorites.json')

function normalizeFavoriteProfile(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeFavoriteRecord(value: unknown): FavoriteProjectRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.projectRef !== 'string') {
    return undefined
  }
  const projectRef = record.projectRef.trim()
  if (!projectRef) {
    return undefined
  }
  const profile = normalizeFavoriteProfile(record.profile)
  const label = typeof record.label === 'string' ? record.label : undefined
  const webUrl = typeof record.webUrl === 'string' ? record.webUrl : undefined
  const lastActivity = typeof record.lastActivity === 'string' ? record.lastActivity : undefined

  return {
    projectRef,
    profile,
    label,
    webUrl,
    lastActivity,
  }
}

export async function loadFavoriteProjects(): Promise<FavoriteProjectRecord[]> {
  try {
    const raw = await readFile(FAVORITES_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map(normalizeFavoriteRecord)
      .filter((record): record is FavoriteProjectRecord => Boolean(record))
  }
  catch {
    return []
  }
}

export async function saveFavoriteProjects(records: FavoriteProjectRecord[]) {
  const dir = path.dirname(FAVORITES_FILE)
  await mkdir(dir, { recursive: true })
  await writeFile(FAVORITES_FILE, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

export function favoriteKey(projectRef: string, profile?: string | null) {
  const normalizedProfile = profile && profile.trim().length > 0 ? profile.trim() : 'default'
  return `${normalizedProfile}:::${projectRef}`
}
