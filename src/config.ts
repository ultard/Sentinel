export const DATA_DIR = './data'
export const DEFAULT_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 10)

export function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var "${key}"`)
  return value
}
