// OAuth 2.0: pedir un access token (client credentials, password o authorization code con PKCE),
// refrescarlo y aplicarlo al request.
import type { HttpRequest, HttpResponse } from '../http'
import { randomHex, sha, toBase64, utf8 } from './crypto'

export type OAuth2Grant = 'client_credentials' | 'password' | 'authorization_code'

export interface OAuth2Config {
  grantType: OAuth2Grant
  accessTokenUrl: string
  authorizationUrl?: string
  callbackUrl?: string
  clientId: string
  clientSecret?: string
  scope?: string
  audience?: string
  username?: string
  password?: string
  /** PKCE (S256) en authorization code. */
  pkce?: boolean
  /** Cómo se envían client_id y client_secret al pedir el token. */
  credentialsIn?: 'header' | 'body'
  /** Dónde va el token en cada request. */
  tokenIn?: 'header' | 'query'
  headerPrefix?: string
}

export interface OAuth2Token {
  accessToken: string
  tokenType?: string
  /** Epoch en ms. */
  expiresAt?: number
  refreshToken?: string
  scope?: string
}

const base64Url = (b: Uint8Array) => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Par de PKCE: el verifier que se guarda y el challenge (S256) que va en la URL de autorización. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: base64Url(await sha('SHA-256', verifier)) }
}

export function authorizationUrl(c: OAuth2Config, state: string, challenge?: string): string {
  const url = new URL(c.authorizationUrl ?? '')
  const set = (k: string, v?: string) => v && url.searchParams.set(k, v)
  set('response_type', 'code')
  set('client_id', c.clientId)
  set('redirect_uri', c.callbackUrl)
  set('scope', c.scope)
  set('audience', c.audience)
  set('state', state)
  if (challenge) {
    set('code_challenge', challenge)
    set('code_challenge_method', 'S256')
  }
  return url.toString()
}

/** El código (o el error) que trae la URL de callback. */
export function readCallback(url: string, state: string): { code: string } | { error: string } {
  const u = new URL(url)
  const params = new URLSearchParams(u.search || u.hash.replace(/^#/, ''))
  if (params.get('error')) return { error: [params.get('error'), params.get('error_description')].filter(Boolean).join(': ') }
  if (params.get('state') !== state) return { error: 'state' }
  const code = params.get('code')
  return code ? { code } : { error: 'code' }
}

export const newState = () => randomHex(12)

/** El request al token endpoint para el grant del config (o para refrescar un token). */
export function tokenRequest(c: OAuth2Config, extra: { code?: string; verifier?: string; refreshToken?: string } = {}): HttpRequest {
  const body = new URLSearchParams()
  if (extra.refreshToken) {
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', extra.refreshToken)
  } else {
    body.set('grant_type', c.grantType)
    if (c.grantType === 'password') {
      body.set('username', c.username ?? '')
      body.set('password', c.password ?? '')
    }
    if (c.grantType === 'authorization_code') {
      body.set('code', extra.code ?? '')
      if (c.callbackUrl) body.set('redirect_uri', c.callbackUrl)
      if (extra.verifier) body.set('code_verifier', extra.verifier)
    }
  }
  if (c.scope && !extra.code) body.set('scope', c.scope)
  if (c.audience) body.set('audience', c.audience)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (c.credentialsIn === 'body' || !c.clientSecret) {
    body.set('client_id', c.clientId)
    if (c.clientSecret) body.set('client_secret', c.clientSecret)
  } else {
    let bin = ''
    for (const b of utf8(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`)) bin += String.fromCharCode(b)
    headers.Authorization = `Basic ${btoa(bin)}`
  }
  return { method: 'POST', url: c.accessTokenUrl, headers, body: body.toString() }
}

/** Lee la respuesta del token endpoint (JSON o form). Lanza un Error con el motivo si no hay token. */
export function parseTokenResponse(res: HttpResponse, now = Date.now()): OAuth2Token {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(res.bodyText)
  } catch {
    data = Object.fromEntries(new URLSearchParams(res.bodyText))
  }
  const access = data.access_token
  if (res.status >= 400 || typeof access !== 'string' || !access) {
    const reason = [data.error, data.error_description].filter(Boolean).join(': ')
    throw new Error(reason || `HTTP ${res.status}`)
  }
  const expiresIn = Number(data.expires_in)
  return {
    accessToken: access,
    ...(typeof data.token_type === 'string' ? { tokenType: data.token_type } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

/** true si el token sigue sirviendo (con 30 s de margen). */
export function tokenValid(t: OAuth2Token | undefined, now = Date.now()): t is OAuth2Token {
  return !!t && (t.expiresAt === undefined || t.expiresAt - 30_000 > now)
}

export function applyToken(req: HttpRequest, t: OAuth2Token, c: OAuth2Config): HttpRequest {
  if (c.tokenIn === 'query') {
    const url = new URL(req.url)
    url.searchParams.set('access_token', t.accessToken)
    return { ...req, url: url.toString() }
  }
  const prefix = c.headerPrefix ?? 'Bearer'
  return { ...req, headers: { ...req.headers, Authorization: prefix ? `${prefix} ${t.accessToken}` : t.accessToken } }
}
