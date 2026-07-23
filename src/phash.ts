import phash from 'sharp-phash'

import type { ScamEntry } from '@sentinel/store'

export interface Match {
  entry: ScamEntry
  distance: number
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

/** closest dataset entry within threshold, or null */
export function classify(
  hash: string,
  entries: readonly ScamEntry[],
  threshold: number
): Match | null {
  let best: Match | null = null
  for (const entry of entries) {
    const distance = hamming(hash, entry.hash)
    if (distance <= threshold && (!best || distance < best.distance)) best = { entry, distance }
  }
  return best
}

/** nearest entry regardless of threshold (for the /scam check tool) */
export function nearest(hash: string, entries: readonly ScamEntry[]): Match | null {
  let best: Match | null = null
  for (const entry of entries) {
    const distance = hamming(hash, entry.hash)
    if (!best || distance < best.distance) best = { entry, distance }
  }
  return best
}
