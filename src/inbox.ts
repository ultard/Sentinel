import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@sentinel/config'
import { entryHashes } from '@sentinel/detection/detect'
import { classify } from '@sentinel/detection/phash'
import { addScam, scamEntries } from '@sentinel/store'

const INBOX_DIR = path.join(DATA_DIR, 'inbox')
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i

/** hash one dropped file: report whether it's already known, add it if not */
async function ingest(file: string): Promise<void> {
  const full = path.join(INBOX_DIR, file)
  let hash: string
  let grid: Awaited<ReturnType<typeof entryHashes>>['grid']
  try {
    ;({ hash, grid } = await entryHashes(fs.readFileSync(full)))
  } catch (err) {
    console.warn(`[inbox] ${file}: could not hash (${String(err)})`)
    return
  }

  const existing = classify(hash, scamEntries(), 6)
  if (existing) {
    console.log(`[inbox] ${file}: already in dataset as "${existing.entry.name}"`)
    return
  }

  const name = path.basename(file, path.extname(file))
  const ok = addScam({ name, hash, grid, addedBy: 'inbox', addedAt: new Date().toISOString() })
  console.log(
    ok ? `[inbox] ${file}: added as "${name}"` : `[inbox] ${file}: name "${name}" already taken`
  )
}

/** watch data/inbox for dropped images; also scans whatever is already there */
export function watchInbox(): void {
  fs.mkdirSync(INBOX_DIR, { recursive: true })

  for (const file of fs.readdirSync(INBOX_DIR)) {
    if (IMAGE_EXT.test(file)) ingest(file)
  }

  // ponytail: 500ms debounce stands in for "file finished writing" — a slow
  // copy of a huge image logs a hash error; drop it again or restart the bot.
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  fs.watch(INBOX_DIR, (_event, file) => {
    if (!file || !IMAGE_EXT.test(file)) return
    clearTimeout(pending.get(file))
    pending.set(
      file,
      setTimeout(() => {
        pending.delete(file)
        if (fs.existsSync(path.join(INBOX_DIR, file))) ingest(file)
      }, 500)
    )
  })

  console.log(`[inbox] watching ${INBOX_DIR}`)
}
