import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR, DEFAULT_THRESHOLD } from '@sentinel/config'

export interface ScamEntry {
  name: string
  /** 64-char binary perceptual hash */
  hash: string
  addedBy: string
  addedAt: string
}

export interface GuildSettings {
  notifyChannelId?: string
  /** max Hamming distance (0-64) that still counts as a match */
  threshold: number
  /** ban the author automatically instead of only reporting */
  autoban: boolean
  /** members with any of these roles are never scanned */
  ignoreRoleIds: string[]
}

const DATASET_FILE = path.join(DATA_DIR, 'dataset.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}


function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

let dataset: ScamEntry[] = readJson<ScamEntry[]>(DATASET_FILE, [])
const settings: Record<string, GuildSettings> = readJson(SETTINGS_FILE, {})

export function scamEntries(): readonly ScamEntry[] {
  return dataset
}

/** false if an entry with that name already exists */
export function addScam(entry: ScamEntry): boolean {
  if (dataset.some((e) => e.name === entry.name)) return false
  dataset.push(entry)
  writeJson(DATASET_FILE, dataset)
  return true
}

/** false if no entry had that name */
export function removeScam(name: string): boolean {
  const next = dataset.filter((e) => e.name !== name)
  if (next.length === dataset.length) return false
  dataset = next
  writeJson(DATASET_FILE, dataset)
  return true
}

export function getSettings(guildId: string): GuildSettings {
  return {
    threshold: DEFAULT_THRESHOLD,
    autoban: false,
    ignoreRoleIds: [],
    ...settings[guildId]
  }
}

export function updateSettings(guildId: string, patch: Partial<GuildSettings>): void {
  settings[guildId] = { ...getSettings(guildId), ...patch }
  writeJson(SETTINGS_FILE, settings)
}
