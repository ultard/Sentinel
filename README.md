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
portal. Set `GUILD_ID` for instant command registration while developing; leave
it empty to register globally. Set `OWNER_ID` to restrict dataset edits to you.

## Commands

`/scam add <image> [name]` — add a scam image to the dataset

`/scam remove <name>` — remove an entry

`/scam list` — list entries

`/scam check <image>` — test an image, report nearest match + distance

`/scam config [channel] [threshold] [autoban]` — per-server settings (no args = show current)

`/scam ignore-role <role> [remove]` — roles that are never scanned

Right-click a message → **Apps → Add image to scam list** is the quick way to
grow the dataset.

## How it works

Every image is normalized and reduced to a 64-bit DCT median perceptual hash.
An incoming image is flagged when its Hamming distance to any dataset entry is
≤ the threshold (default 10/64 — re-encoded copies score 0–6, unrelated images
18+). Dataset lives in `data/dataset.json`, per-guild settings in
`data/settings.json`.

Skipped from the Rust original: shift-aligned **tile matching** (catches
partially-redrawn variants). Add it if whole-image pHash proves too coarse.
