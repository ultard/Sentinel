import type { Client } from 'discord.js'

import { seedFromGithub } from '@sentinel/store'

export default async (client: Client) => {
  const { username, id } = client.user!
  console.log(`Successfully logged in as ${username} (${id})`)
  await seedFromGithub()
}
