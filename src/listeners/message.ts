import type { Attachment, Message, OmitPartialGroupDMChannel, SendableChannels } from 'discord.js'

import { reportButtons, scamReportEmbed } from '@sentinel/embeds'
import { classify, hashUrl, type Match } from '@sentinel/phash'
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
  if (
    settings.ignoreRoleIds.length &&
    message.member?.roles.cache.hasAny(...settings.ignoreRoleIds)
  )
    return

  for (const image of images) {
    let match: Match | null
    try {
      match = classify(await hashUrl(image.url), entries, settings.threshold)
    } catch (error) {
      console.error('failed to hash attachment', error)
      continue
    }
    if (match) {
      await act(message, image, match, settings)
      return // one report per message is enough
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
