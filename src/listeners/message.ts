import {
  type Attachment,
  AttachmentBuilder,
  type Message,
  type OmitPartialGroupDMChannel,
  type SendableChannels
} from 'discord.js'

import { classifyImage, download } from '@sentinel/detection/detect'
import type { Match } from '@sentinel/detection/phash'
import { reportButtons, scamReportEmbed } from '@sentinel/embeds'
import { type GuildSettings, getSettings, scamEntries } from '@sentinel/store'

// real scam screenshots are tiny; skip anything larger
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export default async (message: OmitPartialGroupDMChannel<Message>) => {
  if (!message.inGuild() || message.author.bot) return

  const images = [...message.attachments.values()].filter(
    (a) => a.contentType?.startsWith('image/') && a.size <= MAX_ATTACHMENT_BYTES
  )
  if (images.length === 0) return

  const entries = scamEntries()
  if (entries.length === 0) return

  const settings = getSettings(message.guildId)
  // a thread inherits its parent channel's exemption
  if (
    settings.ignoreChannelIds.some(
      (id) => id === message.channelId || id === message.channel.parentId
    )
  )
    return
  if (
    settings.ignoreRoleIds.length &&
    message.member?.roles.cache.hasAny(...settings.ignoreRoleIds)
  )
    return

  for (const image of images) {
    let bytes: Buffer
    let match: Match | null
    try {
      bytes = await download(image.url)
      match = await classifyImage(bytes, entries, settings.threshold)
    } catch (error) {
      console.error('failed to hash attachment', error)
      continue
    }
    if (match) {
      await act(message, image, bytes, match, settings)
      return
    }
  }
}

async function act(
  message: OmitPartialGroupDMChannel<Message<true>>,
  image: Attachment,
  bytes: Buffer,
  match: Match,
  settings: GuildSettings
) {
  const author = message.author
  const name = `scam${image.name.match(/\.\w+$/)?.[0] ?? '.png'}`
  const file = new AttachmentBuilder(bytes, { name })
  const url = `attachment://${name}`

  // review-tier tile matches are lower confidence: report for a human, but don't
  // delete the message or ban the author.
  if (!match.confident) {
    const target = await resolveReportChannel(message, settings)
    await target
      ?.send({
        embeds: [scamReportEmbed(author, match, url, false)],
        components: [reportButtons(author.id, false)],
        files: [file]
      })
      .catch(() => {})
    return
  }

  await message.delete().catch(() => {})

  let banned = false
  if (settings.autoban) {
    banned = await message.guild.members
      .ban(author.id, {
        deleteMessageSeconds: 24 * 3600,
        reason: `Sentinel: scam "${match.entry.name}"`
      })
      .then(() => true)
      .catch(() => false)
  }

  const target = await resolveReportChannel(message, settings)
  await target
    ?.send({
      embeds: [scamReportEmbed(author, match, url, banned)],
      components: [reportButtons(author.id, banned)],
      files: [file]
    })
    .catch(() => {})
}

async function resolveReportChannel(
  message: OmitPartialGroupDMChannel<Message<true>>,
  settings: GuildSettings
): Promise<SendableChannels | null> {
  if (settings.notifyChannelId) {
    const channel = await message.guild.channels.fetch(settings.notifyChannelId).catch(() => null)
    if (channel?.isSendable()) return channel
  }
  return message.channel.isSendable() ? message.channel : null
}
