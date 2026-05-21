import { describe, expect, it } from 'vitest'
import { defaultPacRescueLevelMaps, defaultPacRescueSettings } from './defaults'
import {
  canRescue,
  capMapTextCounts,
  chooseChaseDirection,
  chooseChaserDirection,
  chooseFleeDirection,
  chooseShortestPathDirection,
  mapCounts,
  parseMapText,
  rebalanceMapText,
  rescueCoinGoal,
  resizeMapText,
  requiredKeysForRescue,
  sanitizeSettings,
  wrapHorizontalTunnel,
  wrapVerticalTunnel,
} from './map'

const testMap = [
  '########',
  '#P....H#',
  '#.##...#',
  '#K C O #',
  '########',
].join('\n')

const oneKeyCompactMap = [
  '#########',
  '#O.K....#',
  '#.###...#',
  '#...#...#',
  '...#H#...',
  '#..#....#',
  '#..###..#',
  '#P...C.O#',
  '#########',
].join('\n')

describe('pac rescue map helpers', () => {
  it('parses player, hostage, collectibles, power pellets, and chasers', () => {
    const level = parseMapText(testMap)

    expect(level.width).toBe(8)
    expect(level.playerStart).toEqual({ x: 1, y: 1 })
    expect(level.hostage).toEqual({ x: 6, y: 1 })
    expect(level.chasers).toEqual([{ x: 3, y: 3 }])
    expect(level.coins.size).toBe(8)
    expect(level.keys.size).toBe(1)
    expect(level.powerPellets.size).toBe(1)
  })

  it('rebalance preserves existing row-major collectibles and adds missing items deterministically', () => {
    const rebalanced = rebalanceMapText(testMap, {
      ...defaultPacRescueSettings,
      chaserCount: 2,
      keyCount: 2,
      coinCount: 3,
      powerPelletCount: 2,
    })

    expect(mapCounts(rebalanced)).toEqual({ coins: 3, keys: 2, chasers: 2, powerPellets: 2 })
    expect(rebalanced.split('\n')[1]).toContain('P')
    expect(rebalanced.split('\n')[1]).toContain('H')
  })

  it('caps count sliders without adding missing map items', () => {
    const capped = capMapTextCounts(testMap, {
      ...defaultPacRescueSettings,
      chaserCount: 2,
      keyCount: 2,
      coinCount: 3,
      powerPelletCount: 2,
    })

    expect(mapCounts(capped)).toEqual({ coins: 3, keys: 1, chasers: 1, powerPellets: 1 })
  })

  it('checks rescue by required keys and configurable coin percentage', () => {
    const settings = { ...defaultPacRescueSettings, requiredKeys: 2, coinGoalPercent: 70 }

    expect(rescueCoinGoal(10, 70)).toBe(7)
    expect(canRescue({ coinsCollected: 6, totalCoins: 10, keysCollected: 2 }, settings)).toBe(false)
    expect(canRescue({ coinsCollected: 7, totalCoins: 10, keysCollected: 1 }, settings)).toBe(false)
    expect(canRescue({ coinsCollected: 7, totalCoins: 10, keysCollected: 2 }, settings)).toBe(true)
  })

  it('requires all actual map keys instead of the editable required-key value', () => {
    const progress = { coinsCollected: 7, totalCoins: 10, totalKeys: 3 }

    expect(requiredKeysForRescue({ ...progress, keysCollected: 2 }, defaultPacRescueSettings)).toBe(3)
    expect(canRescue({ ...progress, keysCollected: 2 }, defaultPacRescueSettings)).toBe(false)
    expect(canRescue({ ...progress, keysCollected: 3 }, defaultPacRescueSettings)).toBe(true)
    expect(requiredKeysForRescue({ coinsCollected: 7, totalCoins: 10, keysCollected: 1, totalKeys: 1 }, defaultPacRescueSettings)).toBe(1)
    expect(canRescue({ coinsCollected: 7, totalCoins: 10, keysCollected: 1, totalKeys: 1 }, defaultPacRescueSettings)).toBe(true)
  })

  it('rescues on the compact one-key map after collecting that one key and enough coins', () => {
    const level = parseMapText(oneKeyCompactMap)
    const settings = { ...defaultPacRescueSettings, requiredKeys: 2, coinGoalPercent: 30 }
    const totalCoins = level.coins.size

    expect(level.keys.size).toBe(1)
    expect(requiredKeysForRescue({ coinsCollected: 0, totalCoins, keysCollected: 0, totalKeys: level.keys.size }, settings)).toBe(1)
    expect(canRescue({ coinsCollected: rescueCoinGoal(totalCoins, settings.coinGoalPercent), totalCoins, keysCollected: 1, totalKeys: level.keys.size }, settings)).toBe(true)
  })

  it('sanitizes camera view tiles to full, 6x, 8x, 9x, or 12x style zoom ranges', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, cameraViewTiles: 0 }).cameraViewTiles).toBe(0)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, cameraViewTiles: 5 }).cameraViewTiles).toBe(6)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, cameraViewTiles: 8 }).cameraViewTiles).toBe(8)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, cameraViewTiles: 9 }).cameraViewTiles).toBe(9)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, cameraViewTiles: 20 }).cameraViewTiles).toBe(12)
  })

  it('sanitizes neon maze wall color choices', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'neon-pink' }).mazeWall).toBe('neon-pink')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'vacuum-orange' }).mazeWall).toBe('vacuum-orange')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'spotlight-cream' }).mazeWall).toBe('spotlight-cream')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'neon-teal' }).mazeWall).toBe('neon-teal')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'turquoise' }).mazeWall).toBe('turquoise')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'cobalt' }).mazeWall).toBe('cobalt')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'deep-navy' }).mazeWall).toBe('deep-navy')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeWall: 'mystery' as typeof defaultPacRescueSettings.mazeWall }).mazeWall).toBe('electric-blue')
  })

  it('sanitizes player cat artwork choices', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, playerSkin: 'eye-cat-bronze' }).playerSkin).toBe('eye-cat-bronze')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, playerSkin: 'eye-cat-white' }).playerSkin).toBe('eye-cat-white')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, playerSkin: 'eye-cat-plain' }).playerSkin).toBe('eye-cat-plain')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, playerSkin: 'mystery' as typeof defaultPacRescueSettings.playerSkin }).playerSkin).toBe('classic')
  })

  it('sanitizes transparent board color for background tests', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, mazeFloor: 'transparent' }).mazeFloor).toBe('transparent')
  })

  it('sanitizes coin artwork choices', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, coinSkin: 'coin' }).coinSkin).toBe('coin')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, coinSkin: 'vacuum-orange-dot' }).coinSkin).toBe('vacuum-orange-dot')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, coinSkin: 'mystery' as typeof defaultPacRescueSettings.coinSkin }).coinSkin).toBe('dot')
  })

  it('sanitizes stage backgrounds and board offsets', () => {
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackground: 'lab-smoke' }).stageBackground).toBe('lab-smoke')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackground: 'lab-compact' }).stageBackground).toBe('lab-compact')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackground: 'lab-final-ruin' }).stageBackground).toBe('lab-final-ruin')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackground: 'lab-final-ruin-2' }).stageBackground).toBe('lab-final-ruin-2')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackground: 'mystery' as typeof defaultPacRescueSettings.stageBackground }).stageBackground).toBe('none')
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackgroundScale: 20 }).stageBackgroundScale).toBe(60)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, stageBackgroundScale: 260 }).stageBackgroundScale).toBe(220)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, boardOffsetX: 999, boardOffsetY: -999 }).boardOffsetX).toBe(260)
    expect(sanitizeSettings({ ...defaultPacRescueSettings, boardOffsetX: 999, boardOffsetY: -999 }).boardOffsetY).toBe(-260)
  })

  it('ships seven default level maps with matching dimensions', () => {
    expect(defaultPacRescueLevelMaps).toHaveLength(7)
    expect(defaultPacRescueSettings.mazeColumns).toBe(6)
    expect(defaultPacRescueSettings.mazeRows).toBe(6)

    for (const levelMap of defaultPacRescueLevelMaps) {
      const rows = levelMap.mapText.split('\n')
      const width = rows[0].length
      const level = parseMapText(levelMap.mapText)

      expect(levelMap.name).toMatch(/^Level \d$/)
      expect(rows.every((row) => row.length === width)).toBe(true)
      expect(level.width).toBe(width)
      expect(level.height).toBe(rows.length)
      expect(level.keys.size).toBeGreaterThanOrEqual(1)
      expect(level.coins.size).toBeGreaterThanOrEqual(1)
    }
  })

  it('chooses a shortest-path chase direction through the maze', () => {
    const level = parseMapText([
      '########',
      '#P    H#',
      '# ###  #',
      '# C    #',
      '########',
    ].join('\n'))

    expect(chooseChaseDirection(level, { x: 2, y: 3 }, { x: 5, y: 1 })).toEqual({ x: 1, y: 0 })
    expect(chooseChaseDirection(level, { x: 2, y: 3 }, { x: 2, y: 1 })).toEqual({ x: -1, y: 0 })
  })

  it('routes ghosts through the pasted compact map instead of getting stuck on edge starts', () => {
    const level = parseMapText([
      '#####C#######',
      '#...#......K#',
      '#.#.#.##.##.#',
      '#.#.#.#.....#',
      '#........##.#',
      '#.#..###.#..#',
      '#.##.#H....OC',
      '#....###..###',
      '#.#.........#',
      '#.#.#.##.##.#',
      '#P..........#',
      '#############',
    ].join('\n'))

    expect(chooseShortestPathDirection(level, { x: 5, y: 0 }, level.playerStart)).toEqual({ x: 0, y: 1 })
    expect(chooseShortestPathDirection(level, { x: 12, y: 6 }, level.playerStart)).toEqual({ x: -1, y: 0 })
    expect(chooseChaserDirection(level, { x: 5, y: 0 }, level.playerStart, { x: 0, y: 0 }, Number.POSITIVE_INFINITY, true, 0, false, level.playerStart)).toEqual({ x: 0, y: 1 })
  })

  it('runs away from the player while frightened', () => {
    const level = parseMapText([
      '########',
      '#P    H#',
      '#      #',
      '#  C   #',
      '########',
    ].join('\n'))

    expect(chooseFleeDirection(level, { x: 3, y: 3 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 0 })
    expect(chooseChaserDirection(level, { x: 3, y: 3 }, { x: 1, y: 1 }, { x: -1, y: 0 }, 8, false, 0, true)).toEqual({ x: 1, y: 0 })
  })

  it('resizes maps to exact dimensions while preserving player and hostage', () => {
    const resized = resizeMapText(testMap, 14, 12)
    const level = parseMapText(resized)

    expect(level.width).toBe(14)
    expect(level.height).toBe(12)
    expect(resized.split('\n')).toHaveLength(12)
    expect(resized.split('\n').every((row) => row.length === 14)).toBe(true)
    expect(level.rows.flat().filter((tile) => tile === 'P')).toHaveLength(1)
    expect(level.rows.flat().filter((tile) => tile === 'H')).toHaveLength(1)
  })

  it('clips maps while restoring required actor markers', () => {
    const resized = resizeMapText(testMap, 5, 5)
    const level = parseMapText(resized)

    expect(level.width).toBe(13)
    expect(level.height).toBe(11)
    expect(level.rows.flat().filter((tile) => tile === 'P')).toHaveLength(1)
    expect(level.rows.flat().filter((tile) => tile === 'H')).toHaveLength(1)
  })

  it('caps counts as part of resizing without adding missing items', () => {
    const resized = resizeMapText(testMap, 14, 12, {
      ...defaultPacRescueSettings,
      chaserCount: 2,
      keyCount: 2,
      coinCount: 6,
      powerPelletCount: 2,
    })

    expect(mapCounts(resized)).toEqual({ coins: 6, keys: 1, chasers: 1, powerPellets: 1 })
  })

  it('wraps horizontally only on open tunnel rows', () => {
    const level = parseMapText([
      '#######',
      '#P H  #',
      '       ',
      '#######',
    ].join('\n'))

    expect(wrapHorizontalTunnel(level, { x: -0.6, y: 2 })).toEqual({ x: 6.5, y: 2 })
    expect(wrapHorizontalTunnel(level, { x: 6.6, y: 2 })).toEqual({ x: -0.5, y: 2 })
    expect(wrapHorizontalTunnel(level, { x: -0.6, y: 1 })).toEqual({ x: -0.6, y: 1 })
  })

  it('wraps vertically only on open tunnel columns', () => {
    const level = parseMapText([
      '### ###',
      '#P H  #',
      '#######',
      '### ###',
    ].join('\n'))

    expect(wrapVerticalTunnel(level, { x: 3, y: -0.6 })).toEqual({ x: 3, y: 3.5 })
    expect(wrapVerticalTunnel(level, { x: 3, y: 3.6 })).toEqual({ x: 3, y: -0.5 })
    expect(wrapVerticalTunnel(level, { x: 1, y: -0.6 })).toEqual({ x: 1, y: -0.6 })
  })
})
