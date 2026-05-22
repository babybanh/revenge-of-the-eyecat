import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Phaser from 'phaser'
import './App.css'
import { defaultPacRescueLevelMaps, defaultPacRescueSettings } from './game/pacrescue/defaults'
import { capMapTextCounts, mapCounts, parseMapText, rebalanceMapText, sanitizeSettings } from './game/pacrescue/map'
import { createDelayedKeyState } from './game/pacrescue/objective'
import { nextLevelIndex } from './game/pacrescue/progression'
import type { InstructionPhase, MazeFloor, MazeWall, PacRescueSettings, RuntimeSnapshot } from './game/pacrescue/types'
import { gameConfig } from './game/config/gameConfig'
import { PacRescueScene, type JoystickInput } from './game/scenes/PacRescueScene'

const BACKGROUND_PATH = gameConfig.assets.background
const MUSIC_PATH = gameConfig.assets.music
const HEART = '\u2665'
const ZERO_INPUT: JoystickInput = { x: 0, y: 0 }
const PHASER_WORLD_SIZE = 672
const LEVEL_INSTRUCTION_DURATION = 2600
const EVENT_INSTRUCTION_DURATION = 2200
const LEVEL_INSTRUCTION_DELAY = 1800
const IDLE_KEY_REMINDER_MS = 5000
const RESCUE_REMINDER_MS = 10000
const INSTRUCTION_RETRY_MS = 900
const POWER_INSTRUCTION_BUFFER_MS = 200
const KEYBOARD_JOYSTICK_HIDE_MS = 1800
const MUSIC_VOLUME = 0.36
const SFX_VOLUME = 0.38
type IntroPhase = 'waiting' | 'rescuing' | 'rescued'
const SFX_PATHS = {
  coin: '/audio/sfx/eyecat-coin.wav',
  key: '/audio/sfx/eyecat-key.wav',
  hit: '/audio/sfx/eyecat-hit.wav',
  win: '/audio/sfx/eyecat-win.wav',
  gameover: '/audio/sfx/eyecat-gameover.wav',
} as const
const PRELOAD_IMAGE_PATHS = [
  gameConfig.assets.background,
  gameConfig.assets.player,
  gameConfig.assets.hostage,
  gameConfig.assets.vacuum,
  '/characters/item-key.png',
  '/characters/item-key-green.png',
  '/characters/item-power-up.png',
  '/characters/item-power-up-yellow.png',
  gameConfig.assets.concept,
]

type SfxType = keyof typeof SFX_PATHS
const INTRO_RESCUE_SFX: SfxType = 'key'
const SFX_POOL_SIZES: Record<SfxType, number> = {
  coin: 6,
  key: 2,
  hit: 2,
  win: 2,
  gameover: 1,
}
const SFX_MIN_INTERVAL_MS: Partial<Record<SfxType, number>> = {
  coin: 120,
}
type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

type MapPreset = {
  id: string
  name: string
  tagline: string
  mapText: string
  settings: PacRescueSettings
}

type HeartLossPopup = {
  id: number
  x?: number
  y?: number
}

const baseSettings = sanitizeSettings({
  ...defaultPacRescueSettings,
  cameraViewTiles: 0,
  enemySkin: 'vacuum',
  playerSkin: 'eye-cat-plain',
  coinSkin: 'dot',
  mazeFloor: 'transparent',
  mazeWall: 'spotlight-cream',
  stageBackground: 'lab-final-ruin-2',
  stageBackgroundScale: 100,
  playerSpeed: 3.6,
  chaserSpeed: 1.65,
  chaseRadius: 10,
  keyCount: 3,
  requiredKeys: 3,
  coinGoalPercent: 42,
  frightDuration: 7,
  rescueZoneSize: 1,
  wanderTurnInterval: 0.9,
})

const levelTuning: Array<Partial<PacRescueSettings>> = [
  { chaserCount: 1, keyCount: 1, requiredKeys: 1, coinGoalPercent: 25, chaserSpeed: 1.1 },
  { chaserCount: 1, keyCount: 1, requiredKeys: 1, coinGoalPercent: 30, chaserSpeed: 1.2 },
  { chaserCount: 2, keyCount: 2, requiredKeys: 2, coinGoalPercent: 35, chaserSpeed: 1.35 },
  { chaserCount: 2, keyCount: 3, requiredKeys: 3, coinGoalPercent: 40, chaserSpeed: 1.45 },
  { chaserCount: 2, keyCount: 2, requiredKeys: 2, coinGoalPercent: 42, chaserSpeed: 1.55 },
  { chaserCount: 4, keyCount: 4, requiredKeys: 4, coinGoalPercent: 45, chaserSpeed: 1.55 },
  { chaserCount: 4, keyCount: 4, requiredKeys: 4, coinGoalPercent: 50, chaserSpeed: 1.65 },
]

const levelTaglines = [
  'First tiny rescue route',
  'A small ruin with an open tunnel',
  'Two-vacuum path reading',
  'Key pockets and tighter turns',
  'Longer rescue lane pressure',
  'Symmetric stage with four vacuums',
  'Final sandbox draft with the full patrol set',
]

const mapPresets: MapPreset[] = defaultPacRescueLevelMaps.map((level, index) => (
  makePreset(
    `level-${index + 1}`,
    level.name,
    levelTaglines[index] ?? 'Ruin rescue route',
    level.mapText,
    levelTuning[index] ?? {},
  )
))

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const musicEnabledRef = useRef(true)
  const musicStartedRef = useRef(false)
  const sfxPlayersRef = useRef(new Map<SfxType, HTMLAudioElement[]>())
  const sfxCursorRef = useRef(new Map<SfxType, number>())
  const lastSfxAtRef = useRef(new Map<SfxType, number>())
  const sfxContextRef = useRef<AudioContext | null>(null)
  const sfxBuffersRef = useRef(new Map<SfxType, AudioBuffer>())
  const sfxBufferLoadsRef = useRef(new Map<SfxType, Promise<AudioBuffer | null>>())
  const queuedSfxRef = useRef<SfxType[]>([])
  const joystickRef = useRef<JoystickInput>({ x: 0, y: 0 })
  const levelPausedRef = useRef(false)
  const keyboardStartRef = useRef(false)
  const runtimeRef = useRef<RuntimeSnapshot | null>(null)
  const previousRuntime = useRef<RuntimeSnapshot | null>(null)
  const instructionVisibleRef = useRef(false)
  const instructionTimer = useRef<number | undefined>(undefined)
  const delayedInstructionTimer = useRef<number | undefined>(undefined)
  const keyReminderTimer = useRef<number | undefined>(undefined)
  const keyReminderShown = useRef(false)
  const rescueReminderTimer = useRef<number | undefined>(undefined)
  const rescueReminderShown = useRef(false)
  const keyboardJoystickTimer = useRef<number | undefined>(undefined)
  const introRescueTimer = useRef<number | undefined>(undefined)
  const introHandoffTimer = useRef<number | undefined>(undefined)
  const introPhaseRef = useRef<IntroPhase>('waiting')
  const introInputHeldRef = useRef(false)
  const postIntroInputLockedRef = useRef(false)
  const introRescueSfxPlayedRef = useRef(false)
  const musicPrimeTimer = useRef<number | undefined>(undefined)
  const musicPrimedRef = useRef(false)
  const musicWasPlayingBeforeHidden = useRef(false)
  const sfxPrimedRef = useRef(false)
  const sfxPrimePendingRef = useRef(false)
  const audioUnlockedRef = useRef(false)
  const pendingAfterPowerInstruction = useRef<{ text: string; phase: InstructionPhase } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [mapText, setMapText] = useState(mapPresets[0].mapText)
  const [settings, setSettings] = useState(mapPresets[0].settings)
  const [runtime, setRuntime] = useState(() => createInitialRuntime(mapText, settings))
  const [started, setStarted] = useState(false)
  const [introPhase, setIntroPhase] = useState<IntroPhase>('waiting')
  const [levelPaused, setLevelPaused] = useState(false)
  const [instructionVisible, setInstructionVisible] = useState(false)
  const [instructionText, setInstructionText] = useState('')
  const [instructionPhase, setInstructionPhase] = useState<InstructionPhase>('find-key')
  const [restartToken, setRestartToken] = useState(0)
  const [musicEnabled, setMusicEnabled] = useState(true)
  const [musicStarted, setMusicStarted] = useState(false)
  const [keyboardJoystickHidden, setKeyboardJoystickHidden] = useState(false)
  const [heartLossPopup, setHeartLossPopup] = useState<HeartLossPopup | null>(null)
  const [showCredits, setShowCredits] = useState(false)
  const [showConcept, setShowConcept] = useState(false)
  const [showFinalClear, setShowFinalClear] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const counts = useMemo(() => mapCounts(mapText), [mapText])
  const finished = runtime.status === 'won' || runtime.status === 'gameover'
  const modalOpen = showCredits || showConcept || showFinalClear
  const shellStyle = useMemo(() => ({
    '--stage-bg': `url("${BACKGROUND_PATH}")`,
    '--spot-joy-x': `${toPercent(gameConfig.layout.joystick.x, gameConfig.layout.designWidth)}`,
    '--spot-joy-y': `${toPercent(gameConfig.layout.joystick.y, gameConfig.layout.designHeight)}`,
    '--spot-joy-r': `${toPercent(gameConfig.layout.joystick.radius, gameConfig.layout.designWidth)}`,
  }) as CSSProperties, [])

  const getSfxPlayers = useCallback((type: SfxType) => {
    const existing = sfxPlayersRef.current.get(type)
    if (existing) return existing
    const players = Array.from({ length: SFX_POOL_SIZES[type] }, () => {
      const player = new Audio(SFX_PATHS[type])
      player.preload = 'auto'
      ;(player as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
      player.volume = SFX_VOLUME
      player.load()
      return player
    })
    sfxPlayersRef.current.set(type, players)
    return players
  }, [])

  const getSfxContext = useCallback(() => {
    if (sfxContextRef.current) return sfxContextRef.current
    const AudioContextCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!AudioContextCtor) return null
    const context = new AudioContextCtor()
    sfxContextRef.current = context
    return context
  }, [])

  const loadSfxBuffer = useCallback((type: SfxType) => {
    const existing = sfxBuffersRef.current.get(type)
    if (existing) return Promise.resolve(existing)
    const existingLoad = sfxBufferLoadsRef.current.get(type)
    if (existingLoad) return existingLoad
    const context = getSfxContext()
    if (!context) return Promise.resolve(null)

    const load = fetch(SFX_PATHS[type])
      .then((response) => response.arrayBuffer())
      .then((buffer) => context.decodeAudioData(buffer))
      .then((buffer) => {
        sfxBuffersRef.current.set(type, buffer)
        return buffer
      })
      .catch(() => null)
      .finally(() => {
        sfxBufferLoadsRef.current.delete(type)
      })

    sfxBufferLoadsRef.current.set(type, load)
    return load
  }, [getSfxContext])

  const pulseSfxContextFromGesture = useCallback((context: AudioContext | null) => {
    if (!context) return
    try {
      const buffer = context.createBuffer(1, 1, 22050)
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(context.destination)
      source.start(0)
    } catch {
      // Some mobile browser shells are picky during unlock. A failed silent pulse should not block gameplay.
    }
  }, [])

  const playBufferedSfx = useCallback((type: SfxType) => {
    const context = getSfxContext()
    const buffer = sfxBuffersRef.current.get(type)
    if (!context || context.state !== 'running' || !buffer) return false

    const now = performance.now()
    const minInterval = SFX_MIN_INTERVAL_MS[type] ?? 0
    const lastPlayedAt = lastSfxAtRef.current.get(type) ?? 0
    if (minInterval > 0 && now - lastPlayedAt < minInterval) return true
    lastSfxAtRef.current.set(type, now)

    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    gain.gain.value = SFX_VOLUME
    source.connect(gain)
    gain.connect(context.destination)
    source.start()
    return true
  }, [getSfxContext])

  const playHtmlSfx = useCallback((type: SfxType, shouldQueueOnFailure = true, preferBuffered = true) => {
    if (preferBuffered && playBufferedSfx(type)) return

    const now = performance.now()
    const minInterval = SFX_MIN_INTERVAL_MS[type] ?? 0
    const lastPlayedAt = lastSfxAtRef.current.get(type) ?? 0
    if (minInterval > 0 && now - lastPlayedAt < minInterval) return
    lastSfxAtRef.current.set(type, now)

    const players = getSfxPlayers(type)
    const cursor = sfxCursorRef.current.get(type) ?? 0
    const availableOffset = players.findIndex((candidate) => candidate.paused || candidate.ended)
    const index = availableOffset >= 0 ? availableOffset : cursor % players.length
    const player = players[index]
    sfxCursorRef.current.set(type, (index + 1) % players.length)
    player.pause()
    player.currentTime = 0
    player.muted = false
    player.volume = SFX_VOLUME
    const sound = player.play()
    sound.catch(() => {
      sfxPrimedRef.current = false
      if (shouldQueueOnFailure) queuedSfxRef.current.push(type)
    })
  }, [getSfxPlayers, playBufferedSfx])

  const playSfxFile = useCallback((type: SfxType) => {
    if (shouldAvoidHtmlSfxFallbackForDevice()) {
      playHtmlSfx(type, type !== 'coin', false)
      return
    }
    if (playBufferedSfx(type)) return

    let usedHtmlFallback = false
    const context = getSfxContext()
    if (context?.state === 'suspended') {
      void context.resume().then(() => {
        if (!usedHtmlFallback) playBufferedSfx(type)
      })
    }
    void loadSfxBuffer(type).then((buffer) => {
      if (buffer && !usedHtmlFallback) playBufferedSfx(type)
    })

    usedHtmlFallback = true
    playHtmlSfx(type, type !== 'coin')
  }, [getSfxContext, loadSfxBuffer, playBufferedSfx, playHtmlSfx])

  const primeHtmlSfxPlayer = useCallback((player: HTMLAudioElement) => {
    player.muted = true
    player.volume = 0
    const prime = player.play()
    return Promise.resolve(prime)
      .then(() => {
        player.pause()
        player.currentTime = 0
      })
      .catch(() => undefined)
      .finally(() => {
        player.muted = false
        player.volume = SFX_VOLUME
      })
  }, [])

  const primeSfxFromGesture = useCallback(() => {
    if (sfxPrimedRef.current) {
      const queued = queuedSfxRef.current.splice(0, queuedSfxRef.current.length)
      for (const type of queued) playSfxFile(type)
      return
    }
    if (sfxPrimePendingRef.current) return
    sfxPrimePendingRef.current = true
    const players = (Object.keys(SFX_PATHS) as SfxType[]).filter((type) => type !== 'coin').flatMap(getSfxPlayers)

    if (shouldAvoidHtmlSfxFallbackForDevice()) {
      void Promise.allSettled(players.map(primeHtmlSfxPlayer)).then((results) => {
        sfxPrimedRef.current = results.some((result) => result.status === 'fulfilled')
        sfxPrimePendingRef.current = false
        if (!sfxPrimedRef.current) return
        const queued = queuedSfxRef.current.splice(0, queuedSfxRef.current.length)
        for (const type of queued) playSfxFile(type)
      }).catch(() => {
        sfxPrimePendingRef.current = false
      })
      return
    }

    const context = getSfxContext()
    pulseSfxContextFromGesture(context)
    const resume = context?.resume() ?? Promise.resolve()
    const bufferLoads = (Object.keys(SFX_PATHS) as SfxType[]).map(loadSfxBuffer)
    void Promise.allSettled([resume, ...bufferLoads]).then(() => {
      pulseSfxContextFromGesture(context)
      sfxPrimedRef.current = context?.state === 'running'
      sfxPrimePendingRef.current = false
      if (!sfxPrimedRef.current) return
      const queued = queuedSfxRef.current.splice(0, queuedSfxRef.current.length)
      for (const type of queued) playSfxFile(type)
    }).catch(() => {
      sfxPrimePendingRef.current = false
    })

    if (shouldAvoidHtmlSfxFallbackForDevice()) return

    void Promise.allSettled(players.map(primeHtmlSfxPlayer)).then((results) => {
      sfxPrimedRef.current = sfxPrimedRef.current || results.some((result) => result.status === 'fulfilled')
      sfxPrimePendingRef.current = false
      if (!sfxPrimedRef.current) return
      const queued = queuedSfxRef.current.splice(0, queuedSfxRef.current.length)
      for (const type of queued) playSfxFile(type)
    }).catch(() => {
      sfxPrimePendingRef.current = false
    })
  }, [getSfxContext, getSfxPlayers, loadSfxBuffer, playSfxFile, primeHtmlSfxPlayer, pulseSfxContextFromGesture])

  const unlockAudio = useCallback(() => {
    audioUnlockedRef.current = true
  }, [])

  const primeMusicFromGesture = useCallback(() => {
    const audio = musicRef.current
    if (!audio || musicPrimedRef.current || musicStartedRef.current || !musicEnabledRef.current) return
    musicPrimedRef.current = true
    audio.muted = true
    audio.volume = 0
    audio.loop = true
    const prime = audio.play()
    prime.catch(() => {
      if (!musicStartedRef.current) {
        musicPrimedRef.current = false
        audio.muted = false
        audio.volume = MUSIC_VOLUME
      }
    })
  }, [])

  const prepareAudioFromGesture = useCallback((options: { primeMusic?: boolean } = {}) => {
    unlockAudio()
    primeSfxFromGesture()
    if (options.primeMusic) primeMusicFromGesture()
  }, [primeMusicFromGesture, primeSfxFromGesture, unlockAudio])

  useEffect(() => {
    const prepare = () => prepareAudioFromGesture()
    window.addEventListener('pointerdown', prepare, { capture: true, passive: true })
    window.addEventListener('pointerup', prepare, { capture: true, passive: true })
    window.addEventListener('touchstart', prepare, { capture: true, passive: true })
    window.addEventListener('touchend', prepare, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', prepare, true)
      window.removeEventListener('pointerup', prepare, true)
      window.removeEventListener('touchstart', prepare, true)
      window.removeEventListener('touchend', prepare, true)
    }
  }, [prepareAudioFromGesture])

  const playSfx = useCallback((type: SfxType) => {
    if (!sfxPrimedRef.current) {
      queuedSfxRef.current.push(type)
      primeSfxFromGesture()
      return
    }
    playSfxFile(type)
  }, [playSfxFile, primeSfxFromGesture])

  const playIntroRescueSfx = useCallback(() => {
    if (introRescueSfxPlayedRef.current) return
    introRescueSfxPlayedRef.current = true
    unlockAudio()
    if (shouldAvoidHtmlSfxFallbackForDevice()) {
      if (!sfxPrimedRef.current) {
        queuedSfxRef.current.push(INTRO_RESCUE_SFX)
        primeSfxFromGesture()
        return
      }
      playHtmlSfx(INTRO_RESCUE_SFX, false, false)
      return
    }
    const context = getSfxContext()
    if (playBufferedSfx(INTRO_RESCUE_SFX)) return
    const resume = context?.state === 'suspended' ? context.resume() : Promise.resolve()
    void Promise.allSettled([resume, loadSfxBuffer(INTRO_RESCUE_SFX)]).then(() => {
      playBufferedSfx(INTRO_RESCUE_SFX)
    })
  }, [getSfxContext, loadSfxBuffer, playBufferedSfx, playHtmlSfx, primeSfxFromGesture, unlockAudio])

  useEffect(() => {
    musicEnabledRef.current = musicEnabled
    musicStartedRef.current = musicStarted
  }, [musicEnabled, musicStarted])

  useEffect(() => {
    const audio = musicRef.current
    if (!audio) return
    audio.volume = MUSIC_VOLUME
    audio.loop = true
    audio.preload = 'auto'
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audio.load()
  }, [])

  useEffect(() => {
    for (const type of Object.keys(SFX_PATHS) as SfxType[]) {
      void loadSfxBuffer(type)
    }
  }, [loadSfxBuffer])

  useEffect(() => {
    const images = PRELOAD_IMAGE_PATHS.map((path) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = path
      return image
    })
    return () => {
      images.length = 0
    }
  }, [])

  useEffect(() => {
    levelPausedRef.current = levelPaused
  }, [levelPaused])

  const setLevelPausedNow = useCallback((paused: boolean) => {
    levelPausedRef.current = paused
    setLevelPaused(paused)
  }, [])

  useEffect(() => {
    introPhaseRef.current = introPhase
  }, [introPhase])

  useEffect(() => {
    runtimeRef.current = runtime
  }, [runtime])

  useEffect(() => {
    instructionVisibleRef.current = instructionVisible
  }, [instructionVisible])

  useEffect(() => () => {
    if (instructionTimer.current) {
      window.clearTimeout(instructionTimer.current)
    }
    if (delayedInstructionTimer.current) {
      window.clearTimeout(delayedInstructionTimer.current)
    }
    if (keyReminderTimer.current) {
      window.clearTimeout(keyReminderTimer.current)
    }
    if (rescueReminderTimer.current) {
      window.clearTimeout(rescueReminderTimer.current)
    }
    if (keyboardJoystickTimer.current) {
      window.clearTimeout(keyboardJoystickTimer.current)
    }
    if (introRescueTimer.current) {
      window.clearTimeout(introRescueTimer.current)
    }
    if (introHandoffTimer.current) {
      window.clearTimeout(introHandoffTimer.current)
    }
    if (musicPrimeTimer.current) {
      window.clearTimeout(musicPrimeTimer.current)
    }
  }, [])

  const showInstruction = useCallback((text: string, phase: InstructionPhase = 'find-key', duration = EVENT_INSTRUCTION_DURATION) => {
    if (delayedInstructionTimer.current) {
      window.clearTimeout(delayedInstructionTimer.current)
      delayedInstructionTimer.current = undefined
    }
    setInstructionText(text)
    setInstructionPhase(phase)
    setInstructionVisible(true)
    if (instructionTimer.current) {
      window.clearTimeout(instructionTimer.current)
    }
    instructionTimer.current = window.setTimeout(() => setInstructionVisible(false), duration)
  }, [])

  const clearKeyReminder = useCallback(() => {
    if (keyReminderTimer.current) {
      window.clearTimeout(keyReminderTimer.current)
      keyReminderTimer.current = undefined
    }
  }, [])

  const clearRescueReminder = useCallback(() => {
    if (rescueReminderTimer.current) {
      window.clearTimeout(rescueReminderTimer.current)
      rescueReminderTimer.current = undefined
    }
  }, [])

  const scheduleKeyReminder = useCallback((snapshot: RuntimeSnapshot, delay = IDLE_KEY_REMINDER_MS) => {
    clearKeyReminder()
    if (keyReminderShown.current || snapshot.status !== 'playing' || snapshot.keysCollected >= snapshot.requiredKeys) return
    const showReminderIfAllowed = () => {
      const current = runtimeRef.current ?? snapshot
      if (keyReminderShown.current || current.status !== 'playing' || current.keysCollected >= current.requiredKeys) return
      if (levelPausedRef.current || current.frightRemaining > 0 || instructionVisibleRef.current || pendingAfterPowerInstruction.current) {
        keyReminderTimer.current = window.setTimeout(showReminderIfAllowed, INSTRUCTION_RETRY_MS)
        return
      }
      keyReminderTimer.current = undefined
      keyReminderShown.current = true
      showInstruction(startLevelInstruction(current), 'find-key', LEVEL_INSTRUCTION_DURATION)
    }
    keyReminderTimer.current = window.setTimeout(showReminderIfAllowed, delay)
  }, [clearKeyReminder, showInstruction])

  const scheduleRescueReminder = useCallback((snapshot: RuntimeSnapshot, delay = RESCUE_REMINDER_MS) => {
    clearRescueReminder()
    if (rescueReminderShown.current || snapshot.status !== 'playing' || snapshot.keysCollected < snapshot.requiredKeys) return
    const showReminderIfAllowed = () => {
      const current = runtimeRef.current ?? snapshot
      if (rescueReminderShown.current || current.status !== 'playing' || current.keysCollected < current.requiredKeys) return
      if (levelPausedRef.current || current.frightRemaining > 0 || instructionVisibleRef.current || pendingAfterPowerInstruction.current) {
        rescueReminderTimer.current = window.setTimeout(showReminderIfAllowed, INSTRUCTION_RETRY_MS)
        return
      }
      rescueReminderTimer.current = undefined
      rescueReminderShown.current = true
      showInstruction('Rescue the cat.', 'rescue', LEVEL_INSTRUCTION_DURATION)
    }
    rescueReminderTimer.current = window.setTimeout(showReminderIfAllowed, delay)
  }, [clearRescueReminder, showInstruction])

  const showLevelInstructionSoon = useCallback((snapshot: RuntimeSnapshot) => {
    if (delayedInstructionTimer.current) {
      window.clearTimeout(delayedInstructionTimer.current)
    }
    setInstructionVisible(false)
    setInstructionText('')
    keyReminderShown.current = false
    rescueReminderShown.current = false
    clearRescueReminder()
    delayedInstructionTimer.current = window.setTimeout(() => {
      delayedInstructionTimer.current = undefined
      scheduleKeyReminder(snapshot)
    }, LEVEL_INSTRUCTION_DELAY)
  }, [clearRescueReminder, scheduleKeyReminder])

  const resumeLevelFromPause = useCallback(() => {
    setLevelPausedNow(false)
    const current = runtimeRef.current ?? runtime
    if (current.status === 'playing' && current.keysCollected >= current.requiredKeys) {
      rescueReminderShown.current = false
      scheduleRescueReminder(current)
      return
    }
    showLevelInstructionSoon(current)
  }, [runtime, scheduleRescueReminder, setLevelPausedNow, showLevelInstructionSoon])

  const pauseForModal = useCallback(() => {
    if (!started || runtimeRef.current?.status !== 'playing') return
    joystickRef.current = ZERO_INPUT
    clearKeyReminder()
    clearRescueReminder()
    setLevelPausedNow(true)
    setInstructionVisible(false)
  }, [clearKeyReminder, clearRescueReminder, setLevelPausedNow, started])

  const openCredits = useCallback(() => {
    pauseForModal()
    setShowCredits(true)
  }, [pauseForModal])

  const openConcept = useCallback(() => {
    pauseForModal()
    setShowConcept(true)
  }, [pauseForModal])

  const hideJoystickForKeyboard = useCallback(() => {
    setKeyboardJoystickHidden(true)
    if (keyboardJoystickTimer.current) {
      window.clearTimeout(keyboardJoystickTimer.current)
    }
    keyboardJoystickTimer.current = window.setTimeout(() => {
      keyboardJoystickTimer.current = undefined
      setKeyboardJoystickHidden(false)
    }, KEYBOARD_JOYSTICK_HIDE_MS)
  }, [])

  const startMusicFromMovement = useCallback(() => {
    const audio = musicRef.current
    if (!audio || !musicEnabledRef.current || musicStartedRef.current) return
    if (musicPrimeTimer.current) {
      window.clearTimeout(musicPrimeTimer.current)
      musicPrimeTimer.current = undefined
    }
    audio.muted = false
    audio.volume = MUSIC_VOLUME
    audio.loop = true
    musicStartedRef.current = true
    if (!audio.paused) {
      setMusicStarted(true)
      return
    }
    void audio.play().then(() => {
      audio.muted = false
      audio.volume = MUSIC_VOLUME
      setMusicStarted(true)
    }).catch(() => {
      musicStartedRef.current = false
      setMusicStarted(false)
    })
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      const audio = musicRef.current
      if (!audio) return
      if (document.hidden) {
        musicWasPlayingBeforeHidden.current = !audio.paused && musicEnabledRef.current
        if (musicPrimeTimer.current) {
          window.clearTimeout(musicPrimeTimer.current)
          musicPrimeTimer.current = undefined
        }
        audio.pause()
        setMusicStarted(false)
        musicPrimedRef.current = false
        return
      }
      musicWasPlayingBeforeHidden.current = false
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const startGame = useCallback(() => {
    previousRuntime.current = null
    joystickRef.current = ZERO_INPUT
    postIntroInputLockedRef.current = keyboardStartRef.current && introInputHeldRef.current
    const initialRuntime = createInitialRuntime(mapText, settings)
    setRuntime(initialRuntime)
    setStarted(true)
    setLevelPausedNow(true)
    setInstructionVisible(false)
    setInstructionText('')
    setRestartToken((token) => token + 1)
  }, [mapText, setLevelPausedNow, settings])

  const beginIntroRescue = useCallback(() => {
    if (started || modalOpen || introPhaseRef.current !== 'waiting') return
    introPhaseRef.current = 'rescuing'
    setIntroPhase('rescuing')
    if (introRescueTimer.current) {
      window.clearTimeout(introRescueTimer.current)
    }
    if (introHandoffTimer.current) {
      window.clearTimeout(introHandoffTimer.current)
    }
    introRescueTimer.current = window.setTimeout(() => {
      introRescueTimer.current = undefined
      introPhaseRef.current = 'rescued'
      setIntroPhase('rescued')
      playIntroRescueSfx()
      introHandoffTimer.current = window.setTimeout(() => {
        introHandoffTimer.current = undefined
        startGame()
      }, gameConfig.layout.startArt.rescueHoldMs)
    }, gameConfig.layout.startArt.rescueGlideMs)
  }, [modalOpen, playIntroRescueSfx, startGame, started])

  useEffect(() => {
    const image = new Image()
    const ready = () => window.setTimeout(() => setLoading(false), 140)
    image.onload = ready
    image.onerror = ready
    image.src = BACKGROUND_PATH
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 't' || event.key === 'T' || event.key === 'F2' || event.key === '`') {
        event.preventDefault()
        setDevOpen((open) => !open)
        return
      }

      if (isMovementKey(event.key)) {
        clearKeyReminder()
        if (!started && !event.repeat && !modalOpen) {
          event.preventDefault()
          prepareAudioFromGesture()
          keyboardStartRef.current = true
          introInputHeldRef.current = true
          beginIntroRescue()
        } else if (started && levelPausedRef.current && !modalOpen) {
          event.preventDefault()
          if (postIntroInputLockedRef.current) return
          prepareAudioFromGesture({ primeMusic: true })
          startMusicFromMovement()
          hideJoystickForKeyboard()
          resumeLevelFromPause()
        } else if (started && !modalOpen) {
          prepareAudioFromGesture({ primeMusic: true })
          startMusicFromMovement()
          hideJoystickForKeyboard()
        }
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (postIntroInputLockedRef.current && isMovementKey(event.key)) {
        postIntroInputLockedRef.current = false
      }
      if (keyboardStartRef.current && isMovementKey(event.key)) {
        joystickRef.current = ZERO_INPUT
        keyboardStartRef.current = false
        introInputHeldRef.current = false
      }
      if (isMovementKey(event.key) && started && !levelPausedRef.current && !modalOpen) {
        const current = runtimeRef.current
        if (current) scheduleKeyReminder(current)
      }
    }

    window.addEventListener('keydown', handleKey)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [beginIntroRescue, clearKeyReminder, hideJoystickForKeyboard, modalOpen, resumeLevelFromPause, scheduleKeyReminder, started, startMusicFromMovement, prepareAudioFromGesture])

  useEffect(() => {
    if (!started || !hostRef.current) return

    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: hostRef.current,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      transparent: true,
      audio: { noAudio: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 672,
        height: 672,
      },
      scene: new PacRescueScene({
        mapText,
        settings,
        editorMode: false,
        selectedTile: ' ',
        getJoystick: () => joystickRef.current,
        isPaused: () => levelPausedRef.current,
        onRuntime: (snapshot) => setRuntime({ ...snapshot }),
        onCoinCollected: () => {
          if (shouldPlayCoinSfxForDevice()) playSfx('coin')
        },
        onTileClick: () => undefined,
      }),
    })

    gameRef.current = game
    return () => {
      game.destroy(true)
      gameRef.current = null
    }
  }, [started, mapText, settings, restartToken, playSfx])

  useEffect(() => {
    const previous = previousRuntime.current
    previousRuntime.current = runtime
    if (!previous || !audioUnlockedRef.current) return

    if (runtime.keysCollected > previous.keysCollected) playSfx('key')
    if (runtime.lives < previous.lives) {
      playSfx('hit')
      setHeartLossPopup((popup) => ({
        id: (popup?.id ?? 0) + 1,
        x: previous.playerScreenPosition?.x ?? runtime.playerScreenPosition?.x,
        y: previous.playerScreenPosition?.y ?? runtime.playerScreenPosition?.y,
      }))
    }
    if (runtime.status === 'won' && previous.status !== 'won') {
      playSfx('win')
      clearKeyReminder()
      clearRescueReminder()
      setInstructionVisible(false)
    }
    if (runtime.status === 'gameover' && previous.status !== 'gameover') {
      clearKeyReminder()
      clearRescueReminder()
      playSfx('gameover')
    }
    if (previous.frightRemaining > 0 && runtime.frightRemaining <= 0 && pendingAfterPowerInstruction.current) {
      const pending = pendingAfterPowerInstruction.current
      pendingAfterPowerInstruction.current = null
      if (started && !levelPaused && runtime.status === 'playing') {
        showInstruction(pending.text, pending.phase)
        if (pending.phase === 'rescue') {
          clearKeyReminder()
          scheduleRescueReminder(runtime)
        }
      }
      return
    }
    if (started && !levelPaused && runtime.status === 'playing' && runtime.frightRemaining > previous.frightRemaining) {
      const afterPower = instructionAfterPower(runtime)
      pendingAfterPowerInstruction.current = afterPower ? { text: afterPower, phase: phaseForInstruction(afterPower, runtime) } : null
      if (afterPower === 'Rescue the cat.') {
        clearKeyReminder()
        clearRescueReminder()
      }
      showInstruction(
        'Eyecat is invincible.',
        'power-up',
        runtime.frightRemaining * 1000 + POWER_INSTRUCTION_BUFFER_MS,
      )
      return
    }
    if (
      started
      && !levelPaused
      && runtime.status === 'playing'
      && runtime.frightRemaining > 0
      && runtime.instructionPhase === 'blocked'
      && previous.instructionPhase !== 'blocked'
      && hiddenKeyIsCurrentBlocker(runtime)
    ) {
      clearKeyReminder()
      pendingAfterPowerInstruction.current = { text: 'Find the missing key.', phase: 'key-appeared' }
      showInstruction('Find the missing key.', 'key-appeared')
      return
    }
    if (started && !levelPaused && runtime.status === 'playing' && runtime.frightRemaining > 0) {
      const afterPower = instructionAfterPower(runtime)
      if (afterPower) {
        const phase = phaseForInstruction(afterPower, runtime)
        pendingAfterPowerInstruction.current = { text: afterPower, phase }
        if (phase === 'rescue') {
          clearKeyReminder()
          clearRescueReminder()
        }
      }
      return
    }
    if (started && !levelPaused && shouldShowInstructionNotice(previous, runtime)) {
      const nextInstruction = compactInstruction(runtime)
      if (nextInstruction) {
        const phase = phaseForInstruction(nextInstruction, runtime)
        if (phase === 'rescue') {
          clearKeyReminder()
          pendingAfterPowerInstruction.current = null
          showInstruction(nextInstruction, phase)
          scheduleRescueReminder(runtime)
          return
        }
        showInstruction(nextInstruction, phase)
      }
    }
  }, [runtime, clearKeyReminder, clearRescueReminder, levelPaused, playSfx, scheduleRescueReminder, showInstruction, started])

  const switchPreset = useCallback((index: number, shouldStart: boolean, shouldPause = false) => {
    const preset = mapPresets[index] ?? mapPresets[0]
    joystickRef.current = ZERO_INPUT
    previousRuntime.current = null
    pendingAfterPowerInstruction.current = null
    postIntroInputLockedRef.current = false
    introInputHeldRef.current = false
    if (!shouldStart) {
      introPhaseRef.current = 'waiting'
      introRescueSfxPlayedRef.current = false
      setIntroPhase('waiting')
    }
    clearKeyReminder()
    clearRescueReminder()
    keyReminderShown.current = false
    rescueReminderShown.current = false
    setActiveIndex(index)
    setMapText(preset.mapText)
    setSettings(preset.settings)
    setRuntime(createInitialRuntime(preset.mapText, preset.settings))
    setStarted(shouldStart)
    setLevelPausedNow(shouldStart && shouldPause)
    setShowFinalClear(false)
    setInstructionVisible(false)
    setInstructionText('')
    setHeartLossPopup(null)
    setRestartToken((token) => token + 1)
  }, [clearKeyReminder, clearRescueReminder, setLevelPausedNow])

  useEffect(() => {
    if (runtime.status !== 'won') {
      return undefined
    }

    const nextIndex = nextLevelIndex(activeIndex, mapPresets.length)
    const timer = window.setTimeout(() => {
      if (nextIndex === undefined) {
        joystickRef.current = ZERO_INPUT
        setLevelPausedNow(true)
        setShowFinalClear(true)
        return
      }
      switchPreset(nextIndex, true, true)
    }, 720)
    return () => window.clearTimeout(timer)
  }, [activeIndex, runtime.status, setLevelPausedNow, switchPreset])

  useEffect(() => {
    if (runtime.status !== 'gameover') {
      return undefined
    }

    const timer = window.setTimeout(() => switchPreset(0, true, true), 860)
    return () => window.clearTimeout(timer)
  }, [runtime.status, switchPreset])

  const updateSettings = (patch: Partial<PacRescueSettings>) => {
    setSettings((current) => sanitizeSettings({ ...current, ...patch }))
    setRestartToken((token) => token + 1)
  }

  const toggleMusic = () => {
    prepareAudioFromGesture()
    const next = !musicEnabled
    setMusicEnabled(next)
    const audio = musicRef.current
    if (!audio) return
    if (next) {
      audio.muted = false
      audio.volume = MUSIC_VOLUME
      audio.loop = true
      void audio.play()
        .then(() => setMusicStarted(true))
        .catch(() => setMusicStarted(false))
    } else {
      if (musicPrimeTimer.current) {
        window.clearTimeout(musicPrimeTimer.current)
        musicPrimeTimer.current = undefined
      }
      audio.pause()
      audio.currentTime = 0
      audio.muted = false
      audio.volume = MUSIC_VOLUME
      musicPrimedRef.current = false
      setMusicStarted(false)
    }
  }

  const handleJoystick = (input: JoystickInput) => {
    const isMoving = Math.hypot(input.x, input.y) > 0.12
    if (!started) {
      joystickRef.current = ZERO_INPUT
      introInputHeldRef.current = isMoving
      if (isMoving && !modalOpen) {
        clearKeyReminder()
        prepareAudioFromGesture()
        if (keyboardJoystickTimer.current) {
          window.clearTimeout(keyboardJoystickTimer.current)
          keyboardJoystickTimer.current = undefined
        }
        setKeyboardJoystickHidden(false)
        keyboardStartRef.current = false
        beginIntroRescue()
      }
      return
    }
    if (postIntroInputLockedRef.current) {
      joystickRef.current = ZERO_INPUT
      if (!isMoving) postIntroInputLockedRef.current = false
      return
    }
    joystickRef.current = input
    if (isMoving) {
      clearKeyReminder()
      prepareAudioFromGesture({ primeMusic: true })
      if (keyboardJoystickTimer.current) {
        window.clearTimeout(keyboardJoystickTimer.current)
        keyboardJoystickTimer.current = undefined
      }
      setKeyboardJoystickHidden(false)
      startMusicFromMovement()
      if (levelPaused && !modalOpen) {
        resumeLevelFromPause()
      }
    } else if (started && !levelPaused && !modalOpen) {
      const current = runtimeRef.current
      if (current) scheduleKeyReminder(current)
    }
  }

  const applyRebalance = () => {
    const nextMap = rebalanceMapText(mapText, settings)
    setMapText(nextMap)
    setRuntime(createInitialRuntime(nextMap, settings))
    setRestartToken((token) => token + 1)
  }

  const closeFinalClear = () => {
    setShowFinalClear(false)
    switchPreset(0, true, true)
  }

  return (
    <main className="page-shell" style={shellStyle}>
      <audio ref={musicRef} preload="auto" src={MUSIC_PATH} />
      <section className={`game-shell ${started ? 'is-playing' : 'is-intro'}`} aria-label="Revenge of the Eyecat game">
        {loading ? <div className="loading-screen" aria-hidden="true" /> : null}

        <header className="game-topbar" style={rectStyle(gameConfig.layout.topBar)}>
          <button className="title-button" type="button" onClick={openConcept} title="View original game idea">
            <span>{gameConfig.copy.title}</span>
          </button>
          <div className="key-strip" aria-label={`${runtime.keysCollected} of ${runtime.requiredKeys} keys collected`}>
            Keys: {runtime.keysCollected}/{runtime.requiredKeys}
          </div>
          <div className="heart-strip" aria-label={`${runtime.lives} of ${runtime.maxLives} hearts left`}>
            {Array.from({ length: Math.max(0, runtime.lives) }, (_, index) => (
              <span className="heart-icon" key={index}>{HEART}</span>
            ))}
          </div>
        </header>

        <section className="playfield-wrap" style={rectStyle(gameConfig.layout.playfield)}>
          <div className="playfield">
            {started ? <div className="game-host" ref={hostRef} /> : <StartPreview />}
            {heartLossPopup ? (
              <div className="heart-loss-popup" key={heartLossPopup.id} style={heartLossStyle(heartLossPopup)} aria-hidden="true">-1 Heart</div>
            ) : null}
          </div>
        </section>

        <footer className="bottom-controls" style={rectStyle(gameConfig.layout.bottomControls)} aria-hidden="true" />
        {started && levelPaused ? (
          <div className="level-ready-prompt" style={centeredTextStyle(gameConfig.layout.eventPrompt)}>
            <strong>{`Level ${activeIndex + 1}`}</strong>
          </div>
        ) : null}
        {started && instructionText && !levelPaused ? (
          <div className={`instruction-panel phase-${instructionPhase} ${instructionVisible ? 'is-visible' : ''}`} style={centeredTextStyle(gameConfig.layout.eventPrompt)} aria-hidden={!instructionVisible}>
            <span>{instructionText}</span>
          </div>
        ) : null}
        <div className="button-row">
          <button className="control-button credits-button" style={rectStyle(gameConfig.layout.buttons.credits)} type="button" onClick={openCredits}>{gameConfig.copy.creditsLabel}</button>
          <button className={`control-button music-button ${musicEnabled ? 'active' : ''}`} style={rectStyle(gameConfig.layout.buttons.music)} type="button" onClick={toggleMusic}>
            {musicEnabled ? (musicStarted ? gameConfig.copy.musicOnLabel : gameConfig.copy.musicStartLabel) : gameConfig.copy.musicOffLabel}
          </button>
        </div>
        <MoveJoystick
          disabled={finished || modalOpen}
          hidden={keyboardJoystickHidden}
          intro={!started}
          center={gameConfig.layout.joystick}
          onChange={handleJoystick}
          onPrepareGesture={prepareAudioFromGesture}
          style={circleStyle(gameConfig.layout.joystick)}
          zone={gameConfig.layout.joystickZone}
          zoneStyle={rectStyle(gameConfig.layout.joystickZone)}
        />

        {!started ? (
          <div className={`start-overlay start-phase-${introPhase}`} aria-hidden="true">
            <span className="start-blur-layer" />
            <img className="start-eyecat" style={squareCenterStyle(introEyecatSquare(introPhase))} src={gameConfig.assets.player} alt="" />
            <img className="start-hostage" style={squareCenterStyle(gameConfig.layout.startArt.hostage)} src={gameConfig.assets.hostage} alt="" />
            <span className="start-control-prompt" style={centeredTextStyle(gameConfig.layout.prompt)}>
              {introPhase === 'rescued' ? gameConfig.copy.startRescuedPrompt : gameConfig.copy.startPrompt}
            </span>
          </div>
        ) : null}

        {showCredits ? <CreditsModal onClose={() => setShowCredits(false)} /> : null}
        {showConcept ? <ConceptModal onClose={() => setShowConcept(false)} /> : null}
        {showFinalClear ? <FinalClearModal onClose={closeFinalClear} /> : null}
        {devOpen ? (
          <DevPanel
            activeIndex={activeIndex}
            applyRebalance={applyRebalance}
            counts={counts}
            mapText={mapText}
            onClose={() => setDevOpen(false)}
            onMapChange={(text) => {
              const capped = capMapTextCounts(text, settings)
              setMapText(capped)
              setRuntime(createInitialRuntime(capped, settings))
              setRestartToken((token) => token + 1)
            }}
            onPreset={(index) => switchPreset(index, started)}
            onSettings={updateSettings}
            presets={mapPresets}
            settings={settings}
          />
        ) : null}
      </section>
    </main>
  )
}

function makePreset(id: string, name: string, tagline: string, sourceMapText: string, patch: Partial<PacRescueSettings>): MapPreset {
  const rows = sourceMapText.split('\n')
  const settings = sanitizeSettings({
    ...baseSettings,
    ...patch,
    mazeColumns: rows[0]?.length ?? baseSettings.mazeColumns,
    mazeRows: rows.length,
  })
  const mapText = capMapTextCounts(sourceMapText, settings)
  return { id, name, tagline, mapText, settings }
}

function createInitialRuntime(mapText: string, settings: PacRescueSettings): RuntimeSnapshot {
  const level = parseMapText(mapText)
  const objective = createDelayedKeyState(level)
  return {
    coinsCollected: 0,
    totalCoins: objective.totalCoins,
    keysCollected: 0,
    totalKeys: objective.totalKeys,
    status: 'playing',
    message: 'Use the joystick, arrow keys, or WASD to move Eyecat.',
    instruction: 'Find the first ruin key.',
    instructionPhase: 'find-key',
    coinGoal: Math.ceil(objective.totalCoins * settings.coinGoalPercent / 100),
    requiredKeys: objective.totalKeys,
    lives: 3,
    maxLives: 3,
    keysVisible: Math.max(0, objective.totalKeys - (objective.lockedKey ? 1 : 0)),
    frightRemaining: 0,
    chasersEaten: 0,
  }
}

function StartPreview() {
  return (
    <div className="start-preview" aria-hidden="true">
      <img className="preview-cat" src={gameConfig.assets.hostage} alt="" />
      <span className="preview-coin-dot" />
    </div>
  )
}

function MoveJoystick({
  center,
  disabled,
  hidden,
  intro,
  onChange,
  onPrepareGesture,
  style,
  zone: zoneConfig,
  zoneStyle,
}: {
  center: { x: number; y: number; radius: number }
  disabled: boolean
  hidden: boolean
  intro: boolean
  onChange: (input: JoystickInput) => void
  onPrepareGesture: () => void
  style: CSSProperties
  zone: { x: number; y: number; width: number; height: number }
  zoneStyle: CSSProperties
}) {
  const zone = useRef<HTMLDivElement | null>(null)
  const activeBaseRef = useRef<{ x: number; y: number } | null>(null)
  const [stick, setStick] = useState<JoystickInput>({ x: 0, y: 0 })
  const [activeBase, setActiveBase] = useState<{ x: number; y: number } | null>(null)

  const applyPoint = (point: { x: number; y: number }, base = activeBaseRef.current) => {
    if (!base) return
    const dx = point.x - base.x
    const dy = point.y - base.y
    const radius = center.radius
    const length = Math.hypot(dx, dy)
    const scale = Math.min(1, length / radius)
    const input = length > 0 ? { x: (dx / length) * scale, y: (dy / length) * scale } : { x: 0, y: 0 }
    setStick(input)
    onChange(input)
  }

  const reset = () => {
    activeBaseRef.current = null
    setActiveBase(null)
    setStick({ x: 0, y: 0 })
    onChange({ x: 0, y: 0 })
  }

  useEffect(() => {
    const node = zone.current
    if (!node) return undefined

    const options: AddEventListenerOptions = { passive: false }
    const touchToPoint = (touch: Touch) => {
      const rect = node.getBoundingClientRect()
      return pointerToDesignPoint(touch, rect, zoneConfig)
    }
    const guardTouch = (event: TouchEvent) => {
      if (disabled) return
      event.preventDefault()
      clearBrowserTouchArtifacts()
      const touch = event.touches[0] ?? event.changedTouches[0]
      if (!touch) return
      if (event.type === 'touchend' || event.type === 'touchcancel') {
        reset()
        return
      }
      const point = touchToPoint(touch)
      if (event.type === 'touchstart') {
        onPrepareGesture()
        activeBaseRef.current = point
        setActiveBase(point)
        applyPoint(point, point)
        return
      }
      applyPoint(point)
    }
    const guardGesture = (event: Event) => {
      if (disabled) return
      event.preventDefault()
      clearBrowserTouchArtifacts()
    }

    node.addEventListener('touchstart', guardTouch, options)
    node.addEventListener('touchmove', guardTouch, options)
    node.addEventListener('touchend', guardTouch, options)
    node.addEventListener('touchcancel', guardTouch, options)
    node.addEventListener('gesturestart', guardGesture, options)
    return () => {
      node.removeEventListener('touchstart', guardTouch, options)
      node.removeEventListener('touchmove', guardTouch, options)
      node.removeEventListener('touchend', guardTouch, options)
      node.removeEventListener('touchcancel', guardTouch, options)
      node.removeEventListener('gesturestart', guardGesture, options)
    }
  })

  const update = (event: React.PointerEvent<HTMLDivElement>, base = activeBaseRef.current) => {
    if (disabled) return
    event.preventDefault()
    clearBrowserTouchArtifacts()
    const rect = zone.current?.getBoundingClientRect()
    if (!rect || !base) return
    applyPoint(pointerToDesignPoint(event, rect, zoneConfig), base)
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    event.preventDefault()
    clearBrowserTouchArtifacts()
    onPrepareGesture()
    const rect = zone.current?.getBoundingClientRect()
    if (!rect) return
    const base = pointerToDesignPoint(event, rect, zoneConfig)
    activeBaseRef.current = base
    setActiveBase(base)
    update(event, base)
  }

  return (
    <>
      <div
        className={`joystick-zone ${disabled ? 'disabled' : ''}`}
        aria-hidden="true"
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={reset}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          startDrag(event)
        }}
        onPointerLeave={reset}
        onPointerMove={(event) => {
          if (event.buttons > 0 || event.pointerType === 'touch') update(event)
        }}
        onPointerUp={reset}
        ref={zone}
        role="presentation"
        style={zoneStyle}
        tabIndex={-1}
      />
      <div className={`joystick-wrap ${intro && !activeBase ? 'is-intro' : ''} ${activeBase ? 'is-active' : ''} ${hidden ? 'is-keyboard-hidden' : ''}`} style={activeBase ? circleStyle({ ...activeBase, radius: center.radius }) : style}>
        <div className={`gesture-joystick ${disabled ? 'disabled' : ''}`}>
          <div className="gesture-joystick-stick" style={intro && !activeBase ? undefined : { transform: `translate(${stick.x * 30}px, ${stick.y * 30}px)` }} />
        </div>
      </div>
    </>
  )
}

function pointerToDesignPoint(
  event: { clientX: number; clientY: number },
  rect: DOMRect,
  zone: { x: number; y: number; width: number; height: number },
) {
  return {
    x: zone.x + ((event.clientX - rect.left) / rect.width) * zone.width,
    y: zone.y + ((event.clientY - rect.top) / rect.height) * zone.height,
  }
}

function clearBrowserTouchArtifacts() {
  const selection = window.getSelection()
  if (selection?.rangeCount) selection.removeAllRanges()
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && activeElement !== document.body) activeElement.blur()
}

function shouldPlayCoinSfxForDevice(): boolean {
  return !shouldAvoidHtmlSfxFallbackForDevice()
}

function shouldAvoidHtmlSfxFallbackForDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const hasTouch = navigator.maxTouchPoints > 0
  const inAppBrowser = /FBAN|FBAV|FBIOS|FB_IAB|Instagram|Messenger|Line|MicroMessenger/i.test(navigator.userAgent)
  return hasCoarsePointer || hasTouch || inAppBrowser
}

function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay credits-modal" role="dialog" aria-modal="true" aria-label="Credits" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <a className="modal-title" href={gameConfig.credits.contestUrl} target="_blank" rel="noreferrer">{gameConfig.credits.contestTitle}</a>
        <p className="credits-copy">
          <span>Original music and characters by</span>
          <a href={gameConfig.credits.youtubeUrl} target="_blank" rel="noreferrer">{gameConfig.credits.studentName}</a>
        </p>
        <p className="credits-copy">
          <span>Game design and development by</span>
          <a href={`mailto:${gameConfig.credits.designerEmail}`}>{gameConfig.credits.designerName}</a>
        </p>
      </div>
    </div>
  )
}

function ConceptModal({ onClose }: { onClose: () => void }) {
  return (
    <ImageModal
      ariaLabel="Original game idea"
      className="concept-modal"
      onClose={onClose}
      subtitle={gameConfig.concept.subtitle}
      title={gameConfig.concept.title}
    />
  )
}

function FinalClearModal({ onClose }: { onClose: () => void }) {
  return (
    <ImageModal
      ariaLabel="Vifysh Vacuum is defeated"
      className="concept-modal final-clear-modal"
      onClose={onClose}
      title="Vifysh Vacuum Defeated!"
    />
  )
}

function ImageModal({
  ariaLabel,
  className,
  onClose,
  subtitle,
  title,
}: {
  ariaLabel: string
  className: string
  onClose: () => void
  subtitle?: string
  title: string
}) {
  return (
    <div className={`modal-overlay ${className}`} role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-title">{title}</div>
        {subtitle ? <div className="modal-subtitle">{subtitle}</div> : null}
        <img
          className="concept-image"
          src={gameConfig.assets.concept}
          alt={gameConfig.concept.alt}
          decoding="async"
          loading="eager"
          style={{
            '--concept-image-width': `${gameConfig.concept.imageWidth}px`,
            '--concept-image-max-height': `${gameConfig.concept.imageHeight}px`,
          } as CSSProperties}
        />
      </div>
    </div>
  )
}

function DevPanel(props: {
  activeIndex: number
  applyRebalance: () => void
  counts: { coins: number; keys: number; chasers: number; powerPellets: number }
  mapText: string
  onClose: () => void
  onMapChange: (text: string) => void
  onPreset: (index: number) => void
  onSettings: (patch: Partial<PacRescueSettings>) => void
  presets: MapPreset[]
  settings: PacRescueSettings
}) {
  return (
    <aside className="dev-panel" aria-label="Hidden tuning panel">
      <div className="dev-heading">
        <h2>Eyecat Workshop</h2>
        <button type="button" onClick={props.onClose}>Close</button>
      </div>
      <section>
        <h3>Map Presets</h3>
        <div className="map-list">
          {props.presets.map((preset, index) => (
            <button className={index === props.activeIndex ? 'active' : ''} key={preset.id} type="button" onClick={() => props.onPreset(index)}>
              <strong>{preset.name}</strong>
              <span>{preset.tagline}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>Tuning</h3>
        <TuningField label="Player speed" min={1} max={8} step={0.1} value={props.settings.playerSpeed} onChange={(playerSpeed) => props.onSettings({ playerSpeed })} />
        <TuningField label="Vacuum speed" min={0.5} max={6} step={0.1} value={props.settings.chaserSpeed} onChange={(chaserSpeed) => props.onSettings({ chaserSpeed })} />
        <TuningField label="Coin goal" min={0} max={100} step={1} value={props.settings.coinGoalPercent} onChange={(coinGoalPercent) => props.onSettings({ coinGoalPercent })} />
        <TuningField label="Power secs" min={1} max={20} step={0.5} value={props.settings.frightDuration} onChange={(frightDuration) => props.onSettings({ frightDuration })} />
        <SelectField<MazeFloor> label="Floor" value={props.settings.mazeFloor} options={['transparent', 'classic', 'spotlight', 'dusty-rose', 'soft-mauve']} onChange={(mazeFloor) => props.onSettings({ mazeFloor })} />
        <SelectField<MazeWall> label="Walls" value={props.settings.mazeWall} options={['spotlight-cream', 'laser-cyan', 'neon-teal', 'arcade-amber', 'ember-red', 'cobalt']} onChange={(mazeWall) => props.onSettings({ mazeWall })} />
        <button type="button" onClick={props.applyRebalance}>Rebalance Map Counts</button>
      </section>
      <section>
        <h3>Text Map</h3>
        <div className="count-row">
          <span>{props.counts.coins} coins</span>
          <span>{props.counts.keys} keys</span>
          <span>{props.counts.powerPellets} power</span>
          <span>{props.counts.chasers} vacuums</span>
        </div>
        <textarea spellCheck={false} value={props.mapText} onChange={(event) => props.onMapChange(event.target.value)} />
      </section>
    </aside>
  )
}

function TuningField(props: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="tuning-field">
      <span>{props.label}</span>
      <input max={props.max} min={props.min} step={props.step} type="range" value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
      <input max={props.max} min={props.min} step={props.step} type="number" value={Number.isInteger(props.value) ? props.value : props.value.toFixed(2)} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  )
}

function SelectField<T extends string>(props: { label: string; value: T; options: T[]; onChange: (value: T) => void }) {
  return (
    <label className="tuning-field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as T)}>
        {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function isMovementKey(key: string): boolean {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(key)
}

function shouldShowInstructionNotice(previous: RuntimeSnapshot, current: RuntimeSnapshot): boolean {
  if (current.status === 'won') return false
  const collectedARescueReadyKey = current.keysCollected > previous.keysCollected && current.keysCollected >= current.requiredKeys
  return collectedARescueReadyKey
    || current.lives < previous.lives
    || current.frightRemaining > previous.frightRemaining
    || current.status !== previous.status
    || (current.instructionPhase === 'key-appeared' && previous.instructionPhase !== 'key-appeared')
    || (current.instructionPhase === 'blocked' && previous.instructionPhase !== 'blocked')
}

function compactInstruction(runtime: RuntimeSnapshot): string {
  const missingKeys = Math.max(0, runtime.requiredKeys - runtime.keysCollected)
  if (runtime.status === 'won') return ''
  if (runtime.status === 'gameover') return 'Back to level 1.'
  if (runtime.lives < runtime.maxLives && runtime.message.toLowerCase().includes('heart')) return 'Caught.'
  if (runtime.instructionPhase === 'blocked') return blockedRescueInstruction(runtime)
  if (runtime.keysCollected >= runtime.requiredKeys) return 'Rescue the cat.'
  if (runtime.frightRemaining > 0) return 'Eyecat is invincible.'
  if (runtime.instructionPhase === 'key-appeared' || hiddenKeyIsCurrentBlocker(runtime)) return 'Find the missing key.'
  if (missingKeys <= 1) return ''
  return 'Find the keys.'
}

function instructionAfterPower(runtime: RuntimeSnapshot): string {
  if (runtime.status !== 'playing') return ''
  if (runtime.keysCollected >= runtime.requiredKeys) return 'Rescue the cat.'
  if (
    runtime.instructionPhase === 'key-appeared'
    || hiddenKeyIsCurrentBlocker(runtime)
  ) return 'Find the missing key.'
  return ''
}

function phaseForInstruction(text: string, runtime: RuntimeSnapshot): InstructionPhase {
  if (text === 'Eyecat is invincible.') return 'power-up'
  if (text === 'Find the missing key.') return 'key-appeared'
  if (text === 'Rescue the cat.') return 'rescue'
  return runtime.instructionPhase
}

function startLevelInstruction(runtime: RuntimeSnapshot): string {
  return runtime.requiredKeys <= 1 ? 'Find the key.' : 'Find the keys.'
}

function blockedRescueInstruction(runtime: RuntimeSnapshot): string {
  const missingKeys = Math.max(0, runtime.requiredKeys - runtime.keysCollected)
  if (hiddenKeyIsCurrentBlocker(runtime)) return 'Find the missing key.'
  return missingKeys <= 1 ? 'Find the key.' : 'Find the keys.'
}

function hiddenKeyIsCurrentBlocker(runtime: RuntimeSnapshot): boolean {
  return runtime.requiredKeys > 1
    && runtime.keysVisible <= 0
    && runtime.keysCollected < runtime.requiredKeys
    && runtime.keysCollected + runtime.keysVisible < runtime.requiredKeys
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }): CSSProperties {
  return {
    left: toPercent(rect.x, gameConfig.layout.designWidth),
    top: toPercent(rect.y, gameConfig.layout.designHeight),
    width: toPercent(rect.width, gameConfig.layout.designWidth),
    height: toPercent(rect.height, gameConfig.layout.designHeight),
  }
}

function circleStyle(circle: { x: number; y: number; radius: number }): CSSProperties {
  return rectStyle({
    x: circle.x - circle.radius,
    y: circle.y - circle.radius,
    width: circle.radius * 2,
    height: circle.radius * 2,
  })
}

function centeredTextStyle(text: { x: number; y: number; width: number }): CSSProperties {
  return {
    left: toPercent(text.x, gameConfig.layout.designWidth),
    top: toPercent(text.y, gameConfig.layout.designHeight),
    width: toPercent(text.width, gameConfig.layout.designWidth),
  }
}

function squareCenterStyle(square: { x: number; y: number; size: number }): CSSProperties {
  return rectStyle({
    x: square.x - square.size / 2,
    y: square.y - square.size / 2,
    width: square.size,
    height: square.size,
  })
}

function introEyecatSquare(phase: IntroPhase): { x: number; y: number; size: number } {
  const eyecat = gameConfig.layout.startArt.eyecat
  if (phase === 'waiting') return eyecat
  return {
    ...eyecat,
    x: eyecat.x + gameConfig.layout.startArt.rescueOffset.x,
    y: eyecat.y + gameConfig.layout.startArt.rescueOffset.y,
  }
}

function heartLossStyle(popup: HeartLossPopup): CSSProperties {
  if (popup.x === undefined || popup.y === undefined) return {}
  return {
    left: `${(popup.x / PHASER_WORLD_SIZE) * 100}%`,
    top: `${((popup.y - 34) / PHASER_WORLD_SIZE) * 100}%`,
  }
}

function toPercent(value: number, total: number): string {
  return `${(value / total) * 100}%`
}
