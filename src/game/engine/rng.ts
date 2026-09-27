/**
 * Randomness is injected rather than stored in the state, so nobody can read
 * the next roll out of a shared game document. Whoever applies an action
 * supplies the dice: the browser in direct mode, the Cloud Function in
 * server mode. Every draw is recorded alongside the action, which is what
 * makes a game replayable move by move.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
}

/** Browser and Node both have Web Crypto. */
export const cryptoRng: Rng = {
  next() {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0] / 2 ** 32
  },
}

/** A small seeded generator, for tests and for local games that want repeatability. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1
  return {
    next() {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Wraps a generator and remembers every value it hands out. */
export function recordingRng(inner: Rng): Rng & { draws: number[] } {
  const draws: number[] = []
  return {
    draws,
    next() {
      const value = inner.next()
      draws.push(value)
      return value
    },
  }
}

/** Replays recorded draws, then falls back to `fallback` if they run out. */
export function replayRng(draws: readonly number[], fallback: Rng = cryptoRng): Rng {
  let i = 0
  return {
    next() {
      return i < draws.length ? draws[i++] : fallback.next()
    },
  }
}

export const randInt = (rng: Rng, n: number) => Math.floor(rng.next() * n)

export const rollDie = (rng: Rng) => randInt(rng, 6) + 1

export function shuffle<T>(rng: Rng, input: readonly T[]): T[] {
  const out = [...input]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[randInt(rng, list.length)]
