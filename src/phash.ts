import phash from 'sharp-phash'

import type { ScamEntry } from '@sentinel/store'

export interface Match {
  entry: ScamEntry
  /** how the match was made: whole-image pHash, or shift-aligned tile matching */
  reason: 'whole' | 'tiles'
  /** eligible for auto-delete/auto-ban; false = report for manual review only */
  confident: boolean
  /** whole-image Hamming distance (whole matches only) */
  distance?: number
  /** tile-stage stats (tile matches only) */
  tiles?: { matched: number; informative: number }
}

/** perceptual hash of image bytes: 64-char binary string (DCT median pHash) */
export function hashImage(bytes: Buffer | Uint8Array): Promise<string> {
  return phash(bytes)
}

/** download an image and hash it */
export async function hashUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return hashImage(Buffer.from(await res.arrayBuffer()))
}

/** number of differing bits between two equal-length binary hashes */
export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

/** population count of a 32-bit word */
export function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * pack a 64-char binary hash into two 32-bit words so Hamming distance is an
 * XOR + popcount instead of 64 string-index comparisons. 64-length only.
 */
export function packHash(hash: string): Uint32Array {
  const w = new Uint32Array(2)
  w[0] = parseInt(hash.slice(0, 32), 2)
  w[1] = parseInt(hash.slice(32, 64), 2)
  return w
}

/** closest dataset entry within threshold, or null */
export function classify(
  hash: string,
  entries: readonly ScamEntry[],
  threshold: number
): Match | null {
  let best: Match | null = null
  for (const entry of entries) {
    const distance = hamming(hash, entry.hash)
    if (distance <= threshold && (!best || distance < (best.distance ?? Infinity)))
      best = { entry, distance, reason: 'whole', confident: true }
  }
  return best
}

/** nearest entry regardless of threshold (for the /scam check tool) */
export function nearest(hash: string, entries: readonly ScamEntry[]): Match | null {
  let best: Match | null = null
  for (const entry of entries) {
    const distance = hamming(hash, entry.hash)
    if (!best || distance < (best.distance ?? Infinity))
      best = { entry, distance, reason: 'whole', confident: true }
  }
  return best
}
