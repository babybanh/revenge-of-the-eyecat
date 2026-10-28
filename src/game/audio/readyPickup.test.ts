import { describe, expect, it, vi } from 'vitest'
import { playReadyPickup } from './readyPickup'

describe('collision-safe mobile pickup audio', () => {
  const buffer = {} as AudioBuffer
  function engine(state: string) {
    const start = vi.fn()
    const source = { connect: vi.fn(), disconnect: vi.fn(), start, buffer: null, onended: null }
    const context = { state, destination: {}, resume: vi.fn(() => { throw new Error('collision must not resume audio') }),
      createBufferSource: vi.fn(() => source), createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })) }
    return { context, start }
  }
  it('omits effects when no already-running engine or decoded buffer exists', () => {
    expect(playReadyPickup(null, buffer, .4)).toBe(false)
    for (const state of ['suspended', 'interrupted', 'closed']) {
      const { context } = engine(state)
      expect(playReadyPickup(context as unknown as AudioContext, buffer, .4)).toBe(false)
      expect(context.resume).not.toHaveBeenCalled()
      expect(context.createBufferSource).not.toHaveBeenCalled()
    }
    const { context } = engine('running')
    expect(playReadyPickup(context as unknown as AudioContext, undefined, .4)).toBe(false)
    expect(context.createBufferSource).not.toHaveBeenCalled()
  })
  it('starts only an already-warm buffer without resuming media', () => {
    const { context, start } = engine('running')
    expect(playReadyPickup(context as unknown as AudioContext, buffer, .4)).toBe(true)
    expect(start).toHaveBeenCalledOnce()
    expect(context.resume).not.toHaveBeenCalled()
  })
})
