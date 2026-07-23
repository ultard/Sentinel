import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js'

import { entryHashes } from '@sentinel/detect'
import { errorEmbed, infoEmbed, successEmbed } from '@sentinel/embeds'
import { classify, hashUrl, nearest } from '@sentinel/phash'
import { addScam, getSettings, removeScam, scamEntries, updateSettings } from '@sentinel/store'

export const data = new SlashCommandBuilder()
  .setName('scam')
  .setDescription('Manage the scam-image detector')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add an image to the scam dataset')
      .addAttachmentOption((o) =>
        o.setName('image').setDescription('The scam image').setRequired(true)
      )
      .addStringOption((o) => o.setName('name').setDescription('Optional entry name'))
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove an entry from the scam dataset')
      .addStringOption((o) => o.setName('name').setDescription('Entry name').setRequired(true))
  )
  .addSubcommand((s) => s.setName('list').setDescription('List scam dataset entries'))
  .addSubcommand((s) =>
    s
      .setName('check')
      .setDescription('Test an image against the dataset without acting on it')
      .addAttachmentOption((o) =>
        o.setName('image').setDescription('Image to test').setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('Configure detection for this server')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for scam reports'))
      .addIntegerOption((o) =>
        o
          .setName('threshold')
          .setDescription('Match distance 0-64 (lower = stricter, default 10)')
          .setMinValue(0)
          .setMaxValue(64)
      )
      .addBooleanOption((o) =>
        o.setName('autoban').setDescription('Ban the author automatically on a match')
      )
      .addBooleanOption((o) =>
        o.setName('reset-channel').setDescription('Report in the origin channel again')
      )
  )
  .addSubcommand((s) =>
    s
      .setName('ignore-role')
      .setDescription('Add or remove a role that is never scanned')
      .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
      .addBooleanOption((o) => o.setName('remove').setDescription('Remove instead of add'))
  )
  .addSubcommand((s) =>
    s
      .setName('ignore-channel')
      .setDescription('Add or remove a channel that is never scanned')
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').setRequired(true))
      .addBooleanOption((o) => o.setName('remove').setDescription('Remove instead of add'))
  )

type GuildChatInput = ChatInputCommandInteraction<'raw' | 'cached'>

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      embeds: [errorEmbed('This command can only be used in a server.')],
      flags: MessageFlags.Ephemeral
    })
    return
  }

  switch (interaction.options.getSubcommand()) {
    case 'add':
      return add(interaction)
    case 'remove':
      return remove(interaction)
    case 'list':
      return list(interaction)
    case 'check':
      return check(interaction)
    case 'config':
      return config(interaction)
    case 'ignore-role':
      return ignoreRole(interaction)
    case 'ignore-channel':
      return ignoreChannel(interaction)
  }
}

async function add(interaction: ChatInputCommandInteraction) {
  const image = interaction.options.getAttachment('image', true)
  if (!image.contentType?.startsWith('image/')) {
    await interaction.reply({
      embeds: [errorEmbed('That attachment is not an image.')],
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

  const name = interaction.options.getString('name')?.trim() || `manual_${Date.now().toString(36)}`
  const ok = addScam({
    name,
    hash,
    grid,
    addedBy: interaction.user.id,
    addedAt: new Date().toISOString()
  })
  await interaction.editReply({
    embeds: ok
      ? [successEmbed(`Added \`${name}\`. New posts of this image are now flagged.`)]
      : [errorEmbed(`The name \`${name}\` is already taken.`)]
  })
}

async function remove(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString('name', true)
  const ok = removeScam(name)
  await interaction.reply({
    embeds: ok
      ? [successEmbed(`Removed \`${name}\`.`)]
      : [errorEmbed(`No entry named \`${name}\`.`)],
    flags: MessageFlags.Ephemeral
  })
}

async function list(interaction: ChatInputCommandInteraction) {
  const entries = scamEntries()
  const body = entries.length
    ? entries
        .map((e) => `• \`${e.name}\``)
        .join('\n')
        .slice(0, 3900)
    : '_empty_'
  await interaction.reply({
    embeds: [infoEmbed(`Scam dataset (${entries.length})`, body)],
    flags: MessageFlags.Ephemeral
  })
}

async function check(interaction: GuildChatInput) {
  const image = interaction.options.getAttachment('image', true)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const match = nearest(await hashUrl(image.url), scamEntries())
  if (!match) {
    await interaction.editReply({ embeds: [infoEmbed('Check', 'Dataset is empty.')] })
    return
  }

  const threshold = getSettings(interaction.guildId).threshold
  const distance = match.distance ?? 64
  const flagged = distance <= threshold
  await interaction.editReply({
    embeds: [
      infoEmbed(
        flagged ? '🚨 Would be flagged' : '✅ Clean',
        `Nearest: \`${match.entry.name}\` at distance **${distance}/64** (threshold ${threshold}).`
      )
    ]
  })
}

async function config(interaction: GuildChatInput) {
  const channel = interaction.options.getChannel('channel')
  const threshold = interaction.options.getInteger('threshold')
  const autoban = interaction.options.getBoolean('autoban')
  const resetChannel = interaction.options.getBoolean('reset-channel')

  if (channel === null && threshold === null && autoban === null && !resetChannel) {
    const s = getSettings(interaction.guildId)
    await interaction.reply({
      embeds: [
        infoEmbed(
          'Current config',
          [
            `Report channel: ${s.notifyChannelId ? `<#${s.notifyChannelId}>` : 'origin channel'}`,
            `Threshold: ${s.threshold}/64`,
            `Autoban: ${s.autoban}`,
            `Ignored roles: ${s.ignoreRoleIds.map((r) => `<@&${r}>`).join(', ') || 'none'}`,
            `Ignored channels: ${s.ignoreChannelIds.map((c) => `<#${c}>`).join(', ') || 'none'}`
          ].join('\n')
        )
      ],
      flags: MessageFlags.Ephemeral
    })
    return
  }

  updateSettings(interaction.guildId, {
    ...(resetChannel
      ? { notifyChannelId: undefined }
      : channel !== null && { notifyChannelId: channel.id }),
    ...(threshold !== null && { threshold }),
    ...(autoban !== null && { autoban })
  })
  await interaction.reply({
    embeds: [successEmbed('Configuration updated.')],
    flags: MessageFlags.Ephemeral
  })
}

async function ignoreRole(interaction: GuildChatInput) {
  const role = interaction.options.getRole('role', true)
  const remove = interaction.options.getBoolean('remove') ?? false
  const current = getSettings(interaction.guildId).ignoreRoleIds

  const next = remove ? current.filter((id) => id !== role.id) : [...new Set([...current, role.id])]
  updateSettings(interaction.guildId, { ignoreRoleIds: next })

  await interaction.reply({
    embeds: [
      successEmbed(
        `${remove ? 'Removed' : 'Added'} <@&${role.id}> ${remove ? 'from' : 'to'} the ignore list.`
      )
    ],
    flags: MessageFlags.Ephemeral
  })
}

async function ignoreChannel(interaction: GuildChatInput) {
  const channel = interaction.options.getChannel('channel', true)
  const remove = interaction.options.getBoolean('remove') ?? false
  const current = getSettings(interaction.guildId).ignoreChannelIds

  const next = remove
    ? current.filter((id) => id !== channel.id)
    : [...new Set([...current, channel.id])]
  updateSettings(interaction.guildId, { ignoreChannelIds: next })

  await interaction.reply({
    embeds: [
      successEmbed(
        `${remove ? 'Removed' : 'Added'} <#${channel.id}> ${remove ? 'from' : 'to'} the ignore list.`
      )
    ],
    flags: MessageFlags.Ephemeral
  })
}
