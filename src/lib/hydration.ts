// Nothing may navigate until the app layout has mounted.
//
// React is still matching the server HTML while the router runs the guard and
// the page loaders. A `router.navigate()` in that window - from a thrown
// redirect or from a 401 on a query - swaps the match tree under React and
// hydration fails. The layout's mount effect is the first moment where
// hydration is provably over, so a redirect that wants to fire earlier waits
// here instead.

let mounted = false
const waiting = new Set<() => void>()

export function appHasMounted(): boolean {
  return mounted
}

// Called once, from the app layout's mount effect.
export function markAppMounted(): void {
  if (mounted) return
  mounted = true
  const queued = [...waiting]
  waiting.clear()
  for (const fn of queued) fn()
}

// Runs `fn` now if the layout is already up, otherwise when it mounts. A burst
// of 401s from one page load queues the same function once, so it still ends
// in a single redirect.
export function afterAppMounted(fn: () => void): void {
  if (mounted) fn()
  else waiting.add(fn)
}
