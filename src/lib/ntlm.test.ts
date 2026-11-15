// NTLM vive en el proceso principal de escritorio (electron/ntlm.cjs); se prueba con los vectores de
// la especificación y contra un servidor local que exige el intercambio en una sola conexión.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const require = createRequire(import.meta.url)
const ntlm = require('../../electron/ntlm.cjs')

const hex = (s: string) => Buffer.from(s.replace(/\s/g, ''), 'hex')
const utf16 = (s: string) => Buffer.from(s, 'utf16le')
const avPair = (id: number, value: Buffer) => {
  const h = Buffer.alloc(4)
  h.writeUInt16LE(id, 0)
  h.writeUInt16LE(value.length, 2)
  return Buffer.concat([h, value])
}
const TARGET_INFO = Buffer.concat([avPair(2, utf16('Domain')), avPair(1, utf16('Server')), Buffer.alloc(4)])

describe('NTLMv2', () => {
  it('los vectores de MS-NLMP 4.2.4', () => {
    const r = ntlm.ntlmV2Responses({
      username: 'User',
      password: 'Password',
      domain: 'Domain',
      serverChallenge: hex('0123456789abcdef'),
      clientChallenge: hex('aaaaaaaaaaaaaaaa'),
      timestamp: Buffer.alloc(8),
      targetInfo: TARGET_INFO,
    })
    expect(r.ntowf.toString('hex')).toBe('0c868a403bfd7a93a3001ef22ef02e3f')
    expect(r.ntProof.toString('hex')).toBe('68cd0ab851e51c96aabc927bebef6a1c')
    expect(r.lm.toString('hex')).toBe('86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa')
  })

  describe('contra un servidor que pide NTLM', () => {
    let server: http.Server
    let url = ''
    beforeAll(async () => {
      // Desafío del servidor por conexión: el Authenticate debe llegar por la misma.
      const challenges = new WeakMap<object, Buffer>()
      server = http.createServer((req, res) => {
        const auth = req.headers.authorization ?? ''
        const deny = (extra?: string) => {
          res.writeHead(401, { 'WWW-Authenticate': extra ?? 'NTLM' })
          res.end()
        }
        if (!auth.startsWith('NTLM ')) return deny()
        const msg = Buffer.from(auth.slice(5), 'base64')
        const type = msg.readUInt32LE(8)
        if (type === 1) {
          const challenge = hex('0123456789abcdef')
          challenges.set(req.socket, challenge)
          const head = Buffer.alloc(48)
          head.write('NTLMSSP\0', 0, 'latin1')
          head.writeUInt32LE(2, 8)
          head.writeUInt32LE(0xa2898205, 20)
          challenge.copy(head, 24)
          head.writeUInt16LE(TARGET_INFO.length, 40)
          head.writeUInt16LE(TARGET_INFO.length, 42)
          head.writeUInt32LE(48, 44)
          return deny(`NTLM ${Buffer.concat([head, TARGET_INFO]).toString('base64')}`)
        }
        const challenge = challenges.get(req.socket)
        if (type !== 3 || !challenge) return deny()
        const field = (i: number) => msg.subarray(msg.readUInt32LE(16 + i * 8), msg.readUInt32LE(16 + i * 8) + msg.readUInt16LE(12 + i * 8))
        const nt = field(1)
        const user = field(3).toString('utf16le')
        const domain = field(2).toString('utf16le')
        const blob = nt.subarray(16)
        const expected = ntlm.ntlmV2Responses({
          username: user,
          password: 'Pikachu25',
          domain,
          serverChallenge: challenge,
          clientChallenge: blob.subarray(16, 24),
          timestamp: blob.subarray(8, 16),
          targetInfo: blob.subarray(28, blob.length - 4),
        })
        if (!expected.ntProof.equals(nt.subarray(0, 16))) return deny()
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ user, domain, body }))
        })
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pokedex`
    })
    afterAll(() => new Promise<void>((r) => server.close(() => r())))

    it('se autentica y envía el body en el último paso', async () => {
      const res = await ntlm.request({ url, method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hola', username: 'ash', password: 'Pikachu25', domain: 'KANTO' })
      expect(res).toMatchObject({ ok: true, status: 200 })
      expect(JSON.parse(res.bodyText)).toEqual({ user: 'ash', domain: 'KANTO', body: 'hola' })
    })

    it('con la contraseña equivocada el servidor responde 401', async () => {
      const res = await ntlm.request({ url, method: 'GET', headers: {}, username: 'ash', password: 'otra', domain: 'KANTO' })
      expect(res).toMatchObject({ ok: true, status: 401 })
    })
  })
})
