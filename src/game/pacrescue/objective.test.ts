import { describe, expect, it } from 'vitest'
import { defaultPacRescueSettings } from './defaults'
import { parseMapText, pointKey, rescueCoinGoal } from './map'
import {
  collectCoin,
  collectVisibleKey,
  collectedCoins,
  createDelayedKeyState,
  isBlockedRescueTile,
  isInRescueZone,
  keyProgress,
  maybeRevealLockedKey,
  resolveLifeHit,
} from './objective'

const keyMap = [
  '#######',
  '#P.K.H#',
  '#.....#',
  '#..K..#',
  '#######',
].join('\n')

describe('pac rescue objective helpers', () => {
  it('hides the last row-major key and replaces it with a coin', () => {
    const state = createDelayedKeyState(parseMapText(keyMap))

    expect(state.lockedKey).toBe(pointKey({ x: 3, y: 3 }))
    expect(state.visibleKeys.has(pointKey({ x: 3, y: 1 }))).toBe(true)
    expect(state.visibleKeys.has(pointKey({ x: 3, y: 3 }))).toBe(false)
    expect(state.coins.has(pointKey({ x: 3, y: 3 }))).toBe(true)
    expect(state.totalCoins).toBe(12)
  })

  it('uses total coins including the hidden key replacement coin for the goal', () => {
    const state = createDelayedKeyState(parseMapText(keyMap))

    expect(rescueCoinGoal(state.totalCoins, 50)).toBe(6)
  })

  it('reveals and collects the hidden key after the visible key and coin threshold are reached', () => {
    const state = createDelayedKeyState(parseMapText(keyMap))
    const settings = { ...defaultPacRescueSettings, coinGoalPercent: 50 }

    for (const key of [...state.coins].slice(0, 6)) {
      collectCoin(state, key)
    }

    expect(collectedCoins(state)).toBe(6)
    expect(maybeRevealLockedKey(state, settings)).toBe(false)
    expect(collectVisibleKey(state, pointKey({ x: 3, y: 1 }))).toBe(true)
    expect(maybeRevealLockedKey(state, settings)).toBe(true)
    expect(state.coins.has(state.lockedKey!)).toBe(false)
    expect(collectedCoins(state)).toBe(7)
    expect(state.visibleKeys.has(state.lockedKey!)).toBe(true)
    expect(collectVisibleKey(state, state.lockedKey!)).toBe(true)
    expect(keyProgress(state).keysCollected).toBe(2)
  })

  it('resolves powered, invincible, normal, and final life hits', () => {
    expect(resolveLifeHit(3, true, false)).toEqual({ type: 'eat-ghost', lives: 3 })
    expect(resolveLifeHit(3, false, true)).toEqual({ type: 'ignored', lives: 3 })
    expect(resolveLifeHit(3, false, false)).toEqual({ type: 'lose-life', lives: 2, gameover: false })
    expect(resolveLifeHit(1, false, false)).toEqual({ type: 'lose-life', lives: 0, gameover: true })
  })

  it('blocks the rescue-zone square until requirements are met', () => {
    const settings = { ...defaultPacRescueSettings, rescueZoneSize: 3, requiredKeys: 2, coinGoalPercent: 50 }
    const hostage = { x: 5, y: 5 }

    expect(isInRescueZone({ x: 4, y: 4 }, hostage, 3)).toBe(true)
    expect(isInRescueZone({ x: 6, y: 6 }, hostage, 3)).toBe(true)
    expect(isInRescueZone({ x: 7, y: 5 }, hostage, 3)).toBe(false)
    expect(isBlockedRescueTile({ x: 5, y: 5 }, hostage, { coinsCollected: 4, totalCoins: 10, keysCollected: 2 }, settings)).toBe(true)
    expect(isBlockedRescueTile({ x: 5, y: 5 }, hostage, { coinsCollected: 5, totalCoins: 10, keysCollected: 2 }, settings)).toBe(false)
  })
})
