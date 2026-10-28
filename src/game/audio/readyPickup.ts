// Collision-safe playback: no fetch, decode, context creation/resume, or HTML fallback.
export function playReadyPickup(context: AudioContext | null, buffer: AudioBuffer | undefined, volume: number): boolean {
  if (!context || context.state !== 'running' || !buffer) return false
  const source = context.createBufferSource()
  const gain = context.createGain()
  source.buffer = buffer
  gain.gain.value = volume
  source.connect(gain)
  gain.connect(context.destination)
  source.onended = () => {
    source.disconnect()
    gain.disconnect()
  }
  source.start()
  return true
}
