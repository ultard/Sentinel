import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ColorResolvable,
  Colors,
  EmbedBuilder,
  type User
} from 'discord.js'

import type { Match } from '@sentinel/phash'

export function infoEmbed(
  title: string,
  description: string,
  color: ColorResolvable = Colors.Blue
) {
  return new EmbedBuilder().setTitle(title).setColor(color).setDescription(description)
}

export const successEmbed = (info: string) => infoEmbed('✅ Done', info, Colors.Green)
export const errorEmbed = (error: string) => infoEmbed('❌ Error', error, Colors.Red)

export function scamReportEmbed(
  author: User,
  match: Match,
  imageUrl: string,
  banned: boolean
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🚨 Scam image detected')
    .setColor(banned ? Colors.DarkRed : Colors.Orange)
    .addFields(
      { name: 'User', value: `${author} (${author.tag})`, inline: true },
      { name: 'Matched', value: `\`${match.entry.name}\``, inline: true },
      { name: 'Distance', value: `${match.distance}/64`, inline: true },
      { name: 'Action', value: banned ? '🔨 Auto-banned' : '🗑️ Message deleted', inline: false }
    )
    .setThumbnail(imageUrl)
    .setTimestamp()
}

/** Ban (unless already auto-banned) + Dismiss buttons for the report message */
export function reportButtons(authorId: string, banned: boolean) {
  const row = new ActionRowBuilder<ButtonBuilder>()
  if (!banned) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ban:${authorId}`)
        .setLabel('Ban user')
        .setStyle(ButtonStyle.Danger)
    )
  }
  row.addComponents(
    new ButtonBuilder().setCustomId('dismiss').setLabel('Dismiss').setStyle(ButtonStyle.Secondary)
  )
  return row
}
