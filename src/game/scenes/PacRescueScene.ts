import Phaser from 'phaser'
import {
  canRescue,
  parseMapText,
  pointKey,
  requiredKeysForRescue,
  rescueCoinGoal,
  sanitizeSettings,
} from '../pacrescue/map'
import {
  collectCoin,
  collectVisibleKey,
  collectedCoins,
  createDelayedKeyState,
  instructionForProgress,
  isBlockedRescueTile,
  isInRescueZone,
  keyProgress,
  maybeRevealLockedKey,
  resolveLifeHit,
  visibleUncollectedKeys,
  type DelayedKeyState,
} from '../pacrescue/objective'
import {
  actorPosition,
  advanceStep,
  beginStep,
  chooseGhostStep,
  chooseOppositeCornerRespawnTile,
  choosePatrollerStep,
  chooseSafeRespawnTile,
  createStepActor,
  ghostTypeForIndex,
  isMoving,
  resolveTileCollision,
  sameTile,
  stepTarget,
  stoppedDirection,
  type StepActor,
} from '../pacrescue/step'
import type { Direction, GhostType, GridPoint, InstructionPhase, PacRescueLevel, PacRescueSettings, RuntimeSnapshot, TileSymbol } from '../pacrescue/types'

export type JoystickInput = {
  x: number
  y: number
}

export type PacRescueSceneOptions = {
  mapText: string
  settings: PacRescueSettings
  editorMode: boolean
  selectedTile: TileSymbol
  getJoystick: () => JoystickInput
  isPaused?: () => boolean
  onRuntime: (snapshot: RuntimeSnapshot) => void
  onTileClick: (x: number, y: number) => void
}

type ChaserRuntime = StepActor & {
  spawn: GridPoint
  inactive: number
  ghostType: GhostType
  turnClock: number
}

type MazeBoundarySegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

const WORLD_WIDTH = 672
const WORLD_HEIGHT = 672
const MAX_LIVES = 3
const RESPAWN_INVINCIBLE_SECONDS = 1.5
const PLAYER_COLOR = 0xffd84d
const COIN_COLOR = 0xf3df84
const VACUUM_ORANGE_COIN_COLOR = 0xe85b2e
const KEY_COLOR = 0x71d8ff
const POWER_COLOR = 0xff8fd1
const HOSTAGE_COLOR = 0x68e095
const CHASER_COLOR = 0xf05a5a
const PATROLLER_COLOR = 0xf2a04a
const FRIGHT_COLOR = 0x64b7ff
const EATEN_COLOR = 0x8791a1
const VACUUM_ENEMY_KEY = 'enemy-vacuum'
const VACUUM_WEAK_ENEMY_KEY = 'enemy-vacuum-weak'
const EYE_CAT_BRONZE_PLAYER_KEY = 'player-eye-cat-bronze'
const EYE_CAT_WHITE_PLAYER_KEY = 'player-eye-cat-white'
const EYE_CAT_PLAIN_PLAYER_KEY = 'player-eye-cat-plain'
const COIN_SPRITE_KEY = 'coin-sprite'
const RESCUE_CAT_KEY = 'rescue-cat'
const CAMERA_SMOOTHING = 4.5
const POWER_SPEED_MULTIPLIER = 1.1
const LOCKED_KEY_REVEAL_DELAY = 0.75
const LOCKED_KEY_NOTICE_DELAY = 0.45

export class PacRescueScene extends Phaser.Scene {
  private options: PacRescueSceneOptions
  private settings: PacRescueSettings
  private level: PacRescueLevel
  private graphics?: Phaser.GameObjects.Graphics
  private chaserSprites: Phaser.GameObjects.Image[] = []
  private coinSprites: Phaser.GameObjects.Image[] = []
  private playerSprite?: Phaser.GameObjects.Image
  private hostageSprite?: Phaser.GameObjects.Image
  private keys?: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>
  private player: StepActor
  private chasers: ChaserRuntime[] = []
  private objective: DelayedKeyState
  private powerPellets = new Set<string>()
  private status: RuntimeSnapshot['status'] = 'playing'
  private message = 'Collect coins, grab keys, then rescue the cat hostage.'
  private instructionPhase: InstructionPhase = 'find-key'
  private lives = MAX_LIVES
  private frightRemaining = 0
  private invincibleRemaining = 0
  private lockedKeyRevealDelay = 0
  private lockedKeyNoticeDelay = 0
  private chasersEaten = 0
  private elapsed = 0
  private lastRuntime = ''
  private boardRect = { x: 0, y: 0, width: 1, height: 1, tile: 1 }
  private cameraOffset?: { x: number; y: number; tile: number; viewTiles: number }
  private queuedDirection: Direction = stoppedDirection
  private playerFacingX = 1

  constructor(options: PacRescueSceneOptions) {
    super('PacRescueScene')
    this.options = options
    this.settings = sanitizeSettings(options.settings)
    this.level = parseMapText(options.mapText)
    this.player = createStepActor(this.level.playerStart)
    this.objective = createDelayedKeyState(this.level)
    this.resetRuntime()
  }

  preload(): void {
    this.load.image(VACUUM_ENEMY_KEY, '/characters/character-vacuum.png')
    this.load.image(VACUUM_WEAK_ENEMY_KEY, '/characters/character-vacuum-weak.png')
    this.load.image(EYE_CAT_BRONZE_PLAYER_KEY, '/characters/player-eye-cat-bronze.png')
    this.load.image(EYE_CAT_WHITE_PLAYER_KEY, '/characters/player-eye-cat-white.png')
    this.load.image(EYE_CAT_PLAIN_PLAYER_KEY, '/characters/player-eye-cat-plain.png')
    if (this.settings.coinSkin === 'coin') {
      this.load.image(COIN_SPRITE_KEY, '/characters/character-coin.png')
    }
    this.load.image(RESCUE_CAT_KEY, '/characters/character-white-cat.png')
  }

  create(): void {
    this.graphics = this.add.graphics()
    this.cameras.main.setBackgroundColor(this.isTransparentFloor() ? 'rgba(0, 0, 0, 0)' : '#071018')
    this.input.keyboard?.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
    ])
    this.keys = this.input.keyboard?.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      s: Phaser.Input.Keyboard.KeyCodes.S,
    }) as Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's', Phaser.Input.Keyboard.Key>

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointer(pointer))
    this.emitRuntime(true)
  }

  update(_time: number, deltaMs: number): void {
    const delta = Math.min(0.05, deltaMs / 1000)
    this.elapsed += delta

    if (this.status === 'playing' && !this.options.editorMode && !this.options.isPaused?.()) {
      this.frightRemaining = Math.max(0, this.frightRemaining - delta)
      this.invincibleRemaining = Math.max(0, this.invincibleRemaining - delta)
      this.updateLockedKeyReveal(delta)
      const previousPlayerTile = { ...this.player.tile }
      this.updatePlayer(delta)
      this.updateCollectibles()
      this.updateChasers(delta, previousPlayerTile)
      this.checkHostage()
    }

    this.computeBoardRect(delta)
    this.render()
    this.emitRuntime(false)
  }

  private resetRuntime(): void {
    this.player = createStepActor(this.level.playerStart)
    this.queuedDirection = stoppedDirection
    this.objective = createDelayedKeyState(this.level)
    this.powerPellets = new Set(this.level.powerPellets)
    this.chasers = this.createChasers()
    this.status = 'playing'
    this.message = 'Collect coins, grab keys, then rescue the cat hostage.'
    this.instructionPhase = 'find-key'
    this.lives = MAX_LIVES
    this.frightRemaining = 0
    this.invincibleRemaining = 0
    this.lockedKeyRevealDelay = 0
    this.lockedKeyNoticeDelay = 0
    this.chasersEaten = 0
  }

  private createChasers(): ChaserRuntime[] {
    return this.level.chasers.slice(0, this.settings.chaserCount).map((spawn, index) => ({
      ...createStepActor(spawn),
      spawn: { ...spawn },
      inactive: 0,
      ghostType: ghostTypeForIndex(index),
      turnClock: this.settings.wanderTurnInterval,
    }))
  }

  private updatePlayer(delta: number): void {
    const desired = directionFromInput(this.readInput(), this.player.direction)
    if (desired.x !== 0) {
      this.playerFacingX = desired.x
    }
    if (!sameTile(desired, stoppedDirection)) {
      this.queuedDirection = desired
    } else {
      this.queuedDirection = stoppedDirection
    }

    if (!isMoving(this.player)) {
      if (!sameTile(this.queuedDirection, stoppedDirection)) {
        const queuedStep = this.beginPlayerStep(this.queuedDirection)
        this.player = isMoving(queuedStep.actor) || queuedStep.blocked ? queuedStep.actor : this.beginPlayerStep(this.player.direction).actor
      }
    }

    this.player = advanceStep(this.player, this.playerMoveSpeed(), delta).actor
  }

  private beginPlayerStep(direction: Direction): { actor: StepActor; blocked: boolean } {
    const target = stepTarget(this.level, this.player.tile, direction)
    if (target && isBlockedRescueTile(target, this.level.hostage, this.progress(), this.settings)) {
      this.message = 'Collect the keys and coins before reaching the cat.'
      this.instructionPhase = 'blocked'
      return {
        actor: {
          ...this.player,
          nextTile: { ...this.player.tile },
          direction: stoppedDirection,
          moveProgress: 0,
        },
        blocked: true,
      }
    }

    return { actor: beginStep(this.player, direction, this.level), blocked: false }
  }

  private updateCollectibles(): void {
    const key = pointKey(this.player.tile)

    if (collectCoin(this.objective, key)) {
      this.message = 'Coin collected.'
      this.queueLockedKeyReveal()
    }
    if (collectVisibleKey(this.objective, key)) {
      this.message = `${this.keysCollected()} of ${this.requiredKeys()} keys secured.`
      this.queueLockedKeyReveal()
    }
    if (this.powerPellets.delete(key)) {
      this.frightRemaining = this.settings.frightDuration
      this.message = 'Power pellet active. Vacuums are edible and trying to escape.'
    }
  }

  private queueLockedKeyReveal(): void {
    if (this.lockedKeyRevealDelay > 0 || this.lockedKeyNoticeDelay > 0) return
    if (!this.objective.lockedKey || this.objective.lockedKeyRevealed) return
    if (this.keysCollected() < this.objective.totalKeys - 1) return
    if (collectedCoins(this.objective) < rescueCoinGoal(this.objective.totalCoins, this.settings.coinGoalPercent)) return
    this.lockedKeyRevealDelay = LOCKED_KEY_REVEAL_DELAY
  }

  private updateLockedKeyReveal(delta: number): void {
    if (this.lockedKeyRevealDelay > 0) {
      this.lockedKeyRevealDelay = Math.max(0, this.lockedKeyRevealDelay - delta)
      if (this.lockedKeyRevealDelay <= 0 && maybeRevealLockedKey(this.objective, this.settings)) {
        this.lockedKeyNoticeDelay = LOCKED_KEY_NOTICE_DELAY
      }
    }
    if (this.lockedKeyNoticeDelay > 0) {
      this.lockedKeyNoticeDelay = Math.max(0, this.lockedKeyNoticeDelay - delta)
      if (this.lockedKeyNoticeDelay <= 0) {
        this.message = 'The last key appeared.'
        this.instructionPhase = 'key-appeared'
      }
    }
  }

  private updateChasers(delta: number, previousPlayerTile: GridPoint): void {
    const nextChasers: ChaserRuntime[] = []
    const blocksPrincessZone = (point: GridPoint) => isInRescueZone(point, this.level.hostage, this.settings.rescueZoneSize)

    for (let index = 0; index < this.chasers.length; index += 1) {
      const chaser = this.chasers[index]
      if (this.status !== 'playing') {
        nextChasers.push(chaser)
        continue
      }

      if (chaser.inactive > 0) {
        const inactive = Math.max(0, chaser.inactive - delta)
        nextChasers.push(inactive > 0 ? { ...chaser, inactive } : { ...chaser, inactive, nextTile: { ...chaser.tile }, direction: stoppedDirection, moveProgress: 0 })
        continue
      }

      const previousGhostTile = { ...chaser.tile }
      let nextChaser: ChaserRuntime = { ...chaser, tile: { ...chaser.tile }, nextTile: { ...chaser.nextTile }, direction: { ...chaser.direction } }
      nextChaser.turnClock = Math.max(0, nextChaser.turnClock - delta)
      if (!isMoving(nextChaser)) {
        const shouldTurn = nextChaser.turnClock <= 0
        const direction = nextChaser.ghostType === 'chaser'
          ? chooseGhostStep(this.level, nextChaser.tile, this.player.tile, blocksPrincessZone)
          : choosePatrollerStep(this.level, nextChaser.tile, nextChaser.direction, this.elapsed + nextChaser.tile.x + nextChaser.tile.y, shouldTurn, blocksPrincessZone)
        nextChaser = {
          ...nextChaser,
          ...beginStep(nextChaser, direction, this.level, blocksPrincessZone),
          turnClock: shouldTurn ? this.settings.wanderTurnInterval : nextChaser.turnClock,
        }
      }

      nextChaser = {
        ...nextChaser,
        ...advanceStep(nextChaser, this.chaserMoveSpeed(), delta).actor,
      }

      const collision = resolveTileCollision(previousPlayerTile, this.player.tile, previousGhostTile, nextChaser.tile, this.frightRemaining > 0)
      const lifeHit = collision === 'none' ? undefined : resolveLifeHit(this.lives, collision === 'powered-eat', this.invincibleRemaining > 0)
      if (lifeHit?.type === 'eat-ghost') {
        const respawnTile = chooseOppositeCornerRespawnTile(
          this.level,
          this.player.tile,
          [
            ...this.chasers.flatMap((other, otherIndex) => (
              otherIndex === index ? [] : [other.tile, other.nextTile]
            )),
            this.player.tile,
          ],
          blocksPrincessZone,
        )
        this.chasersEaten += 1
        this.message = 'Vacuum eaten. It will reappear away from you.'
        nextChasers.push({
          ...nextChaser,
          tile: { ...respawnTile },
          nextTile: { ...respawnTile },
          direction: stoppedDirection,
          moveProgress: 0,
          inactive: 2.5,
        })
        continue
      }

      if (lifeHit?.type === 'lose-life') {
        this.lives = lifeHit.lives
        this.cameras.main.shake(120, 0.004)
        if (lifeHit.gameover) {
          this.status = 'gameover'
          this.instructionPhase = 'gameover'
          this.message = 'No hearts left.'
          nextChasers.push(nextChaser)
          nextChasers.push(...this.chasers.slice(index + 1))
          break
        }

        nextChasers.push(nextChaser)
        nextChasers.push(...this.chasers.slice(index + 1))
        this.chasers = nextChasers
        this.respawnAfterCaught()
        return
      }

      nextChasers.push(nextChaser)
    }

    this.chasers = nextChasers
  }

  private respawnAfterCaught(): void {
    const safeTile = chooseSafeRespawnTile(
      this.level,
      this.level.playerStart,
      this.chasers.flatMap((chaser) => [chaser.tile, chaser.nextTile]),
      4,
      (point) => isInRescueZone(point, this.level.hostage, this.settings.rescueZoneSize),
    )
    this.player = createStepActor(safeTile)
    this.queuedDirection = stoppedDirection
    this.frightRemaining = 0
    this.invincibleRemaining = RESPAWN_INVINCIBLE_SECONDS
    this.instructionPhase = 'lost-life'
    this.message = `${this.lives} heart${this.lives === 1 ? '' : 's'} left.`
  }

  private chaserMoveSpeed(): number {
    return this.settings.chaserSpeed
  }

  private checkHostage(): void {
    if (!isInRescueZone(this.player.tile, this.level.hostage, this.settings.rescueZoneSize)) {
      return
    }

    const progress = this.progress()
    if (canRescue(progress, this.settings)) {
      this.status = 'won'
      this.message = 'Cat hostage rescued.'
      this.instructionPhase = 'won'
      this.cameras.main.flash(220, 255, 232, 166, false)
      return
    }

    this.message = `Need ${Math.max(0, this.requiredKeys() - progress.keysCollected)} more key(s) and ${Math.max(0, rescueCoinGoal(progress.totalCoins, this.settings.coinGoalPercent) - progress.coinsCollected)} more coin(s).`
  }

  private readInput(): JoystickInput {
    const joystick = this.options.getJoystick()
    const keyboard = {
      x: (this.keys?.right.isDown || this.keys?.d.isDown ? 1 : 0) - (this.keys?.left.isDown || this.keys?.a.isDown ? 1 : 0),
      y: (this.keys?.down.isDown || this.keys?.s.isDown ? 1 : 0) - (this.keys?.up.isDown || this.keys?.w.isDown ? 1 : 0),
    }
    return Math.hypot(joystick.x, joystick.y) > 0.22 ? joystick : keyboard
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    if (!this.options.editorMode) {
      return
    }

    this.computeBoardRect(0)
    const x = Math.floor((pointer.x - this.boardRect.x) / this.boardRect.tile)
    const y = Math.floor((pointer.y - this.boardRect.y) / this.boardRect.tile)
    if (x >= 0 && y >= 0 && x < this.level.width && y < this.level.height) {
      this.options.onTileClick(x, y)
    }
  }

  private emitRuntime(force: boolean): void {
    const progress = this.progress()
    const playerPosition = actorPosition(this.player, this.level)
    const instruction = instructionForProgress(
      progress,
      this.settings,
      this.instructionPhase,
      Boolean(this.objective.lockedKey && !this.objective.lockedKeyRevealed),
    )
    const snapshot: RuntimeSnapshot = {
      ...progress,
      status: this.status,
      message: this.options.editorMode ? 'Editing map. Switch to Play to move.' : this.message,
      instruction: instruction.text,
      instructionPhase: instruction.phase,
      playerScreenPosition: {
        x: this.cx(playerPosition.x),
        y: this.cy(playerPosition.y),
      },
      coinGoal: rescueCoinGoal(progress.totalCoins, this.settings.coinGoalPercent),
      requiredKeys: this.requiredKeys(),
      lives: this.lives,
      maxLives: MAX_LIVES,
      keysVisible: keyProgress(this.objective).keysVisible,
      frightRemaining: Math.ceil(this.frightRemaining),
      chasersEaten: this.chasersEaten,
    }
    const signature = JSON.stringify(snapshot)
    if (force || signature !== this.lastRuntime) {
      this.lastRuntime = signature
      this.options.onRuntime(snapshot)
    }
  }

  private progress() {
    const keys = keyProgress(this.objective)
    return {
      coinsCollected: collectedCoins(this.objective),
      totalCoins: this.objective.totalCoins,
      keysCollected: keys.keysCollected,
      totalKeys: this.objective.totalKeys,
    }
  }

  private keysCollected(): number {
    return keyProgress(this.objective).keysCollected
  }

  private requiredKeys(): number {
    return requiredKeysForRescue(this.progress(), this.settings)
  }

  private render(): void {
    if (!this.graphics) {
      return
    }

    const g = this.graphics
    g.clear()
    if (!this.isTransparentFloor()) {
      g.fillStyle(this.floorColor(), 1)
      g.fillRect(0, 0, this.scale.width || WORLD_WIDTH, this.scale.height || WORLD_HEIGHT)
    }
    this.drawGrid(g)
    this.drawCollectibles(g)
    this.drawHostage(g)
    if (this.settings.enemySkin === 'vacuum' && this.textures.exists(VACUUM_ENEMY_KEY)) {
      this.drawVacuumChasers()
    } else {
      this.hideChaserSprites()
      this.drawChasers(g)
    }
    this.drawPlayer(g)
    if (this.options.editorMode) {
      this.drawEditorOverlay(g)
    }
  }

  private drawGrid(g: Phaser.GameObjects.Graphics): void {
    if (!this.isTransparentFloor()) {
      g.fillStyle(this.floorColor(), 1)
      g.fillRect(this.boardRect.x, this.boardRect.y, this.boardRect.width, this.boardRect.height)
    }

    if (this.options.editorMode) {
      g.lineStyle(1, 0x1ec759, 0.34)
      for (let x = 0; x <= this.level.width; x += 1) {
        const px = this.boardRect.x + x * this.boardRect.tile
        g.lineBetween(px, this.boardRect.y, px, this.boardRect.y + this.boardRect.height)
      }
      for (let y = 0; y <= this.level.height; y += 1) {
        const py = this.boardRect.y + y * this.boardRect.tile
        g.lineBetween(this.boardRect.x, py, this.boardRect.x + this.boardRect.width, py)
      }
    }

    const wallColor = this.wallColor()
    const edgeWidth = Math.max(3, this.boardRect.tile * 0.14)
    const glowWidth = Math.max(1, this.boardRect.tile * 0.035)
    g.lineStyle(edgeWidth, wallColor.edge, 0.96)
    this.drawMazeBoundaries(g)
    this.drawMazeBoundaryJoints(g, edgeWidth * 0.5, wallColor.edge, 0.96)
    g.lineStyle(glowWidth, wallColor.glow, 0.82)
    this.drawMazeBoundaries(g)
    this.drawMazeBoundaryJoints(g, glowWidth * 0.5, wallColor.glow, 0.82)
  }

  private drawMazeBoundaries(g: Phaser.GameObjects.Graphics): void {
    for (const segment of this.mazeBoundarySegments()) {
      g.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2)
    }
  }

  private drawMazeBoundaryJoints(g: Phaser.GameObjects.Graphics, radius: number, color: number, alpha: number): void {
    const points = new Map<string, { x: number; y: number }>()
    for (const segment of this.mazeBoundarySegments()) {
      points.set(`${segment.x1}:${segment.y1}`, { x: segment.x1, y: segment.y1 })
      points.set(`${segment.x2}:${segment.y2}`, { x: segment.x2, y: segment.y2 })
    }

    g.fillStyle(color, alpha)
    for (const point of points.values()) {
      g.fillCircle(point.x, point.y, radius)
    }
  }

  private mazeBoundarySegments(): MazeBoundarySegment[] {
    const segments: MazeBoundarySegment[] = []
    for (let y = 0; y < this.level.height; y += 1) {
      for (let x = 0; x < this.level.width; x += 1) {
        if (this.level.rows[y][x] !== '#') {
          continue
        }
        const left = this.boardRect.x + x * this.boardRect.tile
        const top = this.boardRect.y + y * this.boardRect.tile
        const right = left + this.boardRect.tile
        const bottom = top + this.boardRect.tile
        if (!this.isWallCell(x, y - 1)) segments.push({ x1: left, y1: top, x2: right, y2: top })
        if (!this.isWallCell(x + 1, y)) segments.push({ x1: right, y1: top, x2: right, y2: bottom })
        if (!this.isWallCell(x, y + 1)) segments.push({ x1: left, y1: bottom, x2: right, y2: bottom })
        if (!this.isWallCell(x - 1, y)) segments.push({ x1: left, y1: top, x2: left, y2: bottom })
      }
    }
    return segments
  }

  private isWallCell(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.level.width || y >= this.level.height) {
      return true
    }
    return this.level.rows[y][x] === '#'
  }

  private drawCollectibles(g: Phaser.GameObjects.Graphics): void {
    if (this.settings.coinSkin === 'coin' && this.textures.exists(COIN_SPRITE_KEY)) {
      this.drawCoinSprites()
    } else {
      this.hideCoinSprites()
      for (const key of this.objective.coins) {
        const point = parseKey(key)
        g.fillStyle(this.coinDotColor(), 1)
        g.fillCircle(this.cx(point.x), this.cy(point.y), this.boardRect.tile * 0.09)
      }
    }
    for (const key of visibleUncollectedKeys(this.objective)) {
      const point = parseKey(key)
      this.drawKey(g, point.x, point.y)
    }
    for (const key of this.powerPellets) {
      const point = parseKey(key)
      g.fillStyle(POWER_COLOR, 1)
      g.fillCircle(this.cx(point.x), this.cy(point.y), this.boardRect.tile * 0.21)
      g.lineStyle(2, 0xffffff, 0.52)
      g.strokeCircle(this.cx(point.x), this.cy(point.y), this.boardRect.tile * 0.27)
    }
  }

  private drawCoinSprites(): void {
    const coins = [...this.objective.coins]
    for (let index = 0; index < coins.length; index += 1) {
      const point = parseKey(coins[index])
      const sprite = this.coinSprites[index] ?? this.add.image(0, 0, COIN_SPRITE_KEY).setOrigin(0.5).setDepth(1)
      this.coinSprites[index] = sprite
      const pulse = 1 + Math.sin(this.elapsed * 7 + point.x + point.y) * 0.1
      const size = this.boardRect.tile * 0.44 * pulse
      sprite
        .setVisible(true)
        .setPosition(this.cx(point.x), this.cy(point.y))
        .setDisplaySize(size, size)
    }

    for (let index = coins.length; index < this.coinSprites.length; index += 1) {
      this.coinSprites[index].setVisible(false)
    }
  }

  private hideCoinSprites(): void {
    for (const sprite of this.coinSprites) {
      sprite.setVisible(false)
    }
  }

  private drawHostage(g: Phaser.GameObjects.Graphics): void {
    const locked = !canRescue(this.progress(), this.settings)
    const lockedByKeys = this.keysCollected() < this.requiredKeys()
    const x = this.cx(this.level.hostage.x)
    const y = this.cy(this.level.hostage.y)
    const zone = this.settings.rescueZoneSize * this.boardRect.tile
    if (this.settings.rescueZoneSize > 1) {
      g.fillStyle(locked ? 0x354056 : 0x163d2e, locked ? 0.2 : 0.32)
      g.fillRoundedRect(x - zone / 2, y - zone / 2, zone, zone, Math.max(4, this.boardRect.tile * 0.16))
    }

    if (this.textures.exists(RESCUE_CAT_KEY)) {
      const sprite = this.hostageSprite ?? this.add.image(0, 0, RESCUE_CAT_KEY).setOrigin(0.5, 0.56).setDepth(2)
      this.hostageSprite = sprite
      const bob = Math.sin(this.elapsed * 3 + this.level.hostage.x) * this.boardRect.tile * 0.04
      const size = this.boardRect.tile * (locked ? 0.84 : 0.92)
      sprite
        .setVisible(true)
        .setPosition(x, y + bob)
        .setDisplaySize(size, size * 0.88)
        .setAlpha(lockedByKeys ? 0.5 : locked ? 0.72 : 1)
      if (lockedByKeys) {
        sprite.setTint(0xd6d6d6)
      } else if (locked) {
        sprite.setTint(0xffeed4)
      } else {
        sprite.clearTint()
      }
      return
    }

    g.fillStyle(HOSTAGE_COLOR, locked ? 0.42 : 1)
    g.fillCircle(x, y, this.boardRect.tile * 0.28)
    g.lineStyle(2, locked ? 0xffd84d : 0xffffff, 0.82)
    g.strokeCircle(x, y, this.boardRect.tile * 0.38)
    if (locked) {
      g.lineBetween(x - this.boardRect.tile * 0.24, y, x + this.boardRect.tile * 0.24, y)
      g.lineBetween(x, y - this.boardRect.tile * 0.24, x, y + this.boardRect.tile * 0.24)
    }
  }

  private drawChasers(g: Phaser.GameObjects.Graphics): void {
    for (const chaser of this.chasers) {
      const position = actorPosition(chaser, this.level)
      const x = this.cx(position.x)
      const y = this.cy(position.y)
      const radius = this.boardRect.tile * 0.34
      const color = chaser.inactive > 0 ? EATEN_COLOR : this.frightRemaining > 0 ? FRIGHT_COLOR : this.ghostColor(chaser.ghostType)
      g.fillStyle(color, chaser.inactive > 0 ? 0.45 : 1)
      g.fillCircle(x, y, radius)
      g.fillRect(x - radius, y, radius * 2, radius * 0.9)
      g.fillStyle(0xffffff, 1)
      g.fillCircle(x - radius * 0.32, y - radius * 0.12, radius * 0.16)
      g.fillCircle(x + radius * 0.32, y - radius * 0.12, radius * 0.16)
      g.fillStyle(0x111827, 1)
      g.fillCircle(x - radius * 0.29, y - radius * 0.1, radius * 0.07)
      g.fillCircle(x + radius * 0.35, y - radius * 0.1, radius * 0.07)
      if (chaser.ghostType === 'patroller' && chaser.inactive <= 0 && this.frightRemaining <= 0) {
        g.lineStyle(Math.max(2, this.boardRect.tile * 0.05), 0x111827, 0.85)
        g.lineBetween(x - radius * 0.5, y + radius * 0.36, x + radius * 0.5, y + radius * 0.36)
      }
    }
  }

  private drawVacuumChasers(): void {
    for (let index = 0; index < this.chasers.length; index += 1) {
      const chaser = this.chasers[index]
      const position = actorPosition(chaser, this.level)
      const sprite = this.chaserSprites[index] ?? this.add.image(0, 0, VACUUM_ENEMY_KEY).setOrigin(0.5).setDepth(2)
      this.chaserSprites[index] = sprite

      const size = this.boardRect.tile * (chaser.inactive > 0 ? 1 : 1.34)
      const movingUp = chaser.direction.y < 0
      const weakFrame = this.frightRemaining > 0 && chaser.inactive <= 0 && Math.floor(this.elapsed * 5 + index) % 2 === 0
      sprite
        .setTexture(weakFrame ? VACUUM_WEAK_ENEMY_KEY : VACUUM_ENEMY_KEY)
        .setVisible(true)
        .setPosition(this.cx(position.x), this.cy(position.y))
        .setDisplaySize(size, size)
        .setAlpha(chaser.inactive > 0 ? 0.42 : 1)
        .setFlipX(chaser.direction.x < 0 || movingUp)
        .setFlipY(movingUp)

      sprite.clearTint()
      if (chaser.inactive > 0) {
        sprite.setTint(EATEN_COLOR)
      }
    }

    for (let index = this.chasers.length; index < this.chaserSprites.length; index += 1) {
      this.chaserSprites[index].setVisible(false)
    }
  }

  private hideChaserSprites(): void {
    for (const sprite of this.chaserSprites) {
      sprite.setVisible(false)
    }
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics): void {
    if (this.settings.playerSkin !== 'classic' && this.textures.exists(this.eyeCatTextureKey())) {
      this.drawEyeCatPlayer()
      return
    }

    this.hidePlayerSprite()
    const position = actorPosition(this.player, this.level)
    const x = this.cx(position.x)
    const y = this.cy(position.y)
    const radius = this.boardRect.tile * 0.36
    const mouth = Math.abs(Math.sin(this.elapsed * 9)) * 0.28 + 0.16
    const alpha = this.invincibleRemaining > 0 && Math.floor(this.elapsed * 12) % 2 === 0 ? 0.38 : 1
    g.fillStyle(PLAYER_COLOR, alpha)
    g.slice(x, y, radius, mouth, Math.PI * 2 - mouth, false)
    g.fillPath()
    g.fillStyle(0x111827, 1)
    g.fillCircle(x + radius * 0.1, y - radius * 0.42, Math.max(2, radius * 0.1))
  }

  private drawEyeCatPlayer(): void {
    const position = actorPosition(this.player, this.level)
    const textureKey = this.eyeCatTextureKey()
    if (this.playerSprite?.texture.key !== textureKey) {
      this.playerSprite?.destroy()
      this.playerSprite = undefined
    }
    const sprite = this.playerSprite ?? this.add.image(0, 0, textureKey).setOrigin(0.5).setDepth(3)
    this.playerSprite = sprite

    const alpha = this.invincibleRemaining > 0 && Math.floor(this.elapsed * 12) % 2 === 0 ? 0.42 : 1
    const bob = Math.sin(this.elapsed * 8) * this.boardRect.tile * 0.035
    const size = this.boardRect.tile * (0.9 + Math.sin(this.elapsed * 5) * 0.015)
    sprite
      .setVisible(true)
      .setPosition(this.cx(position.x), this.cy(position.y) + bob)
      .setDisplaySize(size, size)
      .setAlpha(alpha)
      .setFlipX(this.playerFacingX < 0)
      .setFlipY(false)
  }

  private hidePlayerSprite(): void {
    this.playerSprite?.setVisible(false)
  }

  private eyeCatTextureKey(): string {
    if (this.settings.playerSkin === 'eye-cat-plain') return EYE_CAT_PLAIN_PLAYER_KEY
    return this.settings.playerSkin === 'eye-cat-white' ? EYE_CAT_WHITE_PLAYER_KEY : EYE_CAT_BRONZE_PLAYER_KEY
  }

  private coinDotColor(): number {
    return this.settings.coinSkin === 'vacuum-orange-dot' ? VACUUM_ORANGE_COIN_COLOR : COIN_COLOR
  }

  private drawEditorOverlay(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2, 0xf6d365, 0.75)
    g.strokeRect(this.boardRect.x, this.boardRect.y, this.boardRect.width, this.boardRect.height)
  }

  private drawKey(g: Phaser.GameObjects.Graphics, cellX: number, cellY: number): void {
    const scale = this.boardRect.tile
    const pulse = this.elapsed % 5
    const wiggle = pulse < 0.75 ? Math.sin(pulse * Math.PI * 8) : 0
    const bob = pulse < 0.75 ? Math.sin(pulse * Math.PI * 4) : 0
    const x = this.cx(cellX) + wiggle * scale * 0.035
    const y = this.cy(cellY) + bob * scale * 0.025
    const alpha = pulse < 0.75 ? 1 : 0.9
    g.lineStyle(Math.max(2, scale * 0.08), KEY_COLOR, alpha)
    g.strokeCircle(x - scale * 0.12, y, scale * 0.15)
    g.lineBetween(x, y, x + scale * 0.26, y)
    g.lineBetween(x + scale * 0.18, y, x + scale * 0.18, y + scale * 0.13)
    g.lineBetween(x + scale * 0.28, y, x + scale * 0.28, y + scale * 0.1)
  }

  private playerMoveSpeed(): number {
    return this.frightRemaining > 0 ? this.settings.playerSpeed * POWER_SPEED_MULTIPLIER : this.settings.playerSpeed
  }

  private computeBoardRect(delta: number): void {
    const width = this.scale.width || WORLD_WIDTH
    const height = this.scale.height || WORLD_HEIGHT
    const padding = 18
    const cameraViewTiles = this.options.editorMode ? 0 : this.settings.cameraViewTiles
    const tile = cameraViewTiles > 0
      ? Math.floor((width - padding * 2) / cameraViewTiles)
      : Math.floor(Math.min((width - padding * 2) / this.level.width, (height - padding * 2) / this.level.height))
    const safeTile = Math.max(12, tile)
    const boardWidth = safeTile * this.level.width
    const boardHeight = safeTile * this.level.height
    const playerPosition = actorPosition(this.player, this.level)
    const centeredX = width / 2 - (playerPosition.x + 0.5) * safeTile
    const centeredY = height / 2 - (playerPosition.y + 0.5) * safeTile
    const targetX = cameraViewTiles > 0 ? clampBoardOffset(centeredX, width, boardWidth, padding) : (width - boardWidth) / 2
    const targetY = cameraViewTiles > 0 ? clampBoardOffset(centeredY, height, boardHeight, padding) : (height - boardHeight) / 2
    const canSmooth = cameraViewTiles > 0 && delta > 0 && this.cameraOffset?.tile === safeTile && this.cameraOffset.viewTiles === cameraViewTiles
    const smooth = canSmooth ? 1 - Math.exp(-CAMERA_SMOOTHING * delta) : 1
    const x = this.cameraOffset ? Phaser.Math.Linear(this.cameraOffset.x, targetX, smooth) : targetX
    const y = this.cameraOffset ? Phaser.Math.Linear(this.cameraOffset.y, targetY, smooth) : targetY
    this.cameraOffset = { x, y, tile: safeTile, viewTiles: cameraViewTiles }

    this.boardRect = {
      x,
      y,
      width: boardWidth,
      height: boardHeight,
      tile: safeTile,
    }
  }

  private cx(x: number): number {
    return this.boardRect.x + (x + 0.5) * this.boardRect.tile
  }

  private cy(y: number): number {
    return this.boardRect.y + (y + 0.5) * this.boardRect.tile
  }

  private ghostColor(ghostType: GhostType): number {
    return ghostType === 'patroller' ? PATROLLER_COLOR : CHASER_COLOR
  }

  private floorColor(): number {
    if (this.settings.mazeFloor === 'dusty-rose') return 0x9f6a60
    if (this.settings.mazeFloor === 'stage-salmon') return 0xc98176
    if (this.settings.mazeFloor === 'spotlight') return 0xf1dfbd
    if (this.settings.mazeFloor === 'soft-mauve') return 0xb17a72
    if (this.settings.mazeFloor === 'warm-clay') return 0x7b5149
    return 0x000000
  }

  private isTransparentFloor(): boolean {
    return this.settings.mazeFloor === 'transparent'
  }

  private wallColor(): { edge: number; glow: number } {
    if (this.settings.mazeWall === 'laser-cyan') return { edge: 0x00b7ff, glow: 0x79f7ff }
    if (this.settings.mazeWall === 'neon-pink') return { edge: 0xff2aa6, glow: 0xff8fd1 }
    if (this.settings.mazeWall === 'acid-lime') return { edge: 0x72ff4d, glow: 0xc7ff6b }
    if (this.settings.mazeWall === 'hot-violet') return { edge: 0x8b5cff, glow: 0xd78bff }
    if (this.settings.mazeWall === 'arcade-amber') return { edge: 0xff9f1c, glow: 0xffdf6e }
    if (this.settings.mazeWall === 'spotlight-cream') return { edge: 0xfff2c9, glow: 0xfff9e8 }
    if (this.settings.mazeWall === 'neon-teal') return { edge: 0x00b69d, glow: 0x62ffe5 }
    if (this.settings.mazeWall === 'turquoise') return { edge: 0x21d8d0, glow: 0xa0fff6 }
    if (this.settings.mazeWall === 'cobalt') return { edge: 0x2855ff, glow: 0x8aa6ff }
    if (this.settings.mazeWall === 'deep-navy') return { edge: 0x102a8c, glow: 0x4f72ff }
    if (this.settings.mazeWall === 'vacuum-orange') return { edge: 0xe85b2e, glow: 0xffa06f }
    if (this.settings.mazeWall === 'coral-beam') return { edge: 0xf28b7d, glow: 0xffc1a8 }
    if (this.settings.mazeWall === 'dusty-mauve') return { edge: 0xaa6f67, glow: 0xe8a094 }
    if (this.settings.mazeWall === 'ember-red') return { edge: 0x8f2c1c, glow: 0xde5b3f }
    return { edge: 0x143bff, glow: 0x39d9ff }
  }
}

function directionFromInput(input: JoystickInput, current: Direction): Direction {
  const x = Math.abs(input.x)
  const y = Math.abs(input.y)
  if (Math.hypot(input.x, input.y) <= 0.22) {
    return stoppedDirection
  }

  const dominance = 1.2
  const horizontal = x >= y * dominance
  const vertical = y >= x * dominance

  if (horizontal) {
    return { x: Math.sign(input.x), y: 0 }
  }
  if (vertical) {
    return { x: 0, y: Math.sign(input.y) }
  }
  if (sameTile(current, stoppedDirection)) {
    return x >= y ? { x: Math.sign(input.x), y: 0 } : { x: 0, y: Math.sign(input.y) }
  }

  return stoppedDirection
}

function parseKey(key: string): GridPoint {
  const [x, y] = key.split(',').map(Number)
  return { x, y }
}

function clampBoardOffset(offset: number, viewport: number, board: number, padding: number): number {
  if (board <= viewport - padding * 2) {
    return (viewport - board) / 2
  }

  return Math.min(padding, Math.max(viewport - padding - board, offset))
}
