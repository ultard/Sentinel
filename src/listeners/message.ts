import type { Attachment, Message, OmitPartialGroupDMChannel, SendableChannels } from 'discord.js'

import { classifyUrl } from '@sentinel/detect'
import { reportButtons, scamReportEmbed } from '@sentinel/embeds'
import type { Match } from '@sentinel/phash'
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
    let match: Match | null
    try {
      match = await classifyUrl(image.url, entries, settings.threshold)
    } catch (error) {
      console.error('failed to hash attachment', error)
      continue
    }
    if (match) {
      await act(message, image, match, settings)
      return
    }
  }
}

async function act(
  message: OmitPartialGroupDMChannel<Message<true>>,
  image: Attachment,
  match: Match,
  settings: GuildSettings
) {
  const author = message.author

  // review-tier tile matches are lower confidence: report for a human, but don't
  // delete the message or ban the author.
  if (!match.confident) {
    const target = await resolveReportChannel(message, settings)
    await target
      ?.send({
        embeds: [scamReportEmbed(author, match, image.url, false)],
        components: [reportButtons(author.id, false)]
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
      embeds: [scamReportEmbed(author, match, image.url, banned)],
      components: [reportButtons(author.id, banned)]
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
