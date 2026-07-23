import { expect, test } from 'bun:test'

import { classify, hamming, nearest } from '@sentinel/detection/phash'
import type { ScamEntry } from '@sentinel/store'

const entry = (name: string, hash: string): ScamEntry => ({
  name,
  hash,
  addedBy: '0',
  addedAt: ''
})

test('hamming counts differing bits', () => {
  expect(hamming('0000', '0000')).toBe(0)
  expect(hamming('0000', '1111')).toBe(4)
  expect(hamming('1010', '1001')).toBe(2)
})

test('classify returns closest entry within threshold, else null', () => {
  const db = [entry('a', '1111000000000000'), entry('b', '1111111100000000')]

  // distance 1 from 'a' -> matches
  expect(classify('1110000000000000', db, 3)?.entry.name).toBe('a')
  // distance 4 from 'a', 4 from 'b'; threshold 3 -> no match
  expect(classify('0000111100000000', db, 3)).toBeNull()
})

test('nearest ignores threshold', () => {
  const db = [entry('a', '0000'), entry('b', '1111')]
  const m = nearest('1110', db)
  expect(m?.entry.name).toBe('b')
  expect(m?.distance).toBe(1)
})
