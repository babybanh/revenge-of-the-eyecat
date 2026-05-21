export type TileSymbol = '#' | ' ' | '.' | 'O' | 'K' | 'P' | 'H' | 'C'

export type GridPoint = {
  x: number
  y: number
}

export type Direction = GridPoint

export type GhostType = 'chaser' | 'patroller'
export type EnemySkin = 'classic' | 'vacuum'
export type PlayerSkin = 'classic' | 'eye-cat-bronze' | 'eye-cat-white' | 'eye-cat-plain'
export type CoinSkin = 'dot' | 'vacuum-orange-dot' | 'coin'
export type MazeFloor = 'classic' | 'transparent' | 'dusty-rose' | 'warm-clay' | 'stage-salmon' | 'spotlight' | 'soft-mauve'
export type StageBackground =
  | 'none'
  | 'lab-wide'
  | 'lab-close'
  | 'lab-tall'
  | 'lab-ruin'
  | 'lab-smoke'
  | 'lab-glow'
  | 'lab-compact'
  | 'lab-final-ruin'
  | 'lab-final-ruin-2'
export type MazeWall =
  | 'electric-blue'
  | 'laser-cyan'
  | 'neon-pink'
  | 'acid-lime'
  | 'hot-violet'
  | 'arcade-amber'
  | 'spotlight-cream'
  | 'neon-teal'
  | 'turquoise'
  | 'cobalt'
  | 'deep-navy'
  | 'vacuum-orange'
  | 'coral-beam'
  | 'dusty-mauve'
  | 'ember-red'

export type PacRescueSettings = {
  mazeColumns: number
  mazeRows: number
  cameraViewTiles: number
  enemySkin: EnemySkin
  playerSkin: PlayerSkin
  coinSkin: CoinSkin
  mazeFloor: MazeFloor
  mazeWall: MazeWall
  stageBackground: StageBackground
  stageBackgroundScale: number
  boardOffsetX: number
  boardOffsetY: number
  playerSpeed: number
  chaserSpeed: number
  chaseRadius: number
  chaserCount: number
  keyCount: number
  coinCount: number
  powerPelletCount: number
  requiredKeys: number
  coinGoalPercent: number
  frightDuration: number
  chaseDuration: number
  scatterDuration: number
  rescueZoneSize: number
  wanderTurnInterval: number
}

export type PacRescueLevel = {
  width: number
  height: number
  rows: TileSymbol[][]
  playerStart: GridPoint
  hostage: GridPoint
  chasers: GridPoint[]
  coins: Set<string>
  powerPellets: Set<string>
  keys: Set<string>
}

export type RescueProgress = {
  coinsCollected: number
  totalCoins: number
  keysCollected: number
  totalKeys?: number
}

export type RuntimeStatus = 'playing' | 'won' | 'gameover'

export type InstructionPhase = 'find-key' | 'collect-coins' | 'key-appeared' | 'all-keys' | 'rescue' | 'blocked' | 'lost-life' | 'won' | 'gameover'

export type RuntimeSnapshot = RescueProgress & {
  status: RuntimeStatus
  message: string
  instruction: string
  instructionPhase: InstructionPhase
  playerScreenPosition?: GridPoint
  coinGoal: number
  requiredKeys: number
  lives: number
  maxLives: number
  keysVisible: number
  frightRemaining: number
  chasersEaten: number
}
