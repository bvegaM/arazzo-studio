// Importar un comando cURL (el que copian Chrome, Postman o la documentación de una API) como un
// request HTTP de la colección.
import type { KeyValue, SavedRequest } from './requests'
import { splitQuery } from './requests'

/** Separa el comando en palabras como lo haría un shell: comillas simples, dobles, $'…' y \ al final de línea. */
export function shellWords(input: string): string[] {
  const words: string[] = []
  let current = ''
  let has = false
  let i = 0
  const s = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ')
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      if (has) words.push(current)
      current = ''
      has = false
      i++
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1)
      current += s.slice(i + 1, end < 0 ? undefined : end)
      has = true
      i = end < 0 ? s.length : end + 1
    } else if (c === '$' && s[i + 1] === "'") {
      // $'…' con escapes de C (\n, \t, \', \\).
      i += 2
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1]
          current += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n
          i += 2
        } else current += s[i++]
      }
      has = true
      i++
    } else if (c === '"') {
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) {
          current += s[i + 1]
          i += 2
        } else current += s[i++]
      }
      has = true
      i++
    } else if (c === '\\' && i + 1 < s.length) {
      current += s[i + 1]
      has = true
      i += 2
    } else {
      current += c
      has = true
      i++
    }
  }
  if (has) words.push(current)
  return words
}

export class CurlParseError extends Error {}

/** Opciones que llevan un valor a continuación (las que no se entienden se saltan con su valor). */
const WITH_VALUE = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json',
  '-u', '--user', '-F', '--form', '--form-string', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--url',
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '--retry', '-c', '--cookie-jar',
  '--cacert', '--cert', '--key', '-T', '--upload-file', '-r', '--range', '-K', '--config', '--resolve', '--limit-rate',
])

/**
 * Convierte un comando cURL en un request HTTP (sin nombre ni ruta: los pone quien lo guarda).
 * Lanza CurlParseError si no es un cURL o no trae URL.
 */
export function parseCurl(command: string): Omit<SavedRequest, 'path' | 'name'> {
  const words = shellWords(command.trim())
  if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) throw new CurlParseError('not-curl')
  let method: string | undefined
  let url: string | undefined
  let get = false
  const headers: KeyValue[] = []
  const data: string[] = []
  const form: KeyValue[] = []
  let json = false
  let user: string | undefined
  for (let i = 1; i < words.length; i++) {
    let w = words[i]
    let value: string | undefined
    // --opcion=valor
    const eq = /^(--[\w-]+)=(.*)$/s.exec(w)
    if (eq && WITH_VALUE.has(eq[1])) {
      w = eq[1]
      value = eq[2]
    } else if (/^-[A-Za-z]./.test(w) && WITH_VALUE.has(w.slice(0, 2)) && !w.startsWith('--')) {
      // -XPOST, -H'…'
      value = w.slice(2)
      w = w.slice(0, 2)
    }
    const next = () => value ?? words[++i] ?? ''
    switch (w) {
      case '-X':
      case '--request':
        method = next().toUpperCase()
        break
      case '-H':
      case '--header': {
        const h = next()
        const colon = h.indexOf(':')
        if (colon > 0) headers.push({ key: h.slice(0, colon).trim(), value: h.slice(colon + 1).trim(), enabled: true })
        break
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push(next())
        break
      case '--data-urlencode': {
        const v = next()
        const k = v.indexOf('=')
        data.push(k > 0 ? `${v.slice(0, k)}=${encodeURIComponent(v.slice(k + 1))}` : encodeURIComponent(v))
        break
      }
      case '--json':
        data.push(next())
        json = true
        break
      case '-F':
      case '--form':
      case '--form-string': {
        const v = next()
        const k = v.indexOf('=')
        if (k > 0) form.push({ key: v.slice(0, k), value: v.slice(k + 1), enabled: true })
        break
      }
      case '-u':
      case '--user':
        user = next()
        break
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: next(), enabled: true })
        break
      case '-e':
      case '--referer':
        headers.push({ key: 'Referer', value: next(), enabled: true })
        break
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: next(), enabled: true })
        break
      case '-I':
      case '--head':
        method = 'HEAD'
        break
      case '-G':
      case '--get':
        get = true
        break
      case '--url':
        url = next()
        break
      default:
        if (WITH_VALUE.has(w)) next()
        else if (!w.startsWith('-') && url === undefined) url = w
    }
  }
  if (!url) throw new CurlParseError('no-url')

  const header = (name: string) => headers.find((h) => h.key.toLowerCase() === name)
  if (json) {
    if (!header('content-type')) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
    if (!header('accept')) headers.push({ key: 'Accept', value: 'application/json', enabled: true })
  }
  let body: SavedRequest['body'] = { mode: 'none' }
  let { base, params } = splitQuery(url)
  if (get && data.length) {
    params = [...params, ...splitQuery(`?${data.join('&')}`).params]
  } else if (data.length) {
    const text = data.join('&')
    const type = header('content-type')?.value.toLowerCase() ?? ''
    const looksJson = /^\s*[[{]/.test(text)
    if (type.includes('json') || (!type && looksJson)) body = { mode: 'json', text: pretty(text) }
    else if (type.includes('xml')) body = { mode: 'xml', text }
    else if (type.includes('x-www-form-urlencoded') || (!type && /^[^=&\s]+=/.test(text))) body = { mode: 'urlencoded', form: splitQuery(`?${text}`).params }
    else body = { mode: 'text', text }
    // El Content-Type lo vuelve a poner el modo del body (urlencoded/json); se evita duplicarlo.
    if (body.mode === 'urlencoded' && /x-www-form-urlencoded/i.test(header('content-type')?.value ?? '')) headers.splice(headers.indexOf(header('content-type')!), 1)
  } else if (form.length) {
    body = { mode: 'formdata', form }
  }
  const finalMethod = method ?? (get ? 'GET' : data.length || form.length ? 'POST' : 'GET')
  let auth: SavedRequest['auth'] = { type: 'none' }
  const authHeader = header('authorization')
  if (user !== undefined) {
    const colon = user.indexOf(':')
    auth = { type: 'basic', username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? '' : user.slice(colon + 1) }
  } else if (authHeader && /^bearer\s+/i.test(authHeader.value)) {
    auth = { type: 'bearer', token: authHeader.value.replace(/^bearer\s+/i, '') }
    headers.splice(headers.indexOf(authHeader), 1)
  }
  return { kind: 'http', method: finalMethod, url: base, params, headers, auth, body }
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Un nombre razonable para el request importado: método y última parte de la ruta. */
export function nameFromUrl(method: string, url: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return `${method} ${last ?? u.host}`
  } catch {
    return method
  }
}
