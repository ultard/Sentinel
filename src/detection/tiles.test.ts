import { expect, test } from 'bun:test'

import {
  dctHash,
  shiftPixels,
  TILE_COUNT,
  type TileGrid,
  tileMatch
} from '@sentinel/detection/tiles'
import type { ScamEntry } from '@sentinel/store'

const H0 = '0'.repeat(64)
/** a hash `n` bits away from H0 (n<=13 counts as a tile match, else not) */
const flip = (n: number) => '1'.repeat(n) + '0'.repeat(64 - n)

/** build a grid; '' marks a non-informative tile */
function grid(hashes: string[]): TileGrid {
  return {
    hashes: hashes.map((h) => h || H0),
    informative: hashes.map((h) => h !== '')
  }
}

const entry = (g: TileGrid): ScamEntry => ({
  name: 'scam',
  hash: H0,
  grid: g,
  addedBy: '0',
  addedAt: ''
})

test('identical grid across all tiles is a confident match', () => {
  const g = grid(Array(TILE_COUNT).fill(H0))
  const m = tileMatch([g], [entry(g)])
  expect(m?.confident).toBe(true)
  expect(m?.tiles).toEqual({ matched: 16, informative: 16 })
})

test('~70% of informative tiles matching is a review-tier match', () => {
  // 10 informative tiles: 7 within threshold, 3 too far; 6 flat/ignored
  const incoming = grid([
    ...Array(7).fill(flip(5)), // match (<=13)
    ...Array(3).fill(flip(20)), // miss (>13)
    ...Array(6).fill('') // non-informative
  ])
  const db = grid(Array(TILE_COUNT).fill(H0))
  const m = tileMatch([incoming], [entry(db)])
  expect(m?.confident).toBe(false)
  expect(m?.tiles).toEqual({ matched: 7, informative: 10 })
})

test('below the review percentage is no match', () => {
  const incoming = grid([...Array(4).fill(H0), ...Array(6).fill(flip(20)), ...Array(6).fill('')])
  const db = grid(Array(TILE_COUNT).fill(H0))
  expect(tileMatch([incoming], [entry(db)])).toBeNull()
})

test('too few informative tiles is never trusted', () => {
  const incoming = grid([...Array(5).fill(H0), ...Array(11).fill('')])
  const db = grid(Array(TILE_COUNT).fill(H0))
  expect(tileMatch([incoming], [entry(db)])).toBeNull()
})

test('the best-aligned shift is the one that counts', () => {
  const db = grid(Array(TILE_COUNT).fill(H0))
  const bad = grid(Array(TILE_COUNT).fill(flip(20)))
  const good = grid(Array(TILE_COUNT).fill(H0))
  // a misaligned grid alone misses; the aligned shift in the list rescues it
  expect(tileMatch([bad], [entry(db)])).toBeNull()
  expect(tileMatch([bad, good], [entry(db)])?.confident).toBe(true)
})

test('shiftPixels translates content and replicates the edge', () => {
  const size = 256
  const img = new Uint8Array(size * size)
  img[10 * size + 10] = 255
  expect(shiftPixels(img, 2, 4)[12 * size + 14]).toBe(255)

  const edge = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) edge[y * size + (size - 1)] = 200
  const shifted = shiftPixels(edge, 0, -3)
  expect(shifted[size - 1]).toBe(200) // replicated, not wrapped
  expect(shifted[size - 4]).toBe(200)
  expect(shifted[size - 5]).toBe(0)
})

test('dctHash is deterministic and content-sensitive', () => {
  const gradient = Uint8Array.from({ length: 64 * 64 }, (_, i) => i % 256)
  const other = Uint8Array.from({ length: 64 * 64 }, (_, i) => (i * 7) % 256)
  expect(dctHash(gradient)).toBe(dctHash(gradient))
  expect(dctHash(gradient).length).toBe(64)
  expect(dctHash(gradient)).not.toBe(dctHash(other))
})
