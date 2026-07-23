import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ColorResolvable,
  Colors,
  EmbedBuilder,
  type User
} from 'discord.js'

import type { Match } from '@sentinel/detection/phash'

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
  const review = !match.confident
  const score =
    match.reason === 'tiles' && match.tiles
      ? {
          name: 'Tiles matched',
          value: `${match.tiles.matched}/${match.tiles.informative}`,
          inline: true
        }
      : { name: 'Distance', value: `${match.distance}/64`, inline: true }
  const action = review
    ? '⚠️ Flagged for review (message kept)'
    : banned
      ? '🔨 Auto-banned'
      : '🗑️ Message deleted'

  return new EmbedBuilder()
    .setTitle(review ? '⚠️ Possible scam image' : '🚨 Scam image detected')
    .setColor(review ? Colors.Yellow : banned ? Colors.DarkRed : Colors.Orange)
    .addFields(
      { name: 'User', value: `${author} (${author.tag})`, inline: true },
      { name: 'Matched', value: `\`${match.entry.name}\``, inline: true },
      score,
      { name: 'Action', value: action, inline: false }
    )
    .setImage(imageUrl)
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
