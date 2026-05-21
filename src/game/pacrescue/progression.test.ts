import { describe, expect, it } from 'vitest'
import { defaultPacRescueLevelMaps } from './defaults'
import { hasNextLevel, nextLevelIndex } from './progression'

describe('pac rescue level progression', () => {
  it('advances from level 1 to level 2', () => {
    expect(nextLevelIndex(0, defaultPacRescueLevelMaps.length)).toBe(1)
    expect(hasNextLevel(0, defaultPacRescueLevelMaps.length)).toBe(true)
  })

  it('does not advance past the final level', () => {
    const finalIndex = defaultPacRescueLevelMaps.length - 1

    expect(nextLevelIndex(finalIndex, defaultPacRescueLevelMaps.length)).toBeUndefined()
    expect(hasNextLevel(finalIndex, defaultPacRescueLevelMaps.length)).toBe(false)
  })
})
