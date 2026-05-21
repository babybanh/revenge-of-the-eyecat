import { canRescue, pointKey, requiredKeysForRescue, rescueCoinGoal } from './map'
import type { GridPoint, InstructionPhase, PacRescueLevel, PacRescueSettings, RescueProgress } from './types'

export type DelayedKeyState = {
  lockedKey?: string
  lockedKeyRevealed: boolean
  visibleKeys: Set<string>
  uncollectedKeys: Set<string>
  coins: Set<string>
  totalKeys: number
  totalCoins: number
}

export type LifeHitResult =
  | { type: 'ignored'; lives: number }
  | { type: 'eat-ghost'; lives: number }
  | { type: 'lose-life'; lives: number; gameover: boolean }

export function rowMajorKeys(level: PacRescueLevel): GridPoint[] {
  return [...level.keys]
    .map(parseKey)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

export function createDelayedKeyState(level: PacRescueLevel): DelayedKeyState {
  const keys = rowMajorKeys(level)
  const lockedKey = keys.length > 1 ? pointKey(keys[keys.length - 1]) : undefined
  const visibleKeys = new Set(level.keys)
  const uncollectedKeys = new Set(level.keys)
  const coins = new Set(level.coins)

  if (lockedKey) {
    visibleKeys.delete(lockedKey)
    coins.add(lockedKey)
  }

  return {
    lockedKey,
    lockedKeyRevealed: !lockedKey,
    visibleKeys,
    uncollectedKeys,
    coins,
    totalKeys: keys.length,
    totalCoins: coins.size,
  }
}

export function collectedCoins(state: DelayedKeyState): number {
  return state.totalCoins - state.coins.size
}

export function collectedKeys(state: DelayedKeyState): number {
  return state.totalKeys - state.uncollectedKeys.size
}

export function visibleUncollectedKeys(state: DelayedKeyState): Set<string> {
  return new Set([...state.visibleKeys].filter((key) => state.uncollectedKeys.has(key)))
}

export function collectCoin(state: DelayedKeyState, key: string): boolean {
  return state.coins.delete(key)
}

export function collectVisibleKey(state: DelayedKeyState, key: string): boolean {
  if (!state.visibleKeys.has(key)) {
    return false
  }
  return state.uncollectedKeys.delete(key)
}

export function maybeRevealLockedKey(state: DelayedKeyState, settings: PacRescueSettings): boolean {
  if (!state.lockedKey || state.lockedKeyRevealed) {
    return false
  }
  if (collectedCoins(state) < rescueCoinGoal(state.totalCoins, settings.coinGoalPercent)) {
    return false
  }

  state.visibleKeys.add(state.lockedKey)
  state.coins.delete(state.lockedKey)
  state.lockedKeyRevealed = true
  return true
}

export function keyProgress(state: DelayedKeyState): { keysCollected: number; keysVisible: number } {
  return {
    keysCollected: collectedKeys(state),
    keysVisible: visibleUncollectedKeys(state).size,
  }
}

export function instructionForProgress(
  progress: RescueProgress,
  settings: PacRescueSettings,
  phase: InstructionPhase,
  hasHiddenKey: boolean,
): { phase: InstructionPhase; text: string } {
  if (phase === 'won') {
    return { phase, text: 'Cat hostage rescued.' }
  }
  if (phase === 'gameover') {
    return { phase, text: 'No hearts left. Try the rescue again.' }
  }
  if (phase === 'lost-life') {
    return { phase, text: 'Caught by a vacuum. Back to the start.' }
  }
  const requiredKeys = requiredKeysForRescue(progress, settings)
  if (progress.keysCollected >= requiredKeys && progress.coinsCollected >= rescueCoinGoal(progress.totalCoins, settings.coinGoalPercent)) {
    return { phase: 'rescue', text: 'Rescue the cat hostage.' }
  }
  if (phase === 'blocked') {
    return { phase, text: 'Collect the keys and coins before reaching the cat.' }
  }
  if (hasHiddenKey) {
    return { phase: 'collect-coins', text: 'Collect more coins to reveal the last key.' }
  }
  if (progress.keysCollected >= requiredKeys) {
    return { phase: 'all-keys', text: 'All keys collected. Keep collecting coins.' }
  }
  if (phase === 'key-appeared') {
    return { phase, text: 'The last key appeared.' }
  }
  return { phase: 'find-key', text: 'Find the key to rescue the cat.' }
}

export function resolveLifeHit(lives: number, powered: boolean, invincible: boolean): LifeHitResult {
  if (invincible) {
    return { type: 'ignored', lives }
  }
  if (powered) {
    return { type: 'eat-ghost', lives }
  }

  const nextLives = Math.max(0, lives - 1)
  return { type: 'lose-life', lives: nextLives, gameover: nextLives <= 0 }
}

export function isInRescueZone(point: GridPoint, hostage: GridPoint, rescueZoneSize: number): boolean {
  const size = Math.max(1, Math.round(rescueZoneSize))
  const before = Math.floor((size - 1) / 2)
  const after = Math.ceil((size - 1) / 2)
  return point.x >= hostage.x - before
    && point.x <= hostage.x + after
    && point.y >= hostage.y - before
    && point.y <= hostage.y + after
}

export function isBlockedRescueTile(point: GridPoint, hostage: GridPoint, progress: RescueProgress, settings: PacRescueSettings): boolean {
  return isInRescueZone(point, hostage, settings.rescueZoneSize) && !canRescue(progress, settings)
}

function parseKey(key: string): GridPoint {
  const [x, y] = key.split(',').map(Number)
  return { x, y }
}
