// @vitest-environment node
import type { FavoriteProjectRecord } from '../favorites'
import { describe, expect, it } from 'vitest'
import { sortFavoriteRecords } from '../interactive/helpers'

describe('sortFavoriteRecords', () => {
  it('sorts by lastUsedAt desc then lastActivity desc', () => {
    const records: FavoriteProjectRecord[] = [
      { projectRef: 'alpha', label: 'Alpha', lastUsedAt: '2024-01-01T00:00:00Z' },
      { projectRef: 'beta', label: 'Beta', lastUsedAt: '2024-01-05T00:00:00Z' },
      { projectRef: 'gamma', label: 'Gamma', lastActivity: '2025-01-01T00:00:00Z' },
      { projectRef: 'delta', label: 'Delta', lastActivity: '2024-01-10T00:00:00Z' },
    ]

    const result = sortFavoriteRecords(records)
    expect(result.map(record => record.projectRef)).toEqual(['beta', 'alpha', 'gamma', 'delta'])
  })

  it('falls back to label and projectRef when timestamps are missing', () => {
    const records: FavoriteProjectRecord[] = [
      { projectRef: 'bravo', label: 'Bravo' },
      { projectRef: 'alpha', label: 'Alpha' },
      { projectRef: 'charlie' },
    ]

    const result = sortFavoriteRecords(records)
    expect(result.map(record => record.projectRef)).toEqual(['alpha', 'bravo', 'charlie'])
  })
})
