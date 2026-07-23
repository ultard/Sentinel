import {
  type ButtonInteraction,
  type CommandInteraction,
  type Interaction,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js'

import { errorEmbed } from '@sentinel/embeds'

export default async (interaction: Interaction) => {
  if (!interaction.inGuild()) return
  if (interaction.isButton()) return handleButton(interaction)
  if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand())
    return handleCommand(interaction)
}

async function handleCommand(interaction: CommandInteraction) {
  const command = interaction.client.commands.get(interaction.commandName)
  console.log(command)
  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`)
    return
  }

  try {
    await command.execute(interaction)
  } catch (error) {
    console.error(error)
    const content = 'There was an error while executing this command!'
    if (interaction.replied || interaction.deferred)
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral })
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral })
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const [action, userId] = interaction.customId.split(':')

  if (action === 'dismiss') {
    await interaction.message.delete().catch(() => {})
    return
  }

  if (action === 'ban' && userId) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({
        embeds: [errorEmbed('You need the Ban Members permission.')],
        flags: MessageFlags.Ephemeral
      })
      return
    }

    try {
      await interaction.guild?.members.ban(userId, {
        deleteMessageSeconds: 24 * 3600,
        reason: `Sentinel: scam image (by ${interaction.user.tag})`
      })
    } catch {
      await interaction.reply({
        embeds: [errorEmbed('Failed to ban — missing permissions or user already gone.')],
        flags: MessageFlags.Ephemeral
      })
      return
    }

    await interaction.update({ components: [] }).catch(() => {})
    await interaction.followUp({
      content: `🔨 Banned <@${userId}>.`,
      flags: MessageFlags.Ephemeral
    })
  }
}
