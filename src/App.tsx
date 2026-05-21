import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Phaser from 'phaser'
import './App.css'
import { defaultPacRescueSettings } from './game/pacrescue/defaults'
import { capMapTextCounts, mapCounts, parseMapText, rebalanceMapText, sanitizeSettings } from './game/pacrescue/map'
import { createDelayedKeyState } from './game/pacrescue/objective'
import type { MazeFloor, MazeWall, PacRescueSettings, RuntimeSnapshot } from './game/pacrescue/types'
import { gameConfig } from './game/config/gameConfig'
import { PacRescueScene, type JoystickInput } from './game/scenes/PacRescueScene'

const BACKGROUND_PATH = gameConfig.assets.background
const MUSIC_PATH = gameConfig.assets.music
const HEART = '\u2665'

type MapPreset = {
  id: string
  name: string
  tagline: string
  mapText: string
  settings: PacRescueSettings
}

const baseSettings = sanitizeSettings({
  ...defaultPacRescueSettings,
  cameraViewTiles: 0,
  enemySkin: 'vacuum',
  playerSkin: 'eye-cat-plain',
  coinSkin: 'coin',
  mazeFloor: 'transparent',
  mazeWall: 'spotlight-cream',
  stageBackground: 'lab-final-ruin',
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

const mapPresets: MapPreset[] = [
  makePreset('ruin-gate', 'Ruin Gate', 'Small first rescue route', [
    '###########',
    '#P....K..O#',
    '#.###.###.#',
    '#...#.....#',
    '###.#.###.#',
    '#...H...C.#',
    '#.###.#.#.#',
    '#K....#...#',
    '#.###.###.#',
    '#O..C...K.#',
    '###########',
  ], { chaserCount: 2, keyCount: 3, requiredKeys: 3, coinGoalPercent: 35, chaserSpeed: 1.45 }),
  makePreset('broken-halls', 'Broken Halls', 'Longer lanes with two vacuum patrols', [
    '#############',
    '#P....#....K#',
    '#.##.#.#.##.#',
    '#O...#.#...O#',
    '###.##.##.###',
    '#...C.H.C...#',
    '#.###...###.#',
    '#K....#....K#',
    '#.##.#.#.##.#',
    '#....#.#....#',
    '#############',
  ], { chaserCount: 2, keyCount: 3, requiredKeys: 3, coinGoalPercent: 45, chaserSpeed: 1.55 }),
  makePreset('spiral-court', 'Spiral Court', 'Tighter route, more coin pressure', [
    '###############',
    '#P....#....K..#',
    '#.###.#.#####.#',
    '#...#.#.....#.#',
    '###.#.#####.#.#',
    '#K..#...H...#O#',
    '#.#####.#####.#',
    '#.....#.#.....#',
    '#.###.#.#.###.#',
    '#O..C...C...K.#',
    '###############',
  ], { chaserCount: 2, keyCount: 3, requiredKeys: 3, coinGoalPercent: 50, chaserSpeed: 1.7 }),
  makePreset('vacuum-cross', 'Vacuum Cross', 'Four enemies, open intersections', [
    '###############',
    '#P...K...O...K#',
    '#.###.###.###.#',
    '#.....C.C.....#',
    '###.#.###.#.###',
    '#...#..H..#...#',
    '###.#.###.#.###',
    '#.....C.C.....#',
    '#.###.###.###.#',
    '#K...O.....K..#',
    '###############',
  ], { chaserCount: 4, keyCount: 4, requiredKeys: 4, coinGoalPercent: 45, chaserSpeed: 1.45 }),
  makePreset('final-ruin', 'Final Ruin', 'Wide contest draft map', [
    '#################',
    '#P....K...#...O.#',
    '#.###.###.#.###.#',
    '#...#.....#...#K#',
    '###.#.#######.#.#',
    '#...#...C...#...#',
    '#.#####.H.#####.#',
    '#...#...C...#...#',
    '#.#.#######.#.###',
    '#K#...#.....#...#',
    '#.###.#.###.###.#',
    '#.O...#...K....C#',
    '#################',
  ], { chaserCount: 3, keyCount: 4, requiredKeys: 4, coinGoalPercent: 48, chaserSpeed: 1.6 }),
]

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const musicEnabledRef = useRef(true)
  const musicStartedRef = useRef(false)
  const joystickRef = useRef<JoystickInput>({ x: 0, y: 0 })
  const previousRuntime = useRef<RuntimeSnapshot | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [mapText, setMapText] = useState(mapPresets[0].mapText)
  const [settings, setSettings] = useState(mapPresets[0].settings)
  const [runtime, setRuntime] = useState(() => createInitialRuntime(mapText, settings))
  const [started, setStarted] = useState(false)
  const [restartToken, setRestartToken] = useState(0)
  const [musicEnabled, setMusicEnabled] = useState(true)
  const [musicStarted, setMusicStarted] = useState(false)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [showCredits, setShowCredits] = useState(false)
  const [showConcept, setShowConcept] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const activePreset = mapPresets[activeIndex] ?? mapPresets[0]
  const counts = useMemo(() => mapCounts(mapText), [mapText])
  const finished = runtime.status === 'won' || runtime.status === 'gameover'

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

  const startMusicFromMovement = useCallback(() => {
    const audio = musicRef.current
    if (!audio || !musicEnabledRef.current || musicStartedRef.current) return
    audio.volume = 0.36
    audio.loop = true
    void audio.play()
      .then(() => setMusicStarted(true))
      .catch(() => setMusicStarted(false))
  }, [])

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
      if (started && isMovementKey(event.key)) {
        unlockAudio()
        startMusicFromMovement()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [started, musicEnabled, audioUnlocked, startMusicFromMovement, unlockAudio])

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
    if (runtime.lives < previous.lives) playSfx('hit')
    if (runtime.status === 'won' && previous.status !== 'won') playSfx('win')
    if (runtime.status === 'gameover' && previous.status !== 'gameover') playSfx('gameover')
  }, [runtime, audioUnlocked])

  const startGame = () => {
    unlockAudio()
    previousRuntime.current = null
    joystickRef.current = { x: 0, y: 0 }
    setRuntime(createInitialRuntime(mapText, settings))
    setStarted(true)
    setRestartToken((token) => token + 1)
  }

  const restart = () => {
    joystickRef.current = { x: 0, y: 0 }
    previousRuntime.current = null
    setRuntime(createInitialRuntime(mapText, settings))
    setStarted(true)
    setRestartToken((token) => token + 1)
  }

  const switchPreset = (index: number) => {
    const preset = mapPresets[index] ?? mapPresets[0]
    joystickRef.current = { x: 0, y: 0 }
    previousRuntime.current = null
    setActiveIndex(index)
    setMapText(preset.mapText)
    setSettings(preset.settings)
    setRuntime(createInitialRuntime(preset.mapText, preset.settings))
    setRestartToken((token) => token + 1)
  }

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
      unlockAudio()
      startMusicFromMovement()
    }
  }

  const applyRebalance = () => {
    const nextMap = rebalanceMapText(mapText, settings)
    setMapText(nextMap)
    setRuntime(createInitialRuntime(nextMap, settings))
    setRestartToken((token) => token + 1)
  }

  return (
    <main className="page-shell" style={{ '--stage-bg': `url("${BACKGROUND_PATH}")` } as CSSProperties}>
      <audio ref={musicRef} preload="auto" src={MUSIC_PATH} />
      <section className={`game-shell ${started ? 'is-playing' : 'is-intro'}`} aria-label="Revenge of the Eyecat game">
        {loading ? <div className="loading-screen" aria-hidden="true" /> : null}

        <header className="game-topbar">
          <button className="title-button" type="button" onClick={() => setShowConcept(true)} title="View original game idea">
            <span>{gameConfig.copy.title}</span>
            <small>{activePreset.name}</small>
          </button>
          <div className="score-strip" aria-live="polite">
            <span>Coins {runtime.coinsCollected}/{runtime.coinGoal}</span>
            <span>Keys {runtime.keysCollected}/{runtime.requiredKeys}</span>
            <span>Power {runtime.frightRemaining}s</span>
          </div>
          <div className="heart-strip" aria-label={`${runtime.lives} of ${runtime.maxLives} hearts left`}>
            {Array.from({ length: runtime.maxLives }, (_, index) => (
              <span className={index < runtime.lives ? 'full' : ''} key={index}>{HEART}</span>
            ))}
          </div>
        </header>

        <section className="playfield-wrap">
          <div className="playfield">
            {started ? <div className="game-host" ref={hostRef} /> : <StartPreview />}
            {finished ? (
              <div className={`result-panel result-${runtime.status}`} role="dialog" aria-live="assertive">
                <h2>{runtime.status === 'won' ? 'Cat Hostage Rescued' : 'Eyecat Caught'}</h2>
                <p>{runtime.status === 'won' ? 'The ruin is clear for now.' : runtime.message}</p>
                <button type="button" onClick={restart}>Play Again</button>
              </div>
            ) : null}
          </div>
        </section>

        <footer className="bottom-controls">
          <div className={`instruction-panel phase-${runtime.instructionPhase}`}>
            <strong>{started ? runtime.instruction : activePreset.tagline}</strong>
            <span>{started ? runtime.message : gameConfig.copy.startHint}</span>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => setShowCredits(true)}>{gameConfig.copy.creditsLabel}</button>
            <button className={musicEnabled ? 'active' : ''} type="button" onClick={toggleMusic}>
              {musicEnabled ? (musicStarted ? gameConfig.copy.musicOnLabel : gameConfig.copy.musicStartLabel) : gameConfig.copy.musicOffLabel}
            </button>
          </div>
          <MoveJoystick disabled={!started || finished} onChange={handleJoystick} />
        </footer>

        {!started ? (
          <button className="start-overlay" type="button" onClick={startGame} onPointerDown={unlockAudio}>
            <span className="start-blur-layer" />
            <img className="start-eyecat" src={gameConfig.assets.player} alt="" />
            <img className="start-vacuum" src={gameConfig.assets.vacuum} alt="" />
            <span className="start-prompt">{gameConfig.copy.startPrompt}</span>
            <span className="start-joystick-hint"><i /></span>
            <span className="start-tap">Tap to play</span>
          </button>
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
            onPreset={switchPreset}
            onSettings={updateSettings}
            presets={mapPresets}
            settings={settings}
          />
        ) : null}
      </section>
    </main>
  )
}

function makePreset(id: string, name: string, tagline: string, rows: string[], patch: Partial<PacRescueSettings>): MapPreset {
  const settings = sanitizeSettings({
    ...baseSettings,
    ...patch,
    mazeColumns: rows[0]?.length ?? baseSettings.mazeColumns,
    mazeRows: rows.length,
  })
  const mapText = capMapTextCounts(rows.join('\n'), settings)
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
      <img className="preview-coin" src={gameConfig.assets.coin} alt="" />
    </div>
  )
}

function MoveJoystick({ disabled, onChange }: { disabled: boolean; onChange: (input: JoystickInput) => void }) {
  const pad = useRef<HTMLDivElement | null>(null)
  const [stick, setStick] = useState<JoystickInput>({ x: 0, y: 0 })

  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const rect = pad.current?.getBoundingClientRect()
    if (!rect) return
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    const radius = Math.max(1, rect.width * 0.5)
    const length = Math.hypot(dx, dy)
    const scale = Math.min(1, length / radius)
    const input = length > 0 ? { x: (dx / length) * scale, y: (dy / length) * scale } : { x: 0, y: 0 }
    setStick(input)
    onChange(input)
  }

  const reset = () => {
    setStick({ x: 0, y: 0 })
    onChange({ x: 0, y: 0 })
  }

  return (
    <div className="joystick-wrap">
      <div
        className={`gesture-joystick ${disabled ? 'disabled' : ''}`}
        onPointerCancel={reset}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          update(event)
        }}
        onPointerLeave={reset}
        onPointerMove={(event) => {
          if (event.buttons > 0 || event.pointerType === 'touch') update(event)
        }}
        onPointerUp={reset}
        ref={pad}
        role="presentation"
      >
        <div className="gesture-joystick-stick" style={{ transform: `translate(${stick.x * 30}px, ${stick.y * 30}px)` }} />
      </div>
    </div>
  )
}

function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay credits-modal" role="dialog" aria-modal="true" aria-label="Credits">
      <div className="modal-card">
        <button className="modal-close" type="button" onClick={onClose}>x</button>
        <h2>{gameConfig.credits.contestTitle}</h2>
        <p>{gameConfig.credits.studentCredit}</p>
        <p>{gameConfig.credits.developerCredit}</p>
        <a href={gameConfig.credits.contestUrl} target="_blank" rel="noreferrer">
          PIK Composition Contest playlist
        </a>
      </div>
    </div>
  )
}

function ConceptModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay concept-modal" role="dialog" aria-modal="true" aria-label="Original game idea">
      <div className="modal-card">
        <button className="modal-close" type="button" onClick={onClose}>x</button>
        <h2>Original Game Idea</h2>
        <p>Eyecat slips through the ruin, collects enough power, and rescues the captured cat before the vacuum patrols close in.</p>
        <div className="concept-art-row">
          <img src={gameConfig.assets.player} alt="Borderless Eyecat" />
          <img src={gameConfig.assets.vacuum} alt="Vacuum enemy" />
          <img src={gameConfig.assets.hostage} alt="Cat hostage" />
        </div>
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
