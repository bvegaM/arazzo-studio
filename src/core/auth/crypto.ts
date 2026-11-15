// Primitivas para firmar requests: SHA, HMAC (WebCrypto, disponible en el navegador, en Electron y
// en Node) y MD5 (WebCrypto no lo trae y Digest auth lo necesita).

export type Bytes = Uint8Array

const encoder = new TextEncoder()
export const utf8 = (s: string): Bytes => encoder.encode(s)
const bytes = (v: string | Bytes): Bytes => (typeof v === 'string' ? utf8(v) : v)

export function toHex(b: Bytes): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function toBase64(b: Bytes): string {
  let bin = ''
  for (const x of b) bin += String.fromCharCode(x)
  return btoa(bin)
}

/** Bytes aleatorios en hexadecimal (nonces). */
export function randomHex(n = 16): string {
  return toHex(crypto.getRandomValues(new Uint8Array(n)))
}

export async function sha(alg: 'SHA-1' | 'SHA-256', data: string | Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest(alg, bytes(data) as BufferSource))
}

export async function hmac(alg: 'SHA-1' | 'SHA-256', key: string | Bytes, data: string | Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', bytes(key) as BufferSource, { name: 'HMAC', hash: alg }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes(data) as BufferSource))
}

// --- MD5 (RFC 1321) ---

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

/** MD5 en hexadecimal. */
export function md5(input: string | Bytes): string {
  const msg = bytes(input)
  const len = msg.length
  const padded = new Uint8Array(((len + 8) >>> 6) * 64 + 64)
  padded.set(msg)
  padded[len] = 0x80
  const bits = len * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true)
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  for (let off = 0; off < padded.length; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => view.getUint32(off + i * 4, true))
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const tmp = d
      d = c
      c = b
      const sum = (a + f + K[i] + M[g]) >>> 0
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true))
  return toHex(new Uint8Array(out.buffer))
}

/** Percent-encoding de RFC 3986 (el que piden OAuth 1.0 y AWS). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
