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
const KEY_REMINDER_FIRST_MS = 5000
const KEY_REMINDER_REPEAT_MS = 10000
const KEYBOARD_JOYSTICK_HIDE_MS = 1800

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
  const audioContextRef = useRef<AudioContext | null>(null)
  const musicEnabledRef = useRef(true)
  const musicStartedRef = useRef(false)
  const joystickRef = useRef<JoystickInput>({ x: 0, y: 0 })
  const levelPausedRef = useRef(false)
  const keyboardStartRef = useRef(false)
  const previousRuntime = useRef<RuntimeSnapshot | null>(null)
  const instructionTimer = useRef<number | undefined>(undefined)
  const delayedInstructionTimer = useRef<number | undefined>(undefined)
  const keyReminderTimer = useRef<number | undefined>(undefined)
  const keyReminderInterval = useRef<number | undefined>(undefined)
  const keyboardJoystickTimer = useRef<number | undefined>(undefined)
  const [activeIndex, setActiveIndex] = useState(0)
  const [mapText, setMapText] = useState(mapPresets[0].mapText)
  const [settings, setSettings] = useState(mapPresets[0].settings)
  const [runtime, setRuntime] = useState(() => createInitialRuntime(mapText, settings))
  const [started, setStarted] = useState(false)
  const [levelPaused, setLevelPaused] = useState(false)
  const [instructionVisible, setInstructionVisible] = useState(false)
  const [instructionText, setInstructionText] = useState('')
  const [instructionPhase, setInstructionPhase] = useState<InstructionPhase>('find-key')
  const [restartToken, setRestartToken] = useState(0)
  const [musicEnabled, setMusicEnabled] = useState(true)
  const [musicStarted, setMusicStarted] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [keyboardJoystickHidden, setKeyboardJoystickHidden] = useState(false)
  const [heartLossPopup, setHeartLossPopup] = useState<HeartLossPopup | null>(null)
  const [showCredits, setShowCredits] = useState(false)
  const [showConcept, setShowConcept] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const counts = useMemo(() => mapCounts(mapText), [mapText])
  const finished = runtime.status === 'won' || runtime.status === 'gameover'
  const shellStyle = useMemo(() => ({
    '--stage-bg': `url("${BACKGROUND_PATH}")`,
    '--spot-joy-x': `${toPercent(gameConfig.layout.joystick.x, gameConfig.layout.designWidth)}`,
    '--spot-joy-y': `${toPercent(gameConfig.layout.joystick.y, gameConfig.layout.designHeight)}`,
    '--spot-joy-r': `${toPercent(gameConfig.layout.joystick.radius, gameConfig.layout.designWidth)}`,
  }) as CSSProperties, [])

  const unlockAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
      ;(window as Window & { eyecatAudioContext?: AudioContext }).eyecatAudioContext = audioContextRef.current
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    setAudioUnlocked(true)
  }, [])

  useEffect(() => {
    musicEnabledRef.current = musicEnabled
    musicStartedRef.current = musicStarted
  }, [musicEnabled, musicStarted])

  useEffect(() => {
    levelPausedRef.current = levelPaused
  }, [levelPaused])

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
    if (keyReminderInterval.current) {
      window.clearInterval(keyReminderInterval.current)
    }
    if (keyboardJoystickTimer.current) {
      window.clearTimeout(keyboardJoystickTimer.current)
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
    if (keyReminderInterval.current) {
      window.clearInterval(keyReminderInterval.current)
      keyReminderInterval.current = undefined
    }
  }, [])

  const scheduleKeyReminder = useCallback((snapshot: RuntimeSnapshot, delay = KEY_REMINDER_FIRST_MS) => {
    clearKeyReminder()
    if (snapshot.status !== 'playing' || snapshot.keysCollected >= snapshot.requiredKeys) return
    keyReminderTimer.current = window.setTimeout(() => {
      keyReminderTimer.current = undefined
      showInstruction(startLevelInstruction(snapshot), 'find-key', LEVEL_INSTRUCTION_DURATION)
      keyReminderInterval.current = window.setInterval(() => {
        showInstruction(startLevelInstruction(snapshot), 'find-key', LEVEL_INSTRUCTION_DURATION)
      }, KEY_REMINDER_REPEAT_MS)
    }, delay)
  }, [clearKeyReminder, showInstruction])

  const showLevelInstructionSoon = useCallback((snapshot: RuntimeSnapshot) => {
    if (delayedInstructionTimer.current) {
      window.clearTimeout(delayedInstructionTimer.current)
    }
    setInstructionVisible(false)
    setInstructionText('')
    delayedInstructionTimer.current = window.setTimeout(() => {
      delayedInstructionTimer.current = undefined
      showInstruction(startLevelInstruction(snapshot), 'find-key', LEVEL_INSTRUCTION_DURATION)
    }, LEVEL_INSTRUCTION_DELAY)
    scheduleKeyReminder(snapshot)
  }, [scheduleKeyReminder, showInstruction])

  const resumeLevelFromPause = useCallback(() => {
    setLevelPaused(false)
    showLevelInstructionSoon(runtime)
  }, [runtime, showLevelInstructionSoon])

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
    audio.volume = 0.36
    audio.loop = true
    void audio.play()
      .then(() => setMusicStarted(true))
      .catch(() => setMusicStarted(false))
  }, [])

  const startGame = useCallback((initialInput: JoystickInput = ZERO_INPUT) => {
    unlockAudio()
    previousRuntime.current = null
    joystickRef.current = { ...initialInput }
    const initialRuntime = createInitialRuntime(mapText, settings)
    setRuntime(initialRuntime)
    setStarted(true)
    setLevelPaused(false)
    showLevelInstructionSoon(initialRuntime)
    setRestartToken((token) => token + 1)
  }, [mapText, settings, showLevelInstructionSoon, unlockAudio])

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
        unlockAudio()
        startMusicFromMovement()
        if (!showCredits && !showConcept) {
          hideJoystickForKeyboard()
        }
        if (!started && !event.repeat && !showCredits && !showConcept) {
          event.preventDefault()
          keyboardStartRef.current = true
          startGame(inputFromKey(event.key))
        } else if (started && levelPaused && !showCredits && !showConcept) {
          event.preventDefault()
          resumeLevelFromPause()
        }
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (keyboardStartRef.current && isMovementKey(event.key)) {
        joystickRef.current = ZERO_INPUT
        keyboardStartRef.current = false
      }
    }

    window.addEventListener('keydown', handleKey)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [hideJoystickForKeyboard, levelPaused, resumeLevelFromPause, started, showCredits, showConcept, startGame, startMusicFromMovement, unlockAudio])

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
        onTileClick: () => undefined,
      }),
    })

    gameRef.current = game
    return () => {
      game.destroy(true)
      gameRef.current = null
    }
  }, [started, mapText, settings, restartToken])

  useEffect(() => {
    const previous = previousRuntime.current
    previousRuntime.current = runtime
    if (!previous || !audioUnlocked) return

    if (runtime.coinsCollected > previous.coinsCollected) playSfx('coin')
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
      setInstructionVisible(false)
    }
    if (runtime.status === 'gameover' && previous.status !== 'gameover') {
      clearKeyReminder()
      playSfx('gameover')
    }
    if (runtime.keysCollected > previous.keysCollected) {
      scheduleKeyReminder(runtime)
    }
    if (started && !levelPaused && shouldShowInstructionNotice(previous, runtime)) {
      const nextInstruction = compactInstruction(runtime)
      if (nextInstruction) {
        showInstruction(nextInstruction, runtime.instructionPhase)
      }
    }
  }, [runtime, audioUnlocked, clearKeyReminder, levelPaused, scheduleKeyReminder, showInstruction, started])

  const switchPreset = useCallback((index: number, shouldStart: boolean, shouldPause = false) => {
    const preset = mapPresets[index] ?? mapPresets[0]
    joystickRef.current = ZERO_INPUT
    previousRuntime.current = null
    clearKeyReminder()
    setActiveIndex(index)
    setMapText(preset.mapText)
    setSettings(preset.settings)
    setRuntime(createInitialRuntime(preset.mapText, preset.settings))
    setStarted(shouldStart)
    setLevelPaused(shouldStart && shouldPause)
    setInstructionVisible(false)
    setInstructionText('')
    setHeartLossPopup(null)
    setRestartToken((token) => token + 1)
  }, [clearKeyReminder])

  useEffect(() => {
    if (runtime.status !== 'won') {
      return undefined
    }

    const nextIndex = nextLevelIndex(activeIndex, mapPresets.length) ?? 0
    const timer = window.setTimeout(() => switchPreset(nextIndex, true, true), 720)
    return () => window.clearTimeout(timer)
  }, [activeIndex, runtime.status, switchPreset])

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
    unlockAudio()
    const next = !musicEnabled
    setMusicEnabled(next)
    const audio = musicRef.current
    if (!audio) return
    if (next) {
      audio.volume = 0.36
      audio.loop = true
      void audio.play()
        .then(() => setMusicStarted(true))
        .catch(() => setMusicStarted(false))
    } else {
      audio.pause()
      setMusicStarted(false)
    }
  }

  const handleJoystick = (input: JoystickInput) => {
    joystickRef.current = input
    if (Math.hypot(input.x, input.y) > 0.12) {
      if (keyboardJoystickTimer.current) {
        window.clearTimeout(keyboardJoystickTimer.current)
        keyboardJoystickTimer.current = undefined
      }
      setKeyboardJoystickHidden(false)
      unlockAudio()
      startMusicFromMovement()
      if (!started && !showCredits && !showConcept) {
        keyboardStartRef.current = false
        startGame(input)
      } else if (started && levelPaused && !showCredits && !showConcept) {
        resumeLevelFromPause()
      }
    }
  }

  const applyRebalance = () => {
    const nextMap = rebalanceMapText(mapText, settings)
    setMapText(nextMap)
    setRuntime(createInitialRuntime(nextMap, settings))
    setRestartToken((token) => token + 1)
  }

  return (
    <main className="page-shell" style={shellStyle}>
      <audio ref={musicRef} preload="auto" src={MUSIC_PATH} />
      <section className={`game-shell ${started ? 'is-playing' : 'is-intro'}`} aria-label="Revenge of the Eyecat game">
        {loading ? <div className="loading-screen" aria-hidden="true" /> : null}

        <header className="game-topbar" style={rectStyle(gameConfig.layout.topBar)}>
          <button className="title-button" type="button" onClick={() => setShowConcept(true)} title="View original game idea">
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
          <button className="control-button credits-button" style={rectStyle(gameConfig.layout.buttons.credits)} type="button" onClick={() => setShowCredits(true)}>{gameConfig.copy.creditsLabel}</button>
          <button className={`control-button music-button ${musicEnabled ? 'active' : ''}`} style={rectStyle(gameConfig.layout.buttons.music)} type="button" onClick={toggleMusic}>
            {musicEnabled ? (musicStarted ? gameConfig.copy.musicOnLabel : gameConfig.copy.musicStartLabel) : gameConfig.copy.musicOffLabel}
          </button>
        </div>
        <MoveJoystick
          disabled={finished || showCredits || showConcept}
          hidden={keyboardJoystickHidden}
          intro={!started}
          center={gameConfig.layout.joystick}
          onChange={handleJoystick}
          style={circleStyle(gameConfig.layout.joystick)}
          zone={gameConfig.layout.joystickZone}
          zoneStyle={rectStyle(gameConfig.layout.joystickZone)}
        />

        {!started ? (
          <div className="start-overlay" aria-hidden="true">
            <span className="start-blur-layer" />
            <img className="start-eyecat" style={squareCenterStyle(gameConfig.layout.startArt.eyecat)} src={gameConfig.assets.player} alt="" />
            <img className="start-hostage" style={squareCenterStyle(gameConfig.layout.startArt.hostage)} src={gameConfig.assets.hostage} alt="" />
            <span className="start-control-prompt" style={centeredTextStyle(gameConfig.layout.prompt)}>{gameConfig.copy.startPrompt}</span>
          </div>
        ) : null}

        {showCredits ? <CreditsModal onClose={() => setShowCredits(false)} /> : null}
        {showConcept ? <ConceptModal onClose={() => setShowConcept(false)} /> : null}
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
  style,
  zone: zoneConfig,
  zoneStyle,
}: {
  center: { x: number; y: number; radius: number }
  disabled: boolean
  hidden: boolean
  intro: boolean
  onChange: (input: JoystickInput) => void
  style: CSSProperties
  zone: { x: number; y: number; width: number; height: number }
  zoneStyle: CSSProperties
}) {
  const zone = useRef<HTMLDivElement | null>(null)
  const activeBaseRef = useRef<{ x: number; y: number } | null>(null)
  const [stick, setStick] = useState<JoystickInput>({ x: 0, y: 0 })
  const [activeBase, setActiveBase] = useState<{ x: number; y: number } | null>(null)

  const update = (event: React.PointerEvent<HTMLDivElement>, base = activeBaseRef.current) => {
    if (disabled) return
    const rect = zone.current?.getBoundingClientRect()
    if (!rect || !base) return
    const point = pointerToDesignPoint(event, rect, zoneConfig)
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

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
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
        onPointerCancel={reset}
        onPointerDown={(event) => {
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
  event: React.PointerEvent<HTMLDivElement>,
  rect: DOMRect,
  zone: { x: number; y: number; width: number; height: number },
) {
  return {
    x: zone.x + ((event.clientX - rect.left) / rect.width) * zone.width,
    y: zone.y + ((event.clientY - rect.top) / rect.height) * zone.height,
  }
}

function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay credits-modal" role="dialog" aria-modal="true" aria-label="Credits">
      <div className="modal-card">
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
    <div className="modal-overlay concept-modal" role="dialog" aria-modal="true" aria-label="Original game idea">
      <div className="modal-card">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-title">{gameConfig.concept.title}</div>
        <div className="modal-subtitle">{gameConfig.concept.subtitle}</div>
        <img
          className="concept-image"
          src={gameConfig.assets.concept}
          alt={gameConfig.concept.alt}
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

function inputFromKey(key: string): JoystickInput {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return { x: -1, y: 0 }
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return { x: 1, y: 0 }
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return { x: 0, y: -1 }
  if (key === 'ArrowDown' || key === 's' || key === 'S') return { x: 0, y: 1 }
  return ZERO_INPUT
}

function shouldShowInstructionNotice(previous: RuntimeSnapshot, current: RuntimeSnapshot): boolean {
  if (current.status === 'won') return false
  return current.keysCollected > previous.keysCollected
    || current.lives < previous.lives
    || current.frightRemaining > previous.frightRemaining
    || current.status !== previous.status
    || (current.instructionPhase === 'key-appeared' && previous.instructionPhase !== 'key-appeared')
    || current.instructionPhase === 'blocked'
}

function compactInstruction(runtime: RuntimeSnapshot): string {
  const missingKeys = Math.max(0, runtime.requiredKeys - runtime.keysCollected)
  if (runtime.status === 'won') return ''
  if (runtime.status === 'gameover') return 'Back to level 1.'
  if (runtime.lives < runtime.maxLives && runtime.message.toLowerCase().includes('heart')) return 'Caught.'
  if (runtime.keysCollected >= runtime.requiredKeys) return 'Rescue the cat.'
  if (runtime.frightRemaining > 0) return 'Eyecat is invincible.'
  if (runtime.instructionPhase === 'key-appeared' || missingKeys <= 1) return 'Find the missing key.'
  return 'Find the keys.'
}

function startLevelInstruction(runtime: RuntimeSnapshot): string {
  return runtime.requiredKeys <= 1 ? 'Find the key.' : 'Find the keys.'
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

function heartLossStyle(popup: HeartLossPopup): CSSProperties {
  if (popup.x === undefined || popup.y === undefined) return {}
  return {
    left: `${(popup.x / PHASER_WORLD_SIZE) * 100}%`,
    top: `${((popup.y - 40) / PHASER_WORLD_SIZE) * 100}%`,
  }
}

function toPercent(value: number, total: number): string {
  return `${(value / total) * 100}%`
}

function playSfx(type: 'coin' | 'key' | 'hit' | 'win' | 'gameover') {
  const context = (window as Window & { eyecatAudioContext?: AudioContext }).eyecatAudioContext
  if (!context) return
  const now = context.currentTime
  const profile = {
    coin: { frequency: 740, end: 980, duration: 0.08, type: 'sine' as OscillatorType },
    key: { frequency: 520, end: 1220, duration: 0.16, type: 'triangle' as OscillatorType },
    hit: { frequency: 140, end: 70, duration: 0.18, type: 'sawtooth' as OscillatorType },
    win: { frequency: 660, end: 1320, duration: 0.28, type: 'triangle' as OscillatorType },
    gameover: { frequency: 220, end: 80, duration: 0.3, type: 'sawtooth' as OscillatorType },
  }[type]
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = profile.type
  oscillator.frequency.setValueAtTime(profile.frequency, now)
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, profile.end), now + profile.duration)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(type === 'hit' || type === 'gameover' ? 0.08 : 0.045, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + profile.duration + 0.02)
}
