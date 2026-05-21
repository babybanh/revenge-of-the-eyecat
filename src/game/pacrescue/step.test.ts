import { describe, expect, it } from 'vitest'
import { defaultPacRescueMap } from './defaults'
import { isWall, parseMapText, pointKey } from './map'
import {
  advanceStep,
  beginStep,
  bfsDistance,
  chooseGhostStep,
  choosePatrollerStep,
  chooseSafeRespawnTile,
  createStepActor,
  ghostTypeForIndex,
  legalStepDirections,
  resolveTileCollision,
  stepTarget,
} from './step'

describe('tile-step pac rescue movement', () => {
  it('starts from the requested playable prototype map', () => {
    const level = parseMapText(defaultPacRescueMap)

    expect(level.width).toBe(9)
    expect(level.height).toBe(9)
    expect(level.playerStart).toEqual({ x: 4, y: 7 })
    expect(level.hostage).toEqual({ x: 4, y: 4 })
    expect(level.chasers).toEqual([
      { x: 1, y: 3 },
      { x: 7, y: 3 },
    ])
    expect(level.keys.size).toBe(3)
    expect(level.powerPellets.size).toBe(1)
    expect(level.coins.size).toBe(36)
  })

  it('gives every ghost at least one legal first move', () => {
    const level = parseMapText(defaultPacRescueMap)

    for (const chaser of level.chasers) {
      expect(legalStepDirections(level, chaser).length).toBeGreaterThan(0)
      expect(chooseGhostStep(level, chaser, level.playerStart)).not.toEqual({ x: 0, y: 0 })
    }
  })

  it('alternates row-major chasers and patrollers from C order', () => {
    expect([0, 1, 2, 3].map(ghostTypeForIndex)).toEqual(['chaser', 'patroller', 'chaser', 'patroller'])
  })

  it('moves each ghost to another tile after enough simulated time', () => {
    const level = parseMapText(defaultPacRescueMap)

    for (const spawn of level.chasers) {
      const actor = beginStep(createStepActor(spawn), chooseGhostStep(level, spawn, level.playerStart), level)
      const moved = advanceStep(actor, 3.4, 1).actor

      expect(pointKey(moved.tile)).not.toBe(pointKey(spawn))
      expect(isWall(level, moved.tile.x, moved.tile.y)).toBe(false)
    }
  })

  it('reduces BFS distance to the player over repeated ghost decisions', () => {
    const level = parseMapText(defaultPacRescueMap)
    let ghost = createStepActor(level.chasers[0])
    const startDistance = bfsDistance(level, ghost.tile, level.playerStart)

    for (let i = 0; i < 4; i += 1) {
      ghost = advanceStep(beginStep(ghost, chooseGhostStep(level, ghost.tile, level.playerStart), level), 10, 1).actor
    }

    expect(startDistance).toBeDefined()
    expect(bfsDistance(level, ghost.tile, level.playerStart)).toBeLessThan(startDistance!)
  })

  it('does not step into walls', () => {
    const level = parseMapText(defaultPacRescueMap)

    expect(stepTarget(level, { x: 1, y: 1 }, { x: -1, y: 0 })).toBeUndefined()
    expect(stepTarget(level, { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual({ x: 2, y: 1 })
  })

  it('lets ghosts treat the princess zone as a blocked tile', () => {
    const level = parseMapText([
      '########',
      '#P HC #',
      '#      #',
      '########',
    ].join('\n'))
    const blocksHostage = (point: { x: number; y: number }) => point.x === level.hostage.x && point.y === level.hostage.y

    expect(stepTarget(level, { x: 4, y: 1 }, { x: -1, y: 0 }, blocksHostage)).toBeUndefined()
    expect(chooseGhostStep(level, { x: 4, y: 1 }, level.playerStart, blocksHostage)).not.toEqual({ x: -1, y: 0 })
    expect(beginStep(createStepActor({ x: 4, y: 1 }), { x: -1, y: 0 }, level, blocksHostage).tile).toEqual({ x: 4, y: 1 })
  })

  it('wraps through open side tunnel rows', () => {
    const level = parseMapText([
      '#######',
      '#P H  #',
      '       ',
      '#######',
    ].join('\n'))

    expect(stepTarget(level, { x: 0, y: 2 }, { x: -1, y: 0 })).toEqual({ x: 6, y: 2 })
    expect(stepTarget(level, { x: 6, y: 2 }, { x: 1, y: 0 })).toEqual({ x: 0, y: 2 })
  })

  it('wraps through open top and bottom tunnel columns', () => {
    const level = parseMapText([
      '### ###',
      '#P   H#',
      '# ### #',
      '#     #',
      '### ###',
    ].join('\n'))

    expect(stepTarget(level, { x: 3, y: 0 }, { x: 0, y: -1 })).toEqual({ x: 3, y: 4 })
    expect(stepTarget(level, { x: 3, y: 4 }, { x: 0, y: 1 })).toEqual({ x: 3, y: 0 })
    expect(stepTarget(level, { x: 1, y: 1 }, { x: 0, y: -1 })).toBeUndefined()
  })

  it('resolves normal and powered tile collisions', () => {
    expect(resolveTileCollision({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }, false)).toBe('normal-hit')
    expect(resolveTileCollision({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }, true)).toBe('powered-eat')
    expect(resolveTileCollision({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, false)).toBe('normal-hit')
  })

  it('keeps the normal respawn tile when enemies are far enough away', () => {
    const level = parseMapText(defaultPacRescueMap)

    expect(chooseSafeRespawnTile(level, level.playerStart, level.chasers)).toEqual(level.playerStart)
  })

  it('chooses a farther open respawn tile when the start is unsafe', () => {
    const level = parseMapText([
      '#########',
      '#P C   H#',
      '#       #',
      '#       #',
      '#########',
    ].join('\n'))

    const respawn = chooseSafeRespawnTile(level, level.playerStart, [{ x: 3, y: 1 }], 4)

    expect(respawn).not.toEqual(level.playerStart)
    expect(isWall(level, respawn.x, respawn.y)).toBe(false)
    expect(bfsDistance(level, respawn, { x: 3, y: 1 })).toBeGreaterThanOrEqual(4)
  })

  it('patrollers continue straight through corridors', () => {
    const level = parseMapText([
      '#######',
      '#P   H#',
      '#######',
    ].join('\n'))

    expect(choosePatrollerStep(level, { x: 2, y: 1 }, { x: 1, y: 0 }, 0, false)).toEqual({ x: 1, y: 0 })
  })

  it('patrollers turn when blocked and avoid reversing when another move exists', () => {
    const level = parseMapText([
      '#######',
      '#P#  H#',
      '#    ##',
      '#######',
    ].join('\n'))

    const direction = choosePatrollerStep(level, { x: 1, y: 2 }, { x: -1, y: 0 }, 0, true)
    expect(direction).not.toEqual({ x: 1, y: 0 })
    expect(stepTarget(level, { x: 1, y: 2 }, direction)).toBeDefined()
  })

  it('patrollers do not continue into blocked princess tiles', () => {
    const level = parseMapText([
      '#######',
      '#P HC #',
      '#     #',
      '#######',
    ].join('\n'))
    const blocksHostage = (point: { x: number; y: number }) => point.x === level.hostage.x && point.y === level.hostage.y
    const direction = choosePatrollerStep(level, { x: 4, y: 1 }, { x: -1, y: 0 }, 1, false, blocksHostage)

    expect(direction).not.toEqual({ x: -1, y: 0 })
    expect(stepTarget(level, { x: 4, y: 1 }, direction, blocksHostage)).toBeDefined()
  })

  it('patrollers reverse only when no other legal move exists', () => {
    const level = parseMapText([
      '#####',
      '#P H#',
      '#####',
    ].join('\n'))

    expect(choosePatrollerStep(level, { x: 1, y: 1 }, { x: -1, y: 0 }, 0, true)).toEqual({ x: 1, y: 0 })
  })
})
