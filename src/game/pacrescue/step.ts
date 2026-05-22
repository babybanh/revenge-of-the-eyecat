import { directions, isHorizontalTunnelRow, isVerticalTunnelColumn, isWall, pointKey, sameDirection } from './map'
import type { Direction, GhostType, GridPoint, PacRescueLevel } from './types'

export type StepActor = {
  tile: GridPoint
  nextTile: GridPoint
  direction: Direction
  moveProgress: number
}

export type CollisionResult = 'none' | 'normal-hit' | 'powered-eat'
export type TileBlocker = (point: GridPoint) => boolean

export const BONUS_POWER_PELLET_EATEN_THRESHOLD = 3
export const stoppedDirection: Direction = { x: 0, y: 0 }

export function createStepActor(tile: GridPoint, direction: Direction = stoppedDirection): StepActor {
  return {
    tile: { ...tile },
    nextTile: { ...tile },
    direction: { ...direction },
    moveProgress: 0,
  }
}

export function sameTile(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y
}

export function isMoving(actor: StepActor): boolean {
  return !sameTile(actor.tile, actor.nextTile)
}

export function stepTarget(level: PacRescueLevel, tile: GridPoint, direction: Direction, isBlocked?: TileBlocker): GridPoint | undefined {
  let x = tile.x + direction.x
  let y = tile.y + direction.y

  if (direction.x !== 0 && isHorizontalTunnelRow(level, tile.y)) {
    if (x < 0) x = level.width - 1
    if (x >= level.width) x = 0
  }

  if (direction.y !== 0 && isVerticalTunnelColumn(level, tile.x)) {
    if (y < 0) y = level.height - 1
    if (y >= level.height) y = 0
  }

  const target = { x, y }
  if (x < 0 || y < 0 || x >= level.width || y >= level.height || isWall(level, x, y) || isBlocked?.(target)) {
    return undefined
  }

  return target
}

export function legalStepDirections(level: PacRescueLevel, tile: GridPoint, isBlocked?: TileBlocker): Direction[] {
  return directions.filter((direction) => stepTarget(level, tile, direction, isBlocked))
}

export function beginStep(actor: StepActor, direction: Direction, level: PacRescueLevel, isBlocked?: TileBlocker): StepActor {
  const nextTile = stepTarget(level, actor.tile, direction, isBlocked)
  if (!nextTile) {
    return {
      ...actor,
      nextTile: { ...actor.tile },
      direction: { ...stoppedDirection },
      moveProgress: 0,
    }
  }

  return {
    ...actor,
    nextTile,
    direction: { ...direction },
    moveProgress: 0,
  }
}

export function advanceStep(actor: StepActor, speedTilesPerSecond: number, deltaSeconds: number): { actor: StepActor; arrived: boolean } {
  if (!isMoving(actor)) {
    return { actor, arrived: false }
  }

  const progress = actor.moveProgress + Math.max(0, speedTilesPerSecond) * Math.max(0, deltaSeconds)
  if (progress < 1) {
    return { actor: { ...actor, moveProgress: progress }, arrived: false }
  }

  return {
    actor: {
      tile: { ...actor.nextTile },
      nextTile: { ...actor.nextTile },
      direction: { ...actor.direction },
      moveProgress: 0,
    },
    arrived: true,
  }
}

export function actorPosition(actor: StepActor, level?: PacRescueLevel): GridPoint {
  if (!isMoving(actor)) {
    return { ...actor.tile }
  }

  let targetX = actor.nextTile.x
  let targetY = actor.nextTile.y
  if (level && Math.abs(targetX - actor.tile.x) > 1 && isHorizontalTunnelRow(level, actor.tile.y)) {
    targetX = actor.nextTile.x > actor.tile.x ? -1 : level.width
  }
  if (level && Math.abs(targetY - actor.tile.y) > 1 && isVerticalTunnelColumn(level, actor.tile.x)) {
    targetY = actor.nextTile.y > actor.tile.y ? -1 : level.height
  }

  return {
    x: actor.tile.x + (targetX - actor.tile.x) * actor.moveProgress,
    y: actor.tile.y + (targetY - actor.tile.y) * actor.moveProgress,
  }
}

export function chooseGhostStep(level: PacRescueLevel, ghostTile: GridPoint, playerTile: GridPoint, isBlocked?: TileBlocker): Direction {
  const path = shortestPathDirection(level, ghostTile, playerTile, isBlocked)
  if (path) {
    return path
  }

  return legalStepDirections(level, ghostTile, isBlocked)[0] ?? stoppedDirection
}

export function chooseFleeStep(level: PacRescueLevel, ghostTile: GridPoint, playerTile: GridPoint, isBlocked?: TileBlocker): Direction {
  const legal = legalStepDirections(level, ghostTile, isBlocked)
  if (legal.length === 0) {
    return stoppedDirection
  }

  return [...legal].sort((a, b) => {
    const nextA = stepTarget(level, ghostTile, a, isBlocked) ?? ghostTile
    const nextB = stepTarget(level, ghostTile, b, isBlocked) ?? ghostTile
    const distanceA = bfsDistance(level, nextA, playerTile) ?? Number.POSITIVE_INFINITY
    const distanceB = bfsDistance(level, nextB, playerTile) ?? Number.POSITIVE_INFINITY
    if (distanceA !== distanceB) {
      return distanceB - distanceA
    }
    return euclideanDistance(nextB, playerTile) - euclideanDistance(nextA, playerTile)
  })[0]
}

export function choosePatrollerStep(level: PacRescueLevel, ghostTile: GridPoint, current: Direction, turnSeed: number, shouldConsiderTurn: boolean, isBlocked?: TileBlocker): Direction {
  const legal = legalStepDirections(level, ghostTile, isBlocked)
  if (legal.length === 0) {
    return stoppedDirection
  }

  const forward = legal.find((direction) => sameDirection(direction, current))
  const nonReverse = legal.filter((direction) => !sameDirection(direction, reverseDirection(current)))

  if (forward && (!shouldConsiderTurn || legal.length <= 2)) {
    return forward
  }

  const choices = nonReverse.length > 0 ? nonReverse : legal
  if (forward && choices.length === 1) {
    return forward
  }

  return choices[Math.abs(Math.floor(turnSeed)) % choices.length]
}

export function ghostTypeForIndex(index: number): GhostType {
  return index % 2 === 0 ? 'chaser' : 'patroller'
}

export function shortestPathDirection(level: PacRescueLevel, startTile: GridPoint, targetTile: GridPoint, isBlocked?: TileBlocker): Direction | undefined {
  if (isWall(level, startTile.x, startTile.y) || isWall(level, targetTile.x, targetTile.y) || isBlocked?.(targetTile)) {
    return undefined
  }

  const queue: GridPoint[] = [{ ...startTile }]
  const visited = new Set<string>([pointKey(startTile)])
  const firstStep = new Map<string, Direction>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (sameTile(current, targetTile)) {
      const direction = firstStep.get(pointKey(current))
      return direction && !sameDirection(direction, stoppedDirection) ? direction : stoppedDirection
    }

    for (const direction of directions) {
      const next = stepTarget(level, current, direction, isBlocked)
      if (!next) {
        continue
      }

      const key = pointKey(next)
      if (visited.has(key)) {
        continue
      }

      visited.add(key)
      firstStep.set(key, firstStep.get(pointKey(current)) ?? direction)
      queue.push(next)
    }
  }

  return undefined
}

export function bfsDistance(level: PacRescueLevel, startTile: GridPoint, targetTile: GridPoint): number | undefined {
  if (isWall(level, startTile.x, startTile.y) || isWall(level, targetTile.x, targetTile.y)) {
    return undefined
  }

  const queue: Array<{ tile: GridPoint; distance: number }> = [{ tile: { ...startTile }, distance: 0 }]
  const visited = new Set<string>([pointKey(startTile)])

  while (queue.length > 0) {
    const current = queue.shift()!
    if (sameTile(current.tile, targetTile)) {
      return current.distance
    }

    for (const direction of directions) {
      const next = stepTarget(level, current.tile, direction)
      if (!next) {
        continue
      }
      const key = pointKey(next)
      if (visited.has(key)) {
        continue
      }
      visited.add(key)
      queue.push({ tile: next, distance: current.distance + 1 })
    }
  }

  return undefined
}

export function chooseSafeRespawnTile(
  level: PacRescueLevel,
  preferredTile: GridPoint,
  hazardTiles: GridPoint[],
  minimumSafeDistance = 4,
  isBlocked?: TileBlocker,
): GridPoint {
  const hazards = hazardTiles.filter((tile, index, all) => (
    all.findIndex((candidate) => sameTile(candidate, tile)) === index
      && tile.x >= 0
      && tile.y >= 0
      && tile.x < level.width
      && tile.y < level.height
      && !isWall(level, tile.x, tile.y)
  ))
  if (hazards.length === 0) {
    return { ...preferredTile }
  }

  const preferredSafety = nearestHazardDistance(level, preferredTile, hazards, isBlocked)
  if (preferredSafety >= minimumSafeDistance) {
    return { ...preferredTile }
  }

  let bestTile = { ...preferredTile }
  let bestSafety = preferredSafety
  let bestPreferredDistance = 0

  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const tile = { x, y }
      if (isWall(level, x, y) || isBlocked?.(tile) || hazards.some((hazard) => sameTile(hazard, tile))) {
        continue
      }

      const safety = nearestHazardDistance(level, tile, hazards, isBlocked)
      const preferredDistance = bfsDistance(level, preferredTile, tile) ?? Number.POSITIVE_INFINITY
      if (safety > bestSafety || (safety === bestSafety && preferredDistance < bestPreferredDistance)) {
        bestTile = tile
        bestSafety = safety
        bestPreferredDistance = preferredDistance
      }
    }
  }

  return bestTile
}

export function chooseOppositeCornerRespawnTile(
  level: PacRescueLevel,
  playerTile: GridPoint,
  hazardTiles: GridPoint[] = [],
  isBlocked?: TileBlocker,
): GridPoint {
  const targetCorner = {
    x: playerTile.x < level.width / 2 ? level.width - 2 : 1,
    y: playerTile.y < level.height / 2 ? level.height - 2 : 1,
  }
  const hazards = hazardTiles.filter((tile) => (
    tile.x >= 0
    && tile.y >= 0
    && tile.x < level.width
    && tile.y < level.height
    && !isWall(level, tile.x, tile.y)
  ))

  let bestTile: GridPoint | undefined
  let bestCornerDistance = Number.POSITIVE_INFINITY
  let bestSafety = Number.NEGATIVE_INFINITY

  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const tile = { x, y }
      if (isWall(level, x, y) || isBlocked?.(tile) || sameTile(tile, playerTile)) {
        continue
      }

      const cornerDistance = bfsDistance(level, tile, targetCorner) ?? euclideanDistance(tile, targetCorner)
      const safety = hazards.length > 0 ? nearestHazardDistance(level, tile, hazards, isBlocked) : euclideanDistance(tile, playerTile)
      if (!bestTile || cornerDistance < bestCornerDistance || (cornerDistance === bestCornerDistance && safety > bestSafety)) {
        bestTile = tile
        bestCornerDistance = cornerDistance
        bestSafety = safety
      }
    }
  }

  return bestTile ?? chooseSafeRespawnTile(level, targetCorner, [playerTile, ...hazards], 4, isBlocked)
}

export function shouldSpawnBonusPowerPellet(chasersEaten: number, alreadySpawned: boolean): boolean {
  return chasersEaten >= BONUS_POWER_PELLET_EATEN_THRESHOLD && !alreadySpawned
}

export function chooseBonusPowerPelletTile(
  level: PacRescueLevel,
  playerTile: GridPoint,
  occupiedTiles: GridPoint[] = [],
  isBlocked?: TileBlocker,
): GridPoint | undefined {
  const occupied = new Set([pointKey(playerTile), ...occupiedTiles.map(pointKey)])
  let bestTile: GridPoint | undefined
  let bestDistance = Number.NEGATIVE_INFINITY
  let bestCornerBias = Number.POSITIVE_INFINITY
  const targetCorner = {
    x: playerTile.x < level.width / 2 ? level.width - 2 : 1,
    y: playerTile.y < level.height / 2 ? level.height - 2 : 1,
  }

  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const tile = { x, y }
      if (isWall(level, x, y) || isBlocked?.(tile) || occupied.has(pointKey(tile))) {
        continue
      }
      const distance = bfsDistance(level, playerTile, tile)
      if (distance === undefined) {
        continue
      }
      const cornerBias = bfsDistance(level, tile, targetCorner) ?? euclideanDistance(tile, targetCorner)
      if (distance > bestDistance || (distance === bestDistance && cornerBias < bestCornerBias)) {
        bestTile = tile
        bestDistance = distance
        bestCornerBias = cornerBias
      }
    }
  }

  return bestTile
}

export function crossedTiles(previousA: GridPoint, currentA: GridPoint, previousB: GridPoint, currentB: GridPoint): boolean {
  return sameTile(previousA, currentB) && sameTile(currentA, previousB)
}

export function resolveTileCollision(
  previousPlayer: GridPoint,
  player: GridPoint,
  previousGhost: GridPoint,
  ghost: GridPoint,
  powered: boolean,
): CollisionResult {
  if (!sameTile(player, ghost) && !crossedTiles(previousPlayer, player, previousGhost, ghost)) {
    return 'none'
  }

  return powered ? 'powered-eat' : 'normal-hit'
}

export function reverseDirection(direction: Direction): Direction {
  return { x: -direction.x, y: -direction.y }
}

function nearestHazardDistance(level: PacRescueLevel, tile: GridPoint, hazards: GridPoint[], isBlocked?: TileBlocker): number {
  if (isWall(level, tile.x, tile.y) || isBlocked?.(tile)) {
    return Number.NEGATIVE_INFINITY
  }

  let nearest = Number.POSITIVE_INFINITY
  for (const hazard of hazards) {
    if (sameTile(tile, hazard)) {
      return 0
    }
    nearest = Math.min(nearest, bfsDistance(level, tile, hazard) ?? Number.POSITIVE_INFINITY)
  }
  return nearest
}

function euclideanDistance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
