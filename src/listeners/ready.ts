import type { Client } from 'discord.js'

export default (client: Client) => {
  const { username, id } = client.user!
  console.log(`Successfully logged in as ${username} (${id})`)
}
