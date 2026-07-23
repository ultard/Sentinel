import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@sentinel/config'
import type { ScamEntry } from '@sentinel/store'

const DATASET_FILE = path.join(DATA_DIR, 'dataset.json')
const DEFAULTS_FILE = path.join(DATA_DIR, 'defaults.json')

const read = (file: string): ScamEntry[] =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as ScamEntry[]) : []

/** `sentinel_default_<addedAt as base36 ms>`, matching the names already in defaults.json */
function defaultName(entry: ScamEntry, taken: Set<string>): string {
  const ms = Date.parse(entry.addedAt) || Date.now()
  let name = `sentinel_default_${ms.toString(36)}`
  for (let n = 2; taken.has(name); n++) name = `sentinel_default_${ms.toString(36)}_${n}`
  return name
}

export function promoteDefaults(): number {
  const dataset = read(DATASET_FILE)
  const defaults = read(DEFAULTS_FILE)

  const known = new Map(defaults.map((e) => [e.hash, e.name]))
  const taken = new Set(defaults.map((e) => e.name))

  let added = 0
  let renamed = 0
  for (const entry of dataset) {
    const existing = known.get(entry.hash)
    if (existing) {
      // already a default under another name — align the dataset copy with it
      if (entry.name !== existing) {
        entry.name = existing
        renamed++
      }
      continue
    }
    entry.name = defaultName(entry, taken)
    defaults.push(entry)
    known.set(entry.hash, entry.name)
    taken.add(entry.name)
    added++
    console.log(`[promote] ${entry.name}`)
  }

  if (added || renamed) {
    // dataset entries are renamed too, so the GitHub seed dedupes them by name later
    fs.writeFileSync(DEFAULTS_FILE, `${JSON.stringify(defaults, null, 2)}\n`)
    fs.writeFileSync(DATASET_FILE, `${JSON.stringify(dataset, null, 2)}\n`)
  }
  console.log(`[promote] ${added} hash(es) added, ${renamed} renamed, ${defaults.length} total`)
  return added
}

if (import.meta.main) promoteDefaults()
