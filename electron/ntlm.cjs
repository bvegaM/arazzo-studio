// NTLM (v2) desde el proceso principal. Es un intercambio en tres pasos que tiene que ocurrir en la
// misma conexión TCP: Negotiate → Challenge del servidor → Authenticate. Por eso no se puede hacer
// con fetch ni desde el navegador: se usa http/https de Node con un agente de una sola conexión.
const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const md4 = require('js-md4')

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1')
const FLAGS =
  0x00000001 | // UNICODE
  0x00000200 | // NTLM
  0x00008000 | // ALWAYS_SIGN
  0x00080000 | // EXTENDED_SESSIONSECURITY
  0x00800000 | // TARGET_INFO
  0x20000000 | // 128
  0x80000000 // 56
const REQUEST_TARGET = 0x00000004

const utf16 = (s) => Buffer.from(String(s ?? ''), 'utf16le')
const hmacMd5 = (key, ...parts) => {
  const h = crypto.createHmac('md5', key)
  for (const p of parts) h.update(p)
  return h.digest()
}

/** Mensaje 1 (Negotiate), en base64. */
function negotiateMessage() {
  const b = Buffer.alloc(32)
  SIGNATURE.copy(b, 0)
  b.writeUInt32LE(1, 8)
  b.writeUInt32LE((FLAGS | REQUEST_TARGET) >>> 0, 12)
  return b.toString('base64')
}

/** Lee el mensaje 2 (Challenge): el desafío del servidor y su target info. */
function parseChallenge(base64) {
  const b = Buffer.from(base64, 'base64')
  if (b.length < 32 || !b.subarray(0, 8).equals(SIGNATURE) || b.readUInt32LE(8) !== 2) throw new Error('Respuesta NTLM inválida del servidor.')
  const flags = b.readUInt32LE(20)
  const challenge = b.subarray(24, 32)
  let targetInfo = Buffer.alloc(0)
  if (b.length >= 48) {
    const len = b.readUInt16LE(40)
    const offset = b.readUInt32LE(44)
    if (len && offset + len <= b.length) targetInfo = b.subarray(offset, offset + len)
  }
  return { flags, challenge, targetInfo }
}

/** Hora de Windows (centésimas de microsegundo desde 1601), en 8 bytes little-endian. */
function windowsTime(ms = Date.now()) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE((BigInt(ms) + 11644473600000n) * 10000n)
  return b
}

/** Las respuestas NTLMv2 (MS-NLMP 3.3.2). Exportada para probarla con los vectores de la especificación. */
function ntlmV2Responses({ username, password, domain, serverChallenge, clientChallenge, timestamp, targetInfo }) {
  const ntHash = Buffer.from(md4.arrayBuffer(utf16(password)))
  const ntowf = hmacMd5(ntHash, utf16(String(username).toUpperCase() + (domain ?? '')))
  const blob = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), timestamp, clientChallenge, Buffer.alloc(4), targetInfo, Buffer.alloc(4)])
  const ntProof = hmacMd5(ntowf, serverChallenge, blob)
  const lm = Buffer.concat([hmacMd5(ntowf, serverChallenge, clientChallenge), clientChallenge])
  return { ntowf, ntProof, nt: Buffer.concat([ntProof, blob]), lm }
}

/** Mensaje 3 (Authenticate), en base64. */
function authenticateMessage(challengeB64, { username, password, domain, workstation }) {
  const ch = parseChallenge(challengeB64)
  const targetInfo = ch.targetInfo
  // Si el servidor manda su hora (MsvAvTimestamp), se usa esa.
  let timestamp = windowsTime()
  for (let i = 0; i + 4 <= targetInfo.length; ) {
    const id = targetInfo.readUInt16LE(i)
    const len = targetInfo.readUInt16LE(i + 2)
    if (id === 0) break
    if (id === 7 && len === 8) timestamp = targetInfo.subarray(i + 4, i + 12)
    i += 4 + len
  }
  const r = ntlmV2Responses({ username, password, domain, serverChallenge: ch.challenge, clientChallenge: crypto.randomBytes(8), timestamp, targetInfo })
  const fields = [r.lm, r.nt, utf16(domain), utf16(username), utf16(workstation ?? ''), Buffer.alloc(0)]
  const headerLen = 64
  const header = Buffer.alloc(headerLen)
  SIGNATURE.copy(header, 0)
  header.writeUInt32LE(3, 8)
  let offset = headerLen
  fields.forEach((f, i) => {
    const at = 12 + i * 8
    header.writeUInt16LE(f.length, at)
    header.writeUInt16LE(f.length, at + 2)
    header.writeUInt32LE(offset, at + 4)
    offset += f.length
  })
  header.writeUInt32LE((FLAGS & ch.flags) >>> 0 || FLAGS >>> 0, 60)
  return Buffer.concat([header, ...fields]).toString('base64')
}

/** Un request a una URL usando un agente (y por lo tanto una conexión) dado. */
function send(url, { method, headers, body }, agent) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, { method, headers, agent }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: res.headers, bodyText: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const ntlmChallengeOf = (headers) => {
  const raw = headers['www-authenticate']
  const values = Array.isArray(raw) ? raw : raw ? String(raw).split(/,(?=\s*\w+\s)/) : []
  for (const v of values) {
    const m = /^\s*NTLM\s+([A-Za-z0-9+/=]+)\s*$/i.exec(v)
    if (m) return m[1]
  }
  return undefined
}

const flatHeaders = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v)]))

/** Hace el request completo con NTLM. Resuelve siempre (los errores en `error`). */
async function request(req) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const u = new URL(req.url)
  const Agent = u.protocol === 'https:' ? https.Agent : http.Agent
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  try {
    const base = Object.fromEntries(Object.entries(req.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'))
    const first = await send(req.url, { method: req.method, headers: { ...base, Authorization: `NTLM ${negotiateMessage()}`, 'Content-Length': '0' } }, agent)
    const challenge = ntlmChallengeOf(first.headers)
    if (first.status !== 401 || !challenge) {
      return { ok: true, ...first, headers: flatHeaders(first.headers), durationMs: elapsed(), note: first.status === 401 ? 'El servidor no ofrece NTLM.' : undefined }
    }
    const auth = authenticateMessage(challenge, req)
    const final = await send(req.url, { method: req.method, headers: { ...base, Authorization: `NTLM ${auth}` }, body: req.body }, agent)
    return { ok: true, ...final, headers: flatHeaders(final.headers), durationMs: elapsed() }
  } catch (e) {
    return { ok: false, error: e?.code ?? e?.message ?? String(e), durationMs: elapsed() }
  } finally {
    agent.destroy()
  }
}

module.exports = { request, negotiateMessage, parseChallenge, authenticateMessage, ntlmV2Responses }
