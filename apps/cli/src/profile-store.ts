import type { GitlabCliConfig, GitlabCliProfile } from './config.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getGlobalConfigPath } from './bootstrap.js'

export interface StoredProfile extends GitlabCliProfile {
  displayName?: string
  email?: string
  username?: string
}

interface RawProfileStore extends GitlabCliConfig {
  profiles?: Record<string, StoredProfile>
}

export interface ProfileSummary {
  name: string
  profile: StoredProfile
  isDefault: boolean
}

async function readConfigFile(): Promise<RawProfileStore> {
  const { file } = getGlobalConfigPath()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  }
  catch {
    return {}
  }
}

async function writeConfigFile(config: RawProfileStore) {
  const { dir, file } = getGlobalConfigPath()
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export async function loadProfileStore() {
  const config = await readConfigFile()
  return config
}

export async function saveProfileStore(config: RawProfileStore) {
  await writeConfigFile(config)
}

export function listProfiles(config: RawProfileStore): ProfileSummary[] {
  const profiles = config.profiles ?? {}
  const entries = Object.entries(profiles)
  const defaultName = config.defaultProfile
  const summaries = entries.map(([name, profile]) => ({
    name,
    profile,
    isDefault: defaultName === name,
  }))

  const hasFallback
    = entries.length === 0
      && (config.token || config.baseUrl || config.projectId || config.projectPath)
  if (hasFallback) {
    summaries.push({
      name: 'default',
      profile: {
        baseUrl: config.baseUrl,
        token: config.token,
        projectId: config.projectId,
        projectPath: config.projectPath,
      },
      isDefault: !defaultName || defaultName === 'default',
    })
  }
  return summaries
}

export function ensureProfilesObject(config: RawProfileStore) {
  if (!config.profiles) {
    config.profiles = {}
  }
  return config.profiles
}

export function deleteProfile(config: RawProfileStore, name: string) {
  if (!config.profiles) {
    return
  }
  delete config.profiles[name]
  if (config.defaultProfile === name) {
    config.defaultProfile = Object.keys(config.profiles)[0]
  }
}

export function upsertProfile(
  config: RawProfileStore,
  name: string,
  profile: StoredProfile,
) {
  const profiles = ensureProfilesObject(config)
  profiles[name] = profile
  if (!config.defaultProfile) {
    config.defaultProfile = name
  }
}

export function setDefaultProfile(config: RawProfileStore, name?: string) {
  if (!name) {
    delete config.defaultProfile
    return
  }
  config.defaultProfile = name
}
