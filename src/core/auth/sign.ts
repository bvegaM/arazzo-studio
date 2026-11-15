// Firmas de autenticación que se calculan sobre el request ya armado (URL, headers y body finales):
// AWS Signature v4, OAuth 1.0, WSSE, Akamai EdgeGrid y Digest. Las fechas y los nonces se pueden
// fijar para que las pruebas usen los ejemplos de cada especificación.
import type { HttpRequest } from '../http'
import { hmac, md5, randomHex, rfc3986, sha, toBase64, toHex, utf8 } from './crypto'

const header = (req: HttpRequest, name: string) => Object.entries(req.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
const withHeader = (req: HttpRequest, name: string, value: string): HttpRequest => {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== name.toLowerCase()))
  return { ...req, headers: { ...headers, [name]: value } }
}

// --- AWS Signature Version 4 ---

export interface AwsV4Options {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  service: string
}

const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Codifica cada segmento de la ruta (S3 no se codifica dos veces). */
function canonicalPath(pathname: string, service: string): string {
  if (!pathname) return '/'
  if (service === 's3') return pathname
  return pathname
    .split('/')
    .map((seg) => rfc3986(decodeURIComponentSafe(seg)))
    .join('/')
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export async function signAwsV4(req: HttpRequest, o: AwsV4Options, now = new Date()): Promise<HttpRequest> {
  const url = new URL(req.url)
  const date = amzDate(now)
  const day = date.slice(0, 8)
  const payloadHash = toHex(await sha('SHA-256', req.body ?? ''))
  let out = withHeader(req, 'X-Amz-Date', date)
  if (o.sessionToken) out = withHeader(out, 'X-Amz-Security-Token', o.sessionToken)
  if (o.service === 's3') out = withHeader(out, 'X-Amz-Content-Sha256', payloadHash)
  // Se firman host, content-type y todos los x-amz-*.
  const signed: [string, string][] = [['host', url.host]]
  for (const [k, v] of Object.entries(out.headers)) {
    const name = k.toLowerCase()
    if (name === 'content-type' || name.startsWith('x-amz-')) signed.push([name, v.trim().replace(/\s+/g, ' ')])
  }
  signed.sort(([a], [b]) => (a < b ? -1 : 1))
  const signedHeaders = signed.map(([k]) => k).join(';')
  const canonical = [req.method.toUpperCase(), canonicalPath(url.pathname, o.service), canonicalQuery(url.searchParams), signed.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, payloadHash].join('\n')
  const scope = `${day}/${o.region}/${o.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', date, scope, toHex(await sha('SHA-256', canonical))].join('\n')
  let key = await hmac('SHA-256', `AWS4${o.secretAccessKey}`, day)
  for (const part of [o.region, o.service, 'aws4_request']) key = await hmac('SHA-256', key, part)
  const signature = toHex(await hmac('SHA-256', key, toSign))
  return withHeader(out, 'Authorization', `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`)
}

// --- OAuth 1.0a (RFC 5849) ---

export interface OAuth1Options {
  consumerKey: string
  consumerSecret: string
  token?: string
  tokenSecret?: string
  signatureMethod: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT'
  realm?: string
  callback?: string
  verifier?: string
  /** Dónde van los parámetros oauth_*: header Authorization (por defecto) o query. */
  addTo?: 'header' | 'query'
}

export async function signOAuth1(req: HttpRequest, o: OAuth1Options, fixed: { nonce?: string; timestamp?: string } = {}): Promise<HttpRequest> {
  const url = new URL(req.url)
  const oauth: Record<string, string> = {
    oauth_consumer_key: o.consumerKey,
    oauth_nonce: fixed.nonce ?? randomHex(16),
    oauth_signature_method: o.signatureMethod,
    oauth_timestamp: fixed.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  }
  if (o.token) oauth.oauth_token = o.token
  if (o.callback) oauth.oauth_callback = o.callback
  if (o.verifier) oauth.oauth_verifier = o.verifier
  // La firma incluye la query y, si el body es un formulario, sus campos.
  const params: [string, string][] = [...url.searchParams.entries(), ...Object.entries(oauth)]
  if (req.body && /application\/x-www-form-urlencoded/i.test(header(req, 'content-type') ?? '')) params.push(...new URLSearchParams(req.body).entries())
  const normalized = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`
  const base = [req.method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join('&')
  const key = `${rfc3986(o.consumerSecret)}&${rfc3986(o.tokenSecret ?? '')}`
  oauth.oauth_signature =
    o.signatureMethod === 'PLAINTEXT' ? key : toBase64(await hmac(o.signatureMethod === 'HMAC-SHA256' ? 'SHA-256' : 'SHA-1', key, base))
  if (o.addTo === 'query') {
    for (const [k, v] of Object.entries(oauth)) url.searchParams.set(k, v)
    return { ...req, url: url.toString() }
  }
  const fields = Object.entries(oauth).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
  return withHeader(req, 'Authorization', `OAuth ${o.realm ? `realm="${o.realm}", ` : ''}${fields.join(', ')}`)
}

// --- WSSE UsernameToken ---

export async function wsseHeader(username: string, password: string, fixed: { nonce?: string; created?: string } = {}): Promise<string> {
  const nonce = fixed.nonce ?? randomHex(16)
  const created = fixed.created ?? new Date().toISOString()
  const digest = toBase64(await sha('SHA-1', nonce + created + password))
  return `UsernameToken Username="${username}", PasswordDigest="${digest}", Nonce="${toBase64(utf8(nonce))}", Created="${created}"`
}

export async function signWsse(req: HttpRequest, username: string, password: string, fixed?: { nonce?: string; created?: string }): Promise<HttpRequest> {
  return withHeader(withHeader(req, 'X-WSSE', await wsseHeader(username, password, fixed)), 'Authorization', 'WSSE profile="UsernameToken"')
}

// --- Akamai EdgeGrid (EG1-HMAC-SHA256) ---

export interface AkamaiOptions {
  clientToken: string
  accessToken: string
  clientSecret: string
  /** Headers que entran en la firma (separados por coma). */
  headersToSign?: string
  maxBodySize?: number
}

const akamaiTimestamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '+0000').replace(/^(\d{8}T\d{2})(\d{2})(\d{2})/, '$1:$2:$3')

export async function signAkamai(req: HttpRequest, o: AkamaiOptions, fixed: { nonce?: string; timestamp?: string } = {}): Promise<HttpRequest> {
  const url = new URL(req.url)
  const timestamp = fixed.timestamp ?? akamaiTimestamp(new Date())
  const nonce = fixed.nonce ?? crypto.randomUUID()
  const prefix = `EG1-HMAC-SHA256 client_token=${o.clientToken};access_token=${o.accessToken};timestamp=${timestamp};nonce=${nonce};`
  const wanted = (o.headersToSign ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const canonicalHeaders = wanted
    .map((name) => [name, header(req, name)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([name, v]) => `${name}:${v!.trim().replace(/\s+/g, ' ')}`)
    .join('\t')
  const body = req.method.toUpperCase() === 'POST' && req.body ? req.body.slice(0, o.maxBodySize ?? 131072) : ''
  const contentHash = body ? toBase64(await sha('SHA-256', body)) : ''
  const data = [req.method.toUpperCase(), url.protocol.replace(':', ''), url.host, `${url.pathname}${url.search}`, canonicalHeaders, contentHash, prefix].join('\t')
  const signingKey = toBase64(await hmac('SHA-256', o.clientSecret, timestamp))
  const signature = toBase64(await hmac('SHA-256', signingKey, data))
  return withHeader(req, 'Authorization', `${prefix}signature=${signature}`)
}

// --- Digest (RFC 7616 / RFC 2617) ---

export interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string
  opaque?: string
  algorithm?: string
}

/** Lee el desafío de un `WWW-Authenticate: Digest …`; undefined si no es Digest. */
export function parseDigestChallenge(value: string | undefined): DigestChallenge | undefined {
  if (!value || !/^\s*digest\s/i.test(value)) return undefined
  const fields: Record<string, string> = {}
  for (const m of value.replace(/^\s*digest\s+/i, '').matchAll(/([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/gi)) fields[m[1].toLowerCase()] = m[2] ?? m[3]
  if (!fields.nonce) return undefined
  return { realm: fields.realm ?? '', nonce: fields.nonce, qop: fields.qop, opaque: fields.opaque, algorithm: fields.algorithm }
}

export async function digestAuthorization(
  c: DigestChallenge,
  o: { username: string; password: string; method: string; uri: string; body?: string },
  fixed: { cnonce?: string; nc?: string } = {},
): Promise<string> {
  const alg = (c.algorithm ?? 'MD5').toUpperCase()
  const sha256 = alg.startsWith('SHA-256')
  const H = async (s: string) => (sha256 ? toHex(await sha('SHA-256', s)) : md5(s))
  const cnonce = fixed.cnonce ?? randomHex(8)
  const nc = fixed.nc ?? '00000001'
  // qop puede ofrecer varias opciones ("auth,auth-int"): se prefiere auth.
  const offered = c.qop?.split(',').map((q) => q.trim().toLowerCase()) ?? []
  const qop = offered.includes('auth') ? 'auth' : offered.includes('auth-int') ? 'auth-int' : undefined
  let ha1 = await H(`${o.username}:${c.realm}:${o.password}`)
  if (alg.endsWith('-SESS')) ha1 = await H(`${ha1}:${c.nonce}:${cnonce}`)
  const ha2 = await H(qop === 'auth-int' ? `${o.method}:${o.uri}:${await H(o.body ?? '')}` : `${o.method}:${o.uri}`)
  const response = await H(qop ? `${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}` : `${ha1}:${c.nonce}:${ha2}`)
  const parts = [`username="${o.username}"`, `realm="${c.realm}"`, `nonce="${c.nonce}"`, `uri="${o.uri}"`, ...(c.algorithm ? [`algorithm=${c.algorithm}`] : [])]
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  parts.push(`response="${response}"`)
  if (c.opaque !== undefined) parts.push(`opaque="${c.opaque}"`)
  return `Digest ${parts.join(', ')}`
}
