import type { PacRescueSettings } from './types'

export type DefaultPacRescueLevel = {
  name: string
  mapText: string
}

export const defaultPacRescueLevelMaps: DefaultPacRescueLevel[] = [
  {
    name: 'Level 1',
    mapText: [
      '######',
      '#K...#',
      '#.##C#',
      '..#H..',
      '#P...#',
      '######',
    ].join('\n'),
  },
  {
    name: 'Level 2',
    mapText: [
      '###.###',
      '#K....#',
      '#.#.#C#',
      '...#H..',
      '#.#...#',
      '#P....#',
      '###.###',
    ].join('\n'),
  },
  {
    name: 'Level 3',
    mapText: [
      '###.####',
      '#K.....#',
      '#.##.#.#',
      '#C....C#',
      '...#H...',
      '#.#..#.#',
      '#O.P.K.#',
      '###.####',
    ].join('\n'),
  },
  {
    name: 'Level 4',
    mapText: [
      '####.####',
      '#K.....O#',
      '#.#.#.#.#',
      '#C..K..C#',
      '...#H.#..',
      '#.#...#.#',
      '#K..#.#.#',
      '#...P...#',
      '####.####',
    ].join('\n'),
  },
  {
    name: 'Level 5',
    mapText: [
      '##########',
      '#O.K#...O#',
      '#.#.#.#..#',
      '#...#...C#',
      '..##H.....',
      '#....#...#',
      '#.#...#.##',
      '#C..#...K#',
      '#...P....#',
      '##########',
    ].join('\n'),
  },
  {
    name: 'Level 6',
    mapText: [
      '#####.#####',
      '#K..O...K.#',
      '#.#.###.#.#',
      '#C.......C#',
      '###.#.#.###',
      '....#H#....',
      '###.#.#.###',
      '#C...K...C#',
      '#.#.###.#.#',
      '#O..P..K..#',
      '#####.#####',
    ].join('\n'),
  },
  {
    name: 'Level 7',
    mapText: [
      '#####.######',
      '#K..O...K..#',
      '#.#.##.#...#',
      '#C........C#',
      '###.#...#.##',
      '....#H#.....',
      '##.#...#.###',
      '#C...K....C#',
      '#.#.##.#...#',
      '#O..P..K.O.#',
      '#....O.....#',
      '#####.######',
    ].join('\n'),
  },
]

export const defaultPacRescueMap = defaultPacRescueLevelMaps[0].mapText
const defaultMapDimensions = mapTextDimensions(defaultPacRescueMap)

export const defaultPacRescueSettings: PacRescueSettings = {
  mazeColumns: defaultMapDimensions.columns,
  mazeRows: defaultMapDimensions.rows,
  cameraViewTiles: 0,
  enemySkin: 'vacuum',
  playerSkin: 'eye-cat-plain',
  coinSkin: 'dot',
  mazeFloor: 'transparent',
  mazeWall: 'spotlight-cream',
  stageBackground: 'lab-final-ruin-2',
  stageBackgroundScale: 100,
  boardOffsetX: 0,
  boardOffsetY: 0,
  playerSpeed: 3,
  chaserSpeed: 1.1,
  chaseRadius: 8,
  chaserCount: 4,
  keyCount: 4,
  coinCount: 140,
  powerPelletCount: 6,
  requiredKeys: 4,
  coinGoalPercent: 35,
  frightDuration: 7,
  chaseDuration: 14,
  scatterDuration: 5,
  rescueZoneSize: 1,
  wanderTurnInterval: 0.75,
}

function mapTextDimensions(mapText: string): { columns: number; rows: number } {
  const rows = mapText.split('\n')
  return {
    columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
    rows: rows.length,
  }
}
