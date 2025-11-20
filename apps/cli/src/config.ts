import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { loadConfig } from 'c12'
import { getGlobalConfigPath } from './bootstrap.js'

export interface GitlabConfigInput {
  projectId?: string
  projectPath?: string
  baseUrl?: string
  token?: string
}

export interface GitlabConfig {
  baseUrl: string
  token: string
  projectRef: string
}

export interface MultiProfileInput {
  // Comma-separated names are allowed (parsed by resolver)
  profile?: string
  allProfiles?: boolean
}

export interface GitlabCliProfile {
  baseUrl?: string
  token?: string
  projectId?: string
  projectPath?: string
  displayName?: string
  email?: string
  username?: string
}

export interface GitlabCliConfig extends GitlabCliProfile {
  // Default profile name to use when multiple exist and no --profile is passed.
  defaultProfile?: string
  // Named profiles map
  profiles?: Record<string, GitlabCliProfile>
}

function normalize(value?: string | null) {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function readGlobalFallbackConfig(): Promise<GitlabCliConfig> {
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

async function loadC12Config(): Promise<GitlabCliConfig> {
  const { config } = await loadConfig<GitlabCliConfig>({
    name: 'gitlab-cli',
    // Look for local and global RC/config files (e.g. ~/.config/gitlab-cli/*, ~/.gitlab-clirc)
    globalRc: true,
    // We deliberately do not auto-load .env here to avoid implicit env coupling.
    dotenv: false,
  })
  const normalized = config || {}
  if (Object.keys(normalized).length > 0) {
    return normalized
  }
  return await readGlobalFallbackConfig()
}

export function resolveGitlabConfig(options: GitlabConfigInput): GitlabConfig {
  const baseUrl = normalize(options.baseUrl)
    ?? normalize(process.env.GITLAB_BASE_URL)
    ?? 'https://gitlab.com'
  const token = normalize(options.token) ?? normalize(process.env.GITLAB_TOKEN)
  const projectRef = normalize(options.projectId)
    ?? normalize(options.projectPath)
    ?? normalize(process.env.GITLAB_PROJECT_ID)
    ?? normalize(process.env.GITLAB_PROJECT_PATH)

  if (!token) {
    throw new Error('Missing GitLab token. Provide --token or set GITLAB_TOKEN.')
  }

  if (!projectRef) {
    throw new Error('Missing project reference. Use --project-id/--project-path or env variables.')
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') || baseUrl

  return {
    baseUrl: normalizedBaseUrl,
    token,
    projectRef,
  }
}

/**
 * Parse a comma-separated list into an array of trimmed, non-empty values.
 */
function parseCsv(value?: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
}

function envKeyForProfile(profileName: string, key: 'TOKEN' | 'PROJECT_ID' | 'PROJECT_PATH' | 'BASE_URL') {
  // Transform profile name to an env-friendly suffix (A-Z, 0-9, _)
  const upper = profileName.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return `GITLAB_${upper}_${key}`
}

export interface ResolvedProfile {
  name?: string
  baseUrl: string
  token: string
  projectRef?: string
}

interface ResolveProfilesOptions {
  requireProject?: boolean
}

/**
 * Resolve one or multiple GitLab configs. Precedence:
 * 1) Explicit CLI overrides (--token/--project-id/--project-path/--base-url) -> single config
 * 2) Config file(s) via c12 (local + global) -> profiles or top-level config
 * 3) --profile / --all-profiles + $GITLAB_PROFILES (env-based multi-profile)
 * 4) Legacy single envs ($GITLAB_TOKEN/$GITLAB_PROJECT_ID/$GITLAB_PROJECT_PATH)
 */
export async function resolveGitlabProfiles(
  options: GitlabConfigInput & MultiProfileInput,
  { requireProject = true }: ResolveProfilesOptions = {},
): Promise<ResolvedProfile[]> {
  const projectOverride = normalize(options.projectId) ?? normalize(options.projectPath)
  const explicitToken = normalize(options.token)
  const explicitBaseUrl = normalize(options.baseUrl)

  // If the user explicitly provides token/base-url via CLI, treat as a single config for backward compatibility
  if (explicitToken || explicitBaseUrl) {
    return [resolveGitlabConfig(options)]
  }

  // 2) c12-config: prefer configured profiles/top-level defaults over env
  const fileConfig = await loadC12Config()
  const configuredProfiles = fileConfig.profiles ? Object.keys(fileConfig.profiles) : []

  // Determine requested profile names
  const requestedProfilesFromFlag = parseCsv(normalize(options.profile))
  const requestedProfilesFromConfigDefault
    = configuredProfiles.length > 0
      ? [normalize(fileConfig.defaultProfile) ?? configuredProfiles[0]].filter(Boolean) as string[]
      : []

  const requestedProfiles = options.allProfiles
    ? configuredProfiles
    : (requestedProfilesFromFlag.length > 0 ? requestedProfilesFromFlag : requestedProfilesFromConfigDefault)

  // Try resolving from config profiles first
  if (requestedProfiles.length > 0) {
    const resolvedFromConfig: ResolvedProfile[] = []
    for (const name of requestedProfiles) {
      const profile = fileConfig.profiles?.[name]
      if (!profile) {
        // Will fall back to env-based profile below if missing
        continue
      }
      const baseUrl = normalize(profile.baseUrl)
        ?? normalize(fileConfig.baseUrl)
        ?? 'https://gitlab.com'
      const token = normalize(profile.token) ?? normalize(fileConfig.token)
      const projectRefFromConfig = normalize(profile.projectId)
        ?? normalize(profile.projectPath)
        ?? normalize(fileConfig.projectId)
        ?? normalize(fileConfig.projectPath)
      const projectRef = projectOverride ?? projectRefFromConfig

      if (!token) {
        throw new Error(`Missing token for profile "${name}" in config.`)
      }
      if (!projectRef && requireProject) {
        throw new Error(`Missing project reference for profile "${name}" in config. Provide --project-id/--project-path to override.`)
      }
      const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') || baseUrl
      resolvedFromConfig.push({
        name,
        baseUrl: normalizedBaseUrl,
        token,
        projectRef,
      })
    }
    if (resolvedFromConfig.length > 0) {
      return resolvedFromConfig
    }
  }

  // If no configured profile matched, try top-level config as single profile
  {
    const baseUrl = normalize(fileConfig.baseUrl) ?? 'https://gitlab.com'
    const token = normalize(fileConfig.token)
    const projectRefFromConfig = normalize(fileConfig.projectId) ?? normalize(fileConfig.projectPath)
    const projectRef = projectOverride ?? projectRefFromConfig
    if (token && (projectRef || !requireProject)) {
      const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') || baseUrl
      return [
        {
          baseUrl: normalizedBaseUrl,
          token,
          projectRef,
        },
      ]
    }
  }

  const profilesEnv = normalize(process.env.GITLAB_PROFILES)
  const declaredProfiles = parseCsv(profilesEnv)

  const requestedProfilesEnv = options.allProfiles
    ? declaredProfiles
    : (() => {
        const fromFlag = requestedProfilesFromFlag
        if (fromFlag.length > 0) {
          return fromFlag
        }
        return declaredProfiles.length > 0 ? [declaredProfiles[0]] : []
      })()

  // If profiles are requested or declared, try to resolve via per-profile env vars
  if (requestedProfilesEnv.length > 0) {
    const resolved: ResolvedProfile[] = []
    for (const name of requestedProfilesEnv) {
      const token = normalize(process.env[envKeyForProfile(name, 'TOKEN')])
      const projectIdEnv = normalize(process.env[envKeyForProfile(name, 'PROJECT_ID')])
      const projectPathEnv = normalize(process.env[envKeyForProfile(name, 'PROJECT_PATH')])
      const baseUrl = normalize(process.env[envKeyForProfile(name, 'BASE_URL')])
        ?? normalize(process.env.GITLAB_BASE_URL)
        ?? 'https://gitlab.com'

      if (!token) {
        throw new Error(`Missing token for profile "${name}". Set ${envKeyForProfile(name, 'TOKEN')}.`)
      }
      const projectRefEnv = projectIdEnv ?? projectPathEnv
      const projectRef = projectOverride ?? projectRefEnv
      if (!projectRef && requireProject) {
        throw new Error(
          `Missing project reference for profile "${name}". Set ${envKeyForProfile(name, 'PROJECT_ID')} or ${envKeyForProfile(name, 'PROJECT_PATH')}, or provide --project-id/--project-path.`,
        )
      }

      const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') || baseUrl
      resolved.push({
        name,
        baseUrl: normalizedBaseUrl,
        token,
        projectRef,
      })
    }

    if (resolved.length > 0) {
      return resolved
    }
  }

  // Fallback to legacy single-env resolution
  const baseUrl = normalize(options.baseUrl)
    ?? normalize(process.env.GITLAB_BASE_URL)
    ?? 'https://gitlab.com'
  const token = normalize(options.token) ?? normalize(process.env.GITLAB_TOKEN)
  const projectRef = projectOverride
    ?? normalize(process.env.GITLAB_PROJECT_ID)
    ?? normalize(process.env.GITLAB_PROJECT_PATH)

  if (token && (projectRef || !requireProject)) {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') || baseUrl
    return [
      {
        baseUrl: normalizedBaseUrl,
        token,
        projectRef,
      },
    ]
  }

  return [resolveGitlabConfig(options)]
}
