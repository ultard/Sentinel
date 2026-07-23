import type { ScamEntry } from '@sentinel/store'

import { classify, hashImage, type Match } from './phash'
import { gridFromBytes, shiftedGrids, type TileGrid, tileMatch } from './tiles'

export async function download(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function classifyImage(
  bytes: Buffer,
  entries: readonly ScamEntry[],
  threshold: number
): Promise<Match | null> {
  const whole = classify(await hashImage(bytes), entries, threshold)
  if (whole) return whole
  return tileMatch(await shiftedGrids(bytes), entries)
}

export async function classifyUrl(
  url: string,
  entries: readonly ScamEntry[],
  threshold: number
): Promise<Match | null> {
  return classifyImage(await download(url), entries, threshold)
}

export async function entryHashes(src: string | Buffer): Promise<{ hash: string; grid: TileGrid }> {
  const bytes = typeof src === 'string' ? await download(src) : src
  return { hash: await hashImage(bytes), grid: await gridFromBytes(bytes) }
}
