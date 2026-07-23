declare module 'sharp-phash' {
  /** 64-char binary string (DCT median perceptual hash) */
  export default function phash(input: Buffer | Uint8Array): Promise<string>
}
