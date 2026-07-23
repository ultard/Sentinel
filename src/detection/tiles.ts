import sharp from 'sharp'

import type { ScamEntry } from '@sentinel/store'

import { type Match, packHash, popcount32 } from './phash'

// port of anti-scam's shift-aligned tile matcher: split the normalized image into
// a 4x4 grid, hash each tile, and compare against a DB entry's grid under every
// small translation. catches scams that redraw part of the image (whole-image
// pHash smears those into a miss) and survives the ~5px drift re-encoding adds.

const IMAGE_SIZE = 256
const TILE_SIZE = 64
const TILES_PER_SIDE = IMAGE_SIZE / TILE_SIZE // 4
export const TILE_COUNT = TILES_PER_SIDE * TILES_PER_SIDE // 16
const HASH_SIZE = 8 // 8x8 DCT coefficients -> 64-bit hash

// a tile counts as "informative" (worth comparing) when its pixel variance clears
// this; flat tiles (solid background) match everything and only add noise.
const INFORMATIVE_VARIANCE_THRESHOLD = 150

// detection thresholds, calibrated in the Rust original (config.toml [detection]).
const TILE_MATCH_THRESHOLD = 13 // max per-tile Hamming distance that still matches
const MIN_INFORMATIVE_TILES = 6 // need strictly more than this to trust a verdict
const HARD_MATCH_PERCENT = 75 // >= this % of informative tiles matching -> confident
const REVIEW_PERCENT = 60 // >= this % -> report for manual review, don't auto-act

// re-encoded copies drift by ~5px at this scale; try shifts of +-6px in steps of 2.
const SHIFT_RANGE = 6
const SHIFT_STEP = 2

export interface TileGrid {
  /** 16 tile hashes, each a 64-char binary string (same format as whole-image hashes) */
  hashes: string[]
  /** which of the 16 tiles carry enough signal to compare */
  informative: boolean[]
}

// cos((x+0.5)*u*pi/N) for u in 0..HASH_SIZE, x in 0..TILE_SIZE, indexed [u*TILE_SIZE + x].
const COS = (() => {
  const table = new Float64Array(HASH_SIZE * TILE_SIZE)
  for (let u = 0; u < HASH_SIZE; u++)
    for (let x = 0; x < TILE_SIZE; x++)
      table[u * TILE_SIZE + x] = Math.cos(((x + 0.5) * u * Math.PI) / TILE_SIZE)
  return table
})()

/** DCT-median perceptual hash of one TILE_SIZE x TILE_SIZE grayscale tile */
export function dctHash(tile: Uint8Array): string {
  // separable 2D DCT-II, keeping only the top-left HASH_SIZE x HASH_SIZE block.
  // scale factors are dropped: the median threshold below is scale-invariant.
  const rows = new Float64Array(TILE_SIZE * HASH_SIZE) // [y*HASH_SIZE + u]
  for (let y = 0; y < TILE_SIZE; y++) {
    const row = y * TILE_SIZE
    for (let u = 0; u < HASH_SIZE; u++) {
      const cos = u * TILE_SIZE
      let s = 0
      for (let x = 0; x < TILE_SIZE; x++) s += tile[row + x]! * COS[cos + x]!
      rows[y * HASH_SIZE + u] = s
    }
  }

  const coeffs = new Float64Array(HASH_SIZE * HASH_SIZE)
  for (let u = 0; u < HASH_SIZE; u++)
    for (let v = 0; v < HASH_SIZE; v++) {
      const cos = v * TILE_SIZE
      let s = 0
      for (let y = 0; y < TILE_SIZE; y++) s += rows[y * HASH_SIZE + u]! * COS[cos + y]!
      coeffs[v * HASH_SIZE + u] = s
    }

  const median = median64(coeffs)
  let bits = ''
  for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) bits += coeffs[i]! > median ? '1' : '0'
  return bits
}

function median64(values: Float64Array): number {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[31]! + sorted[32]!) / 2
}

function isInformative(tile: Uint8Array): boolean {
  const n = tile.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += tile[i]!
  const mean = sum / n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = tile[i]! - mean
    variance += d * d
  }
  return variance / n > INFORMATIVE_VARIANCE_THRESHOLD
}

/** hash grid of a normalized IMAGE_SIZE^2 grayscale image */
function gridOfPixels(pixels: Uint8Array): TileGrid {
  const hashes: string[] = []
  const informative: boolean[] = []
  const tile = new Uint8Array(TILE_SIZE * TILE_SIZE)

  for (let ty = 0; ty < TILES_PER_SIDE; ty++)
    for (let tx = 0; tx < TILES_PER_SIDE; tx++) {
      for (let row = 0; row < TILE_SIZE; row++) {
        const start = (ty * TILE_SIZE + row) * IMAGE_SIZE + tx * TILE_SIZE
        tile.set(pixels.subarray(start, start + TILE_SIZE), row * TILE_SIZE)
      }
      hashes.push(dctHash(tile))
      informative.push(isInformative(tile))
    }

  return { hashes, informative }
}

/** translate by (dy, dx), replicating edge pixels (no wraparound polluting border tiles) */
export function shiftPixels(pixels: Uint8Array, dy: number, dx: number): Uint8Array {
  const out = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE)
  for (let y = 0; y < IMAGE_SIZE; y++) {
    const sy = clamp(y - dy, 0, IMAGE_SIZE - 1)
    for (let x = 0; x < IMAGE_SIZE; x++) {
      const sx = clamp(x - dx, 0, IMAGE_SIZE - 1)
      out[y * IMAGE_SIZE + x] = pixels[sy * IMAGE_SIZE + sx]!
    }
  }
  return out
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** resize to IMAGE_SIZE^2, grayscale, and return the single luminance channel */
async function normalize(bytes: Buffer): Promise<Uint8Array> {
  const { data, info } = await sharp(bytes)
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  // grayscale() may still emit 3 identical channels; take channel 0 either way.
  const step = info.channels
  const out = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE)
  for (let i = 0; i < out.length; i++) out[i] = data[i * step]!
  return out
}

/** the DB-side grid: computed once when an entry is added */
export async function gridFromBytes(bytes: Buffer): Promise<TileGrid> {
  return gridOfPixels(await normalize(bytes))
}

/** the incoming-image side: a grid per trial shift (includes the zero shift) */
// ponytail: 49-grid brute force per image, only runs on a whole-image miss.
// parallelize or cache normalized pixels if it ever shows up hot.
export async function shiftedGrids(bytes: Buffer): Promise<TileGrid[]> {
  const pixels = await normalize(bytes)
  const grids: TileGrid[] = []
  for (let dy = -SHIFT_RANGE; dy <= SHIFT_RANGE; dy += SHIFT_STEP)
    for (let dx = -SHIFT_RANGE; dx <= SHIFT_RANGE; dx += SHIFT_STEP)
      grids.push(
        dy === 0 && dx === 0 ? gridOfPixels(pixels) : gridOfPixels(shiftPixels(pixels, dy, dx))
      )
  return grids
}

interface TileScore {
  matched: number
  informative: number
}

// packed form of a TileGrid: each 64-bit tile hash as two 32-bit words at
// [i*2, i*2+1], so a tile comparison is XOR + popcount instead of 64 string
// compares. DB grids are packed once and cached; incoming grids are packed once
// per image and reused across every entry.
interface PackedGrid {
  words: Uint32Array
  informative: boolean[]
}

function packGrid(g: TileGrid): PackedGrid {
  const words = new Uint32Array(TILE_COUNT * 2)
  for (let i = 0; i < TILE_COUNT; i++) {
    const w = packHash(g.hashes[i]!)
    words[i * 2] = w[0]!
    words[i * 2 + 1] = w[1]!
  }
  return { words, informative: g.informative }
}

const packedCache = new WeakMap<TileGrid, PackedGrid>()
function packedDb(g: TileGrid): PackedGrid {
  let p = packedCache.get(g)
  if (!p) {
    p = packGrid(g)
    packedCache.set(g, p)
  }
  return p
}

/** best alignment of the incoming grids against one DB grid */
function bestShift(shifted: PackedGrid[], db: PackedGrid): TileScore {
  let best: TileScore = { matched: 0, informative: 0 }
  let bestTotal = Number.POSITIVE_INFINITY
  let seen = false

  for (const grid of shifted) {
    let matched = 0
    let informative = 0
    let total = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      if (!grid.informative[i] || !db.informative[i]) continue
      const j = i * 2
      const d =
        popcount32(grid.words[j]! ^ db.words[j]!) +
        popcount32(grid.words[j + 1]! ^ db.words[j + 1]!)
      informative++
      total += d
      if (d <= TILE_MATCH_THRESHOLD) matched++
    }
    // more matches wins; tie-break on lower total distance (tighter fit)
    if (!seen || matched > best.matched || (matched === best.matched && total < bestTotal)) {
      best = { matched, informative }
      bestTotal = total
      seen = true
    }
  }
  return best
}

/**
 * stage 2 of detection: shift-aligned tile match of the incoming image against
 * every DB entry that carries a grid. returns the most severe match, or null.
 */
export function tileMatch(shifted: TileGrid[], entries: readonly ScamEntry[]): Match | null {
  const packedShifted = shifted.map(packGrid) // pack the 49 incoming grids once
  let best: Match | null = null
  for (const entry of entries) {
    if (!entry.grid) continue // seeded defaults have no grid -> whole-image only
    const score = bestShift(packedShifted, packedDb(entry.grid))
    if (score.informative <= MIN_INFORMATIVE_TILES) continue // too little signal
    const percent = (score.matched * 100) / score.informative
    if (percent < REVIEW_PERCENT) continue
    best = moreSevere(best, {
      entry,
      reason: 'tiles',
      confident: percent >= HARD_MATCH_PERCENT,
      tiles: score
    })
  }
  return best
}

function moreSevere(a: Match | null, b: Match): Match {
  if (!a) return b
  if (a.confident !== b.confident) return a.confident ? a : b
  // same tier: higher match ratio wins (cross-multiply to avoid floats)
  const at = a.tiles ?? { matched: 0, informative: 1 }
  const bt = b.tiles ?? { matched: 0, informative: 1 }
  return at.matched * bt.informative >= bt.matched * at.informative ? a : b
}
