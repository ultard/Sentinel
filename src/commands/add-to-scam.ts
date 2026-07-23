import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js'

import { entryHashes } from '@sentinel/detection/detect'
import { classify } from '@sentinel/detection/phash'
import { errorEmbed, infoEmbed, successEmbed } from '@sentinel/embeds'
import { addScam, scamEntries } from '@sentinel/store'

export const data = new ContextMenuCommandBuilder()
  .setName('Add image to scam list')
  .setType(ApplicationCommandType.Message)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

export async function execute(interaction: MessageContextMenuCommandInteraction) {
  const image = interaction.targetMessage.attachments.find((a) =>
    a.contentType?.startsWith('image/')
  )
  if (!image) {
    await interaction.reply({
      embeds: [errorEmbed('That message has no image attachment.')],
      flags: MessageFlags.Ephemeral
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const { hash, grid } = await entryHashes(image.url)

  const existing = classify(hash, scamEntries(), 6)
  if (existing) {
    await interaction.editReply({
      embeds: [infoEmbed('Already covered', `Matches existing entry \`${existing.entry.name}\`.`)]
    })
    return
  }

  const name = `manual_${Date.now().toString(36)}`
  addScam({ name, hash, grid, addedBy: interaction.user.id, addedAt: new Date().toISOString() })
  await interaction.editReply({ embeds: [successEmbed(`Added \`${name}\` to the scam dataset.`)] })
}
