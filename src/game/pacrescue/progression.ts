export function hasNextLevel(activeIndex: number, totalLevels: number): boolean {
  return nextLevelIndex(activeIndex, totalLevels) !== undefined
}

export function nextLevelIndex(activeIndex: number, totalLevels: number): number | undefined {
  const next = activeIndex + 1
  return next >= 0 && next < totalLevels ? next : undefined
}
