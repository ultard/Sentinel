# Sentinel

Discord anti-scam bot. Catches known scam screenshots (fake giveaways, casino
spam) even after they're re-encoded/resized, using a **perceptual hash** (DCT
pHash) instead of a byte hash — the same concept as
[Amirust/anti-scam](https://github.com/Amirust/anti-scam), rebuilt small in
TypeScript/Bun.

On a match it deletes the message and posts a report (with a **Ban** button)
to the configured channel; optionally auto-bans.

## Setup

```bash
bun install
cp .env.example .env
bun start
```

Enable the **Message Content** intent for the bot in the Discord developer
portal.

## Environment

Copy `.env.example` to `.env` and edit the values.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `DISCORD_TOKEN` | yes | — | Bot token from the Discord developer portal. |
| `APPLICATION_ID` | yes | — | Application (client) ID — used to register slash commands. |
| `GUILD_ID` | yes | — | Server ID where slash commands are registered. |
| `MATCH_THRESHOLD` | no | `10` | Max Hamming distance (0–64) that still counts as a match. Lower = stricter (fewer false positives, more misses). Overridable per-server via `/scam config`. |
| `SEED_URL` | no | GitHub `data/defaults.json` | Where startup pulls the known default hashes from. Point it at your own raw JSON to ship a different default list. |
| `SEED_DISABLED` | no | *(off)* | Set to `true` to skip loading default hashes from GitHub on startup. |

## Commands

`/scam add <image> [name]` — add a scam image to the dataset

`/scam remove <name>` — remove an entry

`/scam list` — list entries

`/scam check <image>` — test an image, report nearest match + distance

`/scam config [channel] [threshold] [autoban] [reset-channel]` — per-server settings (no args = show current)

`/scam ignore-role <role> [remove]` — roles that are never scanned

`/scam ignore-channel <channel> [remove]` — channels (and their threads) that are never scanned

Right-click a message → **Apps → Add image to scam list** is the quick way to
grow the dataset.

## How it works

Detection runs in two stages (a port of the Rust original's pipeline):

1. **Whole-image pHash.** Every image is normalized and reduced to a 64-bit DCT
   median perceptual hash. Flagged when its Hamming distance to any dataset
   entry is ≤ the threshold (default 10/64 — re-encoded copies score 0–6,
   unrelated images 18+).
2. **Shift-aligned tile matching** (only when stage 1 misses). The 256×256
   normalized image is split into a 4×4 grid of tiles, each hashed separately.
   The incoming image is re-tiled under every ±6px shift (step 2) and aligned
   against each dataset entry's grid, so a **partially-redrawn** scam still
   matches on the tiles it left intact. Flat tiles (solid backgrounds) are
   ignored. ≥75% of informative tiles matching is a confident hit (delete +
   optional autoban); 60–75% is reported for manual review, but the message is
   left in place.

Manually added entries (`/scam add`, right-click **Add image to scam list**)
carry a tile grid; seeded defaults only have a whole-image hash, so they match
on stage 1 only. Dataset lives in `data/dataset.json`, per-guild settings in
`data/settings.json`.
