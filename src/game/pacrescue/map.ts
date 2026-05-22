import type { Direction, GridPoint, PacRescueLevel, PacRescueSettings, RescueProgress, TileSymbol } from './types'

const allowedTiles = new Set<string>(['#', ' ', '.', 'O', 'K', 'P', 'H', 'C'])

export const directions: Direction[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`
}

export function sameDirection(a: Direction, b: Direction): boolean {
  return a.x === b.x && a.y === b.y
}

export function sanitizeSettings(settings: PacRescueSettings): PacRescueSettings {
  const playerSpeed = clamp(settings.playerSpeed, 1, 12)
  const chaserSpeed = Math.min(clamp(settings.chaserSpeed, 0.5, 11.5), Math.max(0.5, playerSpeed - 0.25))
  const keyCount = clamp(Math.round(settings.keyCount), 1, 4)
  const cameraViewTiles = sanitizeCameraViewTiles(settings.cameraViewTiles)

  return {
    mazeColumns: clamp(Math.round(settings.mazeColumns), 7, 40),
    mazeRows: clamp(Math.round(settings.mazeRows), 7, 44),
    cameraViewTiles,
    enemySkin: settings.enemySkin === 'vacuum' ? 'vacuum' : 'classic',
    playerSkin: sanitizePlayerSkin(settings.playerSkin),
    coinSkin: sanitizeCoinSkin(settings.coinSkin),
    mazeFloor: sanitizeMazeFloor(settings.mazeFloor),
    mazeWall: sanitizeMazeWall(settings.mazeWall),
    stageBackground: sanitizeStageBackground(settings.stageBackground),
    stageBackgroundScale: clamp(Math.round(settings.stageBackgroundScale), 60, 220),
    boardOffsetX: clamp(Math.round(settings.boardOffsetX), -260, 260),
    boardOffsetY: clamp(Math.round(settings.boardOffsetY), -260, 260),
    playerSpeed,
    chaserSpeed,
    chaseRadius: clamp(settings.chaseRadius, 1, 20),
    chaserCount: clamp(Math.round(settings.chaserCount), 0, 4),
    keyCount,
    coinCount: clamp(Math.round(settings.coinCount), 0, 600),
    powerPelletCount: clamp(Math.round(settings.powerPelletCount), 0, 12),
    requiredKeys: clamp(Math.round(settings.requiredKeys), 1, keyCount),
    coinGoalPercent: clamp(Math.round(settings.coinGoalPercent), 0, 100),
    frightDuration: clamp(settings.frightDuration, 1, 20),
    chaseDuration: clamp(settings.chaseDuration, 4, 45),
    scatterDuration: clamp(settings.scatterDuration, 2, 20),
    rescueZoneSize: clamp(Math.round(settings.rescueZoneSize), 1, 6),
    wanderTurnInterval: clamp(settings.wanderTurnInterval, 0.25, 5),
  }
}

export function parseMapText(text: string): PacRescueLevel {
  const rawRows = text.replace(/\r/g, '').split('\n').filter((row) => row.length > 0)
  const width = Math.max(5, ...rawRows.map((row) => row.length))
  const sourceRows = rawRows.length > 0 ? rawRows : ['#####', '#P H#', '#####']
  const rows = sourceRows.map((row) => Array.from(row.padEnd(width, ' '), toTile))
  const height = rows.length
  let playerStart: GridPoint | undefined
  let hostage: GridPoint | undefined
  const chasers: GridPoint[] = []
  const coins = new Set<string>()
  const powerPellets = new Set<string>()
  const keys = new Set<string>()

  rows.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile === 'P' && !playerStart) playerStart = { x, y }
      if (tile === 'H' && !hostage) hostage = { x, y }
      if (tile === 'C') chasers.push({ x, y })
      if (tile === '.') coins.add(pointKey({ x, y }))
      if (tile === 'O') powerPellets.add(pointKey({ x, y }))
      if (tile === 'K') keys.add(pointKey({ x, y }))
    })
  })

  if (!playerStart) {
    playerStart = firstOpenCell(rows) ?? { x: 1, y: 1 }
    rows[playerStart.y][playerStart.x] = 'P'
  }
  if (!hostage) {
    hostage = lastOpenCell(rows) ?? { x: Math.max(1, width - 2), y: Math.max(1, height - 2) }
    rows[hostage.y][hostage.x] = 'H'
  }

  return { width, height, rows, playerStart, hostage, chasers, coins, powerPellets, keys }
}

export function serializeRows(rows: TileSymbol[][]): string {
  return rows.map((row) => row.join('').trimEnd()).join('\n')
}

export function rebalanceMapText(text: string, settings: PacRescueSettings): string {
  const safeSettings = sanitizeSettings(settings)
  const level = parseMapText(text)
  const rows = level.rows.map((row) => [...row])

  trimToCount(rows, 'C', safeSettings.chaserCount)
  trimToCount(rows, 'K', safeSettings.keyCount)
  trimToCount(rows, 'O', safeSettings.powerPelletCount)
  trimToCount(rows, '.', safeSettings.coinCount)
  addToCount(rows, 'C', safeSettings.chaserCount)
  addToCount(rows, 'K', safeSettings.keyCount)
  addToCount(rows, 'O', safeSettings.powerPelletCount)
  addToCount(rows, '.', safeSettings.coinCount)

  return serializeRows(rows)
}

export function capMapTextCounts(text: string, settings: PacRescueSettings): string {
  const safeSettings = sanitizeSettings(settings)
  const level = parseMapText(text)
  const rows = level.rows.map((row) => [...row])

  trimToCount(rows, 'C', safeSettings.chaserCount)
  trimToCount(rows, 'K', safeSettings.keyCount)
  trimToCount(rows, 'O', safeSettings.powerPelletCount)
  trimToCount(rows, '.', safeSettings.coinCount)

  return serializeRows(rows)
}

export function resizeMapText(text: string, columns: number, rows: number, settings?: PacRescueSettings): string {
  const width = clamp(Math.round(columns), 13, 40)
  const height = clamp(Math.round(rows), 11, 44)
  const source = parseMapText(text)
  const output: TileSymbol[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ' ' as TileSymbol))
  const sourceStartX = Math.max(0, Math.floor((source.width - width) / 2))
  const sourceStartY = Math.max(0, Math.floor((source.height - height) / 2))
  const targetStartX = Math.max(0, Math.floor((width - source.width) / 2))
  const targetStartY = Math.max(0, Math.floor((height - source.height) / 2))
  const copyWidth = Math.min(source.width, width)
  const copyHeight = Math.min(source.height, height)

  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      output[targetStartY + y][targetStartX + x] = source.rows[sourceStartY + y][sourceStartX + x]
    }
  }

  applyOuterBorder(output, source)
  ensureSingleton(output, 'P', { x: 1, y: 2 })
  ensureSingleton(output, 'H', { x: Math.floor(width / 2), y: Math.floor(height / 2) })

  const resized = serializeRows(output)
  return settings ? capMapTextCounts(resized, { ...settings, mazeColumns: width, mazeRows: height }) : resized
}

export function setTileInMapText(text: string, x: number, y: number, tile: TileSymbol): string {
  const level = parseMapText(text)
  if (y < 0 || y >= level.height || x < 0 || x >= level.width) {
    return text
  }

  const rows = level.rows.map((row) => [...row])
  if (tile === 'P') replaceSingleton(rows, 'P')
  if (tile === 'H') replaceSingleton(rows, 'H')
  rows[y][x] = tile
  return serializeRows(rows)
}

export function rescueCoinGoal(totalCoins: number, coinGoalPercent: number): number {
  return Math.ceil(totalCoins * clamp(coinGoalPercent, 0, 100) / 100)
}

export function canRescue(progress: RescueProgress, settings: PacRescueSettings): boolean {
  const safeSettings = sanitizeSettings(settings)
  return progress.keysCollected >= requiredKeysForRescue(progress, safeSettings) && progress.coinsCollected >= rescueCoinGoal(progress.totalCoins, safeSettings.coinGoalPercent)
}

export function requiredKeysForRescue(progress: RescueProgress, settings: PacRescueSettings): number {
  const safeSettings = sanitizeSettings(settings)
  return progress.totalKeys ?? safeSettings.requiredKeys
}

export function isWall(level: PacRescueLevel, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) {
    return true
  }
  return level.rows[y][x] === '#'
}

export function isHorizontalTunnelRow(level: PacRescueLevel, y: number): boolean {
  if (y < 0 || y >= level.height) {
    return false
  }
  return level.rows[y][0] !== '#' && level.rows[y][level.width - 1] !== '#'
}

export function isVerticalTunnelColumn(level: PacRescueLevel, x: number): boolean {
  if (x < 0 || x >= level.width) {
    return false
  }
  return level.rows[0]?.[x] !== '#' && level.rows[level.height - 1]?.[x] !== '#'
}

export function wrapHorizontalTunnel(level: PacRescueLevel, point: GridPoint): GridPoint {
  const row = Math.round(point.y)
  if (!isHorizontalTunnelRow(level, row)) {
    return point
  }
  if (point.x < -0.5) {
    return { ...point, x: level.width - 0.5 }
  }
  if (point.x > level.width - 0.5) {
    return { ...point, x: -0.5 }
  }
  return point
}

export function wrapVerticalTunnel(level: PacRescueLevel, point: GridPoint): GridPoint {
  const column = Math.round(point.x)
  if (!isVerticalTunnelColumn(level, column)) {
    return point
  }
  if (point.y < -0.5) {
    return { ...point, y: level.height - 0.5 }
  }
  if (point.y > level.height - 0.5) {
    return { ...point, y: -0.5 }
  }
  return point
}

export function legalDirections(level: PacRescueLevel, point: GridPoint): Direction[] {
  const cell = roundPoint(point)
  return directions.filter((direction) => !isWall(level, cell.x + direction.x, cell.y + direction.y))
}

export function chooseChaseDirection(level: PacRescueLevel, chaser: GridPoint, player: GridPoint): Direction {
  return chooseTargetDirection(level, chaser, player)
}

export function chooseTargetDirection(level: PacRescueLevel, chaser: GridPoint, target: GridPoint): Direction {
  const pathDirection = chooseShortestPathDirection(level, chaser, target)
  if (pathDirection) {
    return pathDirection
  }

  const legal = legalDirections(level, chaser)
  if (legal.length === 0) {
    return { x: 0, y: 0 }
  }

  const dx = target.x - chaser.x
  const dy = target.y - chaser.y
  const horizontal = dx === 0 ? [] : [{ x: Math.sign(dx), y: 0 }]
  const vertical = dy === 0 ? [] : [{ x: 0, y: Math.sign(dy) }]
  const preferred = Math.abs(dx) >= Math.abs(dy) ? [...horizontal, ...vertical] : [...vertical, ...horizontal]
  const fallback = [...preferred, ...directions].find((direction) => legal.some((candidate) => sameDirection(candidate, direction)))
  return fallback ?? legal[0]
}

export function chooseShortestPathDirection(level: PacRescueLevel, chaser: GridPoint, target: GridPoint): Direction | undefined {
  const start = roundPoint(chaser)
  const goal = nearestOpenCell(level, roundPoint(target))
  if (!goal || isWall(level, start.x, start.y)) {
    return undefined
  }

  const queue: GridPoint[] = [start]
  const visited = new Set<string>([pointKey(start)])
  const firstStep = new Map<string, Direction>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.x === goal.x && current.y === goal.y) {
      return firstStep.get(pointKey(current)) ?? { x: 0, y: 0 }
    }

    for (const direction of directions) {
      const next = neighborCell(level, current, direction)
      if (!next || isWall(level, next.x, next.y)) {
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

export function chooseFleeDirection(level: PacRescueLevel, chaser: GridPoint, player: GridPoint): Direction {
  const legal = legalDirections(level, chaser)
  if (legal.length === 0) {
    return { x: 0, y: 0 }
  }

  return [...legal].sort((a, b) => {
    const nextA = { x: chaser.x + a.x, y: chaser.y + a.y }
    const nextB = { x: chaser.x + b.x, y: chaser.y + b.y }
    return distance(nextB, player) - distance(nextA, player)
  })[0]
}

export function chooseChaserDirection(
  level: PacRescueLevel,
  chaser: GridPoint,
  player: GridPoint,
  current: Direction,
  chaseRadius: number,
  shouldTurnWhileWandering: boolean,
  wanderIndex: number,
  frightened = false,
  target?: GridPoint,
): Direction {
  if (frightened) {
    return chooseFleeDirection(level, chaser, player)
  }

  if (distance(chaser, player) <= chaseRadius) {
    return chooseTargetDirection(level, chaser, target ?? player)
  }

  const legal = legalDirections(level, chaser)
  if (legal.length === 0) {
    return { x: 0, y: 0 }
  }
  if (!shouldTurnWhileWandering && legal.some((direction) => sameDirection(direction, current))) {
    return current
  }
  return legal[Math.abs(wanderIndex) % legal.length]
}

export function mapCounts(text: string): { coins: number; keys: number; chasers: number; powerPellets: number } {
  const level = parseMapText(text)
  return {
    coins: level.coins.size,
    keys: level.keys.size,
    chasers: level.chasers.length,
    powerPellets: level.powerPellets.size,
  }
}

export function distance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function roundPoint(point: GridPoint): GridPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function neighborCell(level: PacRescueLevel, point: GridPoint, direction: Direction): GridPoint | undefined {
  let x = point.x + direction.x
  let y = point.y + direction.y

  if (direction.x !== 0 && isHorizontalTunnelRow(level, point.y)) {
    if (x < 0) x = level.width - 1
    if (x >= level.width) x = 0
  }

  if (direction.y !== 0 && isVerticalTunnelColumn(level, point.x)) {
    if (y < 0) y = level.height - 1
    if (y >= level.height) y = 0
  }

  if (x < 0 || y < 0 || x >= level.width || y >= level.height) {
    return undefined
  }

  return { x, y }
}

function nearestOpenCell(level: PacRescueLevel, target: GridPoint): GridPoint | undefined {
  const clamped = {
    x: clamp(target.x, 0, level.width - 1),
    y: clamp(target.y, 0, level.height - 1),
  }
  if (!isWall(level, clamped.x, clamped.y)) {
    return clamped
  }

  const queue: GridPoint[] = [clamped]
  const visited = new Set<string>([pointKey(clamped)])

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const direction of directions) {
      const next = neighborCell(level, current, direction)
      if (!next) {
        continue
      }
      const key = pointKey(next)
      if (visited.has(key)) {
        continue
      }
      if (!isWall(level, next.x, next.y)) {
        return next
      }
      visited.add(key)
      queue.push(next)
    }
  }

  return undefined
}

function toTile(value: string): TileSymbol {
  return allowedTiles.has(value) ? (value as TileSymbol) : ' '
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function sanitizeCameraViewTiles(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  const rounded = clamp(Math.round(value), 6, 12)
  const options = [6, 8, 9, 12]
  return options.reduce((closest, option) => (
    Math.abs(option - rounded) < Math.abs(closest - rounded) ? option : closest
  ), options[0])
}

function sanitizeMazeFloor(value: string): PacRescueSettings['mazeFloor'] {
  if (
    value === 'transparent'
    || value === 'dusty-rose'
    || value === 'warm-clay'
    || value === 'stage-salmon'
    || value === 'spotlight'
    || value === 'soft-mauve'
  ) {
    return value
  }
  return 'classic'
}

function sanitizePlayerSkin(value: string): PacRescueSettings['playerSkin'] {
  if (value === 'eye-cat-plain') {
    return value
  }
  return 'classic'
}

function sanitizeCoinSkin(value: string): PacRescueSettings['coinSkin'] {
  if (value === 'vacuum-orange-dot') {
    return value
  }
  return 'dot'
}

function sanitizeStageBackground(value: string): PacRescueSettings['stageBackground'] {
  if (
    value === 'lab-final-ruin-2'
    || value === 'none'
  ) {
    return value
  }
  return 'none'
}

function sanitizeMazeWall(value: string): PacRescueSettings['mazeWall'] {
  if (
    value === 'electric-blue'
    || value === 'laser-cyan'
    || value === 'neon-pink'
    || value === 'acid-lime'
    || value === 'hot-violet'
    || value === 'arcade-amber'
    || value === 'spotlight-cream'
    || value === 'neon-teal'
    || value === 'turquoise'
    || value === 'cobalt'
    || value === 'deep-navy'
    || value === 'vacuum-orange'
    || value === 'coral-beam'
    || value === 'dusty-mauve'
    || value === 'ember-red'
  ) {
    return value
  }
  return 'electric-blue'
}

function firstOpenCell(rows: TileSymbol[][]): GridPoint | undefined {
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] !== '#') return { x, y }
    }
  }
  return undefined
}

function lastOpenCell(rows: TileSymbol[][]): GridPoint | undefined {
  for (let y = rows.length - 1; y >= 0; y -= 1) {
    for (let x = rows[y].length - 1; x >= 0; x -= 1) {
      if (rows[y][x] !== '#') return { x, y }
    }
  }
  return undefined
}

function applyOuterBorder(rows: TileSymbol[][], source: PacRescueLevel): void {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  if (height === 0 || width === 0) {
    return
  }

  for (let x = 0; x < width; x += 1) {
    rows[0][x] = '#'
    rows[height - 1][x] = '#'
  }
  for (let y = 1; y < height - 1; y += 1) {
    rows[y][0] = '#'
    rows[y][width - 1] = '#'
  }

  const tunnelRows = source.rows
    .map((row, y) => ({ y, open: row[0] !== '#' && row[source.width - 1] !== '#' }))
    .filter((row) => row.open)
    .map((row) => Math.round((row.y / Math.max(1, source.height - 1)) * (height - 1)))

  for (const y of tunnelRows) {
    if (y > 0 && y < height - 1) {
      rows[y][0] = ' '
      rows[y][width - 1] = ' '
    }
  }
}

function ensureSingleton(rows: TileSymbol[][], tile: 'P' | 'H', fallback: GridPoint): void {
  const positions = positionsFor(rows, tile)
  positions.slice(1).forEach((point) => {
    rows[point.y][point.x] = ' '
  })
  if (positions.length > 0) {
    return
  }

  const height = rows.length
  const width = rows[0]?.length ?? 0
  const fallbackPoint = {
    x: clamp(fallback.x, 1, Math.max(1, width - 2)),
    y: clamp(fallback.y, 1, Math.max(1, height - 2)),
  }
  if (rows[fallbackPoint.y]?.[fallbackPoint.x] === '#') {
    rows[fallbackPoint.y][fallbackPoint.x] = ' '
  }
  rows[fallbackPoint.y][fallbackPoint.x] = tile
}

function trimToCount(rows: TileSymbol[][], tile: TileSymbol, target: number): void {
  const positions = positionsFor(rows, tile)
  for (const point of positions.slice(target)) {
    rows[point.y][point.x] = ' '
  }
}

function addToCount(rows: TileSymbol[][], tile: TileSymbol, target: number): void {
  let needed = target - positionsFor(rows, tile).length
  if (needed <= 0) {
    return
  }

  for (let y = 0; y < rows.length && needed > 0; y += 1) {
    for (let x = 0; x < rows[y].length && needed > 0; x += 1) {
      if (rows[y][x] === ' ') {
        rows[y][x] = tile
        needed -= 1
      }
    }
  }
}

function positionsFor(rows: TileSymbol[][], tile: TileSymbol): GridPoint[] {
  const positions: GridPoint[] = []
  rows.forEach((row, y) => {
    row.forEach((candidate, x) => {
      if (candidate === tile) {
        positions.push({ x, y })
      }
    })
  })
  return positions
}

function replaceSingleton(rows: TileSymbol[][], tile: 'P' | 'H'): void {
  for (const point of positionsFor(rows, tile)) {
    rows[point.y][point.x] = ' '
  }
}
