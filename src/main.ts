import { Glob } from 'bun'

import {
  Client,
  Collection,
  type CommandInteraction,
  GatewayIntentBits,
  REST,
  type RESTPostAPIApplicationCommandsJSONBody,
  Routes
} from 'discord.js'

import { requireEnv } from '@sentinel/config'
import { InteractionListener, MessageListener, ReadyListener } from '@sentinel/listeners'

interface Command {
  data: { name: string; toJSON: () => RESTPostAPIApplicationCommandsJSONBody }
  execute(interaction: CommandInteraction): Promise<unknown>
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, Command>
  }
}

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  client.commands = new Collection<string, Command>()

  const glob = new Glob('**/*.ts')
  for await (const filePath of glob.scan({ cwd: `${import.meta.dir}/commands`, absolute: true })) {
    const command: Command = await import(filePath)
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command)
    } else {
      console.warn(`[WARNING] ${filePath} is missing a "data" or "execute" export.`)
    }
  }

  const token = requireEnv('DISCORD_TOKEN')
  const applicationId = requireEnv('APPLICATION_ID')
  const guildId = requireEnv('GUILD_ID')

  const body = client.commands.map((command) => command.data.toJSON())
  const rest = new REST({ version: '10' }).setToken(token)

  await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId), 
    { body }
  )

  client.once('clientReady', ReadyListener)
  client.on('messageCreate', MessageListener)
  client.on('interactionCreate', InteractionListener)

  await client.login(token)
}

main()
