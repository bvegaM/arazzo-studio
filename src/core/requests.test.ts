import { describe, expect, it } from 'vitest'
import { CurlParseError, nameFromUrl, parseCurl, shellWords } from './curlImport'
import { buildHttpRequest, newRequest, parseRequest, requestPath, resolveRequest, serializeRequest, splitQuery, urlWithParams, type SavedRequest } from './requests'
import { isCollectionContentPath } from './workspaceFormat'

describe('requests de una colección', () => {
  it('rutas sin pisar otras y fuera del contenido de la colección', () => {
    expect(requestPath('Obtener Pikachu', [])).toBe('requests/obtener-pikachu.request.yaml')
    expect(requestPath('Obtener Pikachu', ['requests/obtener-pikachu.request.yaml'])).toBe('requests/obtener-pikachu-2.request.yaml')
    expect(isCollectionContentPath('requests/obtener-pikachu.request.yaml')).toBe(false)
  })

  it('se guarda y se vuelve a leer igual (todos los tipos)', () => {
    for (const kind of ['http', 'graphql', 'grpc', 'websocket'] as const) {
      const r = newRequest(kind, `Mi ${kind}`, [])
      const back = parseRequest(r.path, serializeRequest(r))
      expect(back, kind).toEqual(r)
    }
  })

  it('el archivo queda limpio: sin filas vacías ni campos que no aplican', () => {
    const r: SavedRequest = {
      ...newRequest('http', 'Crear', []),
      method: 'POST',
      url: '{{baseUrl}}/pokemon',
      headers: [
        { key: 'X-Trace', value: '1', enabled: false },
        { key: '', value: '', enabled: true },
      ],
      auth: { type: 'bearer', token: '{{token}}' },
      body: { mode: 'json', text: '{\n  "name": "pikachu"\n}' },
    }
    const yaml = serializeRequest(r)
    expect(yaml).toContain('enabled: false')
    expect(yaml).not.toContain("key: ''")
    expect(yaml).toContain('token: "{{token}}"')
    expect(yaml).not.toContain('query:')
    expect(parseRequest(r.path, yaml)).toMatchObject({ method: 'POST', headers: [{ key: 'X-Trace', enabled: false }], body: { mode: 'json' } })
  })

  it('un YAML que no es request se ignora', () => {
    expect(parseRequest('requests/x.request.yaml', 'openapi: 3.0.0')).toBeUndefined()
    expect(parseRequest('requests/x.request.yaml', ': : :')).toBeUndefined()
  })

  it('params, auth y body con variables del ambiente', () => {
    const r: SavedRequest = {
      ...newRequest('http', 'x', []),
      method: 'post',
      url: '{{base}}/items?sort=asc',
      params: [
        { key: 'q', value: 'a b', enabled: true },
        { key: 'off', value: '1', enabled: false },
      ],
      auth: { type: 'apikey', key: 'api_key', value: '{{key}}', in: 'query' },
      body: { mode: 'urlencoded', form: [{ key: 'name', value: 'Ash K', enabled: true }] },
    }
    const req = buildHttpRequest(resolveRequest(r, { base: 'https://api.test', key: 's3cr3t' }))
    expect(req).toEqual({
      method: 'POST',
      url: 'https://api.test/items?sort=asc&q=a%20b&api_key=s3cr3t',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=Ash+K',
    })
    const basic = buildHttpRequest({ ...newRequest('http', 'b', []), url: 'api.test', auth: { type: 'basic', username: 'ash', password: 'ñ' } })
    expect(basic.url).toBe('http://api.test')
    expect(basic.headers.Authorization).toBe(`Basic ${btoa(unescape(encodeURIComponent('ash:ñ')))}`)
    expect(basic.body).toBeUndefined()
  })

  it('GraphQL viaja como JSON con query y variables', () => {
    const r: SavedRequest = { ...newRequest('graphql', 'g', []), url: 'https://api.test/graphql', query: 'query($id: ID!) { pokemon(id: $id) { name } }', variables: '{"id": 25}' }
    const req = buildHttpRequest(r)
    expect(req.method).toBe('POST')
    expect(req.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(req.body!)).toEqual({ query: r.query, variables: { id: 25 } })
    expect(() => buildHttpRequest({ ...r, variables: '{oops' })).toThrow('variables')
  })

  it('multipart con campos de texto', () => {
    const req = buildHttpRequest({ ...newRequest('http', 'f', []), method: 'POST', url: 'https://x', body: { mode: 'formdata', form: [{ key: 'a', value: '1', enabled: true }] } })
    const boundary = req.headers['Content-Type'].split('boundary=')[1]
    expect(req.body).toBe(`--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${boundary}--\r\n`)
  })

  it('query de la URL en filas y de vuelta', () => {
    expect(splitQuery('https://x/a?b=1&c=hola%20mundo')).toEqual({
      base: 'https://x/a',
      params: [
        { key: 'b', value: '1', enabled: true },
        { key: 'c', value: 'hola mundo', enabled: true },
      ],
    })
    expect(urlWithParams('https://x/a#top', [{ key: 'b', value: '1', enabled: true }])).toBe('https://x/a?b=1#top')
  })
})

describe('importar desde cURL', () => {
  it('separa palabras como un shell', () => {
    expect(shellWords(`curl -H 'A: b c' "x\\"y" $'l1\\nl2' \\\n  --compressed`)).toEqual(['curl', '-H', 'A: b c', 'x"y', 'l1\nl2', '--compressed'])
  })

  it('el cURL que copia Chrome', () => {
    const r = parseCurl(`curl 'https://pokeapi.co/api/v2/pokemon?limit=5' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  --compressed`)
    expect(r).toMatchObject({
      method: 'GET',
      url: 'https://pokeapi.co/api/v2/pokemon',
      params: [{ key: 'limit', value: '5', enabled: true }],
      headers: [{ key: 'accept', value: 'application/json', enabled: true }],
      auth: { type: 'bearer', token: 'abc.def' },
      body: { mode: 'none' },
    })
  })

  it('POST con JSON, -XPUT pegado, --data-urlencode, -u y -F', () => {
    expect(parseCurl(`curl -XPUT https://x/a -H "Content-Type: application/json" -d '{"a":1}'`)).toMatchObject({ method: 'PUT', body: { mode: 'json', text: '{\n  "a": 1\n}' } })
    expect(parseCurl(`curl https://x/a --data-urlencode 'q=hola mundo' -d b=2`)).toMatchObject({
      method: 'POST',
      body: { mode: 'urlencoded', form: [{ key: 'q', value: 'hola mundo' }, { key: 'b', value: '2' }] },
    })
    expect(parseCurl(`curl -u ash:pika https://x`)).toMatchObject({ auth: { type: 'basic', username: 'ash', password: 'pika' } })
    expect(parseCurl(`curl -F name=Ash -F team=red https://x/upload`)).toMatchObject({ method: 'POST', body: { mode: 'formdata', form: [{ key: 'name' }, { key: 'team' }] } })
    expect(parseCurl(`curl -G https://x/s -d q=pika`)).toMatchObject({ method: 'GET', params: [{ key: 'q', value: 'pika' }], body: { mode: 'none' } })
    expect(parseCurl(`curl --json '{"a":1}' --url=https://x`)).toMatchObject({ method: 'POST', url: 'https://x', body: { mode: 'json' } })
  })

  it('errores claros y nombre sugerido', () => {
    expect(() => parseCurl('wget https://x')).toThrow(CurlParseError)
    expect(() => parseCurl('curl -H "a: b"')).toThrow('no-url')
    expect(nameFromUrl('GET', 'https://pokeapi.co/api/v2/pokemon/25')).toBe('GET 25')
    expect(nameFromUrl('POST', 'api.test')).toBe('POST api.test')
  })
})

describe('autorización: secretos fuera del archivo y herencia', () => {
  it('un secreto escrito tal cual no va al YAML; una {{variable}} sí', async () => {
    const { splitAuthSecrets, withAuthSecrets, effectiveAuth } = await import('./requests')
    const r: SavedRequest = { ...newRequest('http', 'x', []), auth: { type: 'bearer', token: 'tok-super-secreto' } }
    const yaml = serializeRequest(r)
    expect(yaml).not.toContain('tok-super-secreto')
    expect(yaml).toContain('type: bearer')
    const { secrets } = splitAuthSecrets(r.auth)
    expect(secrets).toEqual({ token: 'tok-super-secreto' })
    expect(withAuthSecrets(parseRequest(r.path, yaml)!.auth, secrets)).toEqual(r.auth)
    expect(serializeRequest({ ...r, auth: { type: 'bearer', token: '{{token}}' } })).toContain('{{token}}')
    const oauth = serializeRequest({ ...r, auth: { type: 'oauth2', clientId: 'app', clientSecret: 's3cr3t', accessTokenUrl: 'https://a/token' } })
    expect(oauth).toContain('clientId: app')
    expect(oauth).not.toContain('s3cr3t')
    // Heredar: la de la colección; si la colección no tiene, ninguna.
    const inherit = { ...r, auth: { type: 'inherit' as const } }
    expect(effectiveAuth(inherit, { type: 'basic', username: 'a' })).toEqual({ type: 'basic', username: 'a' })
    expect(effectiveAuth(inherit, undefined)).toEqual({ type: 'none' })
    expect(newRequest('http', 'n', []).auth).toEqual({ type: 'inherit' })
  })
})

describe('OAuth 2.0', () => {
  it('pide el token según el grant y lo aplica', async () => {
    const { tokenRequest, parseTokenResponse, applyToken, tokenValid, authorizationUrl, readCallback, pkcePair } = await import('./auth/oauth2')
    const cc = tokenRequest({ grantType: 'client_credentials', accessTokenUrl: 'https://a/token', clientId: 'app', clientSecret: 'sec', scope: 'read' })
    expect(cc.headers.Authorization).toBe(`Basic ${btoa('app:sec')}`)
    expect(Object.fromEntries(new URLSearchParams(cc.body))).toEqual({ grant_type: 'client_credentials', scope: 'read' })
    const pw = tokenRequest({ grantType: 'password', accessTokenUrl: 'https://a/token', clientId: 'app', username: 'ash', password: 'pika', credentialsIn: 'body' })
    expect(Object.fromEntries(new URLSearchParams(pw.body))).toEqual({ grant_type: 'password', username: 'ash', password: 'pika', client_id: 'app' })
    const tok = parseTokenResponse({ status: 200, statusText: 'OK', headers: {}, bodyText: '{"access_token":"abc","expires_in":60,"refresh_token":"r"}', durationMs: 1 }, 1000)
    expect(tok).toMatchObject({ accessToken: 'abc', expiresAt: 61000, refreshToken: 'r' })
    expect(tokenValid(tok, 2000)).toBe(true)
    expect(tokenValid(tok, 60000)).toBe(false)
    expect(() => parseTokenResponse({ status: 401, statusText: '', headers: {}, bodyText: '{"error":"invalid_client"}', durationMs: 1 })).toThrow('invalid_client')
    expect(applyToken({ method: 'GET', url: 'https://x', headers: {} }, tok, { grantType: 'password', accessTokenUrl: '', clientId: '' }).headers.Authorization).toBe('Bearer abc')
    expect(applyToken({ method: 'GET', url: 'https://x/a', headers: {} }, tok, { grantType: 'password', accessTokenUrl: '', clientId: '', tokenIn: 'query' }).url).toBe('https://x/a?access_token=abc')
    // Authorization code con PKCE: la URL, el state y el código de vuelta.
    const { verifier, challenge } = await pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const url = new URL(authorizationUrl({ grantType: 'authorization_code', accessTokenUrl: '', authorizationUrl: 'https://a/authorize', clientId: 'app', callbackUrl: 'https://cb', scope: 'openid' }, 'st', challenge))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: 'app', redirect_uri: 'https://cb', state: 'st', code_challenge: challenge, code_challenge_method: 'S256' })
    expect(readCallback('https://cb/?code=xyz&state=st', 'st')).toEqual({ code: 'xyz' })
    expect(readCallback('https://cb/?code=xyz&state=otro', 'st')).toEqual({ error: 'state' })
    expect(readCallback('https://cb/?error=access_denied', 'st')).toEqual({ error: 'access_denied' })
    const code = tokenRequest({ grantType: 'authorization_code', accessTokenUrl: 'https://a/token', clientId: 'app', callbackUrl: 'https://cb' }, { code: 'xyz', verifier })
    expect(Object.fromEntries(new URLSearchParams(code.body))).toEqual({ grant_type: 'authorization_code', code: 'xyz', redirect_uri: 'https://cb', code_verifier: verifier, client_id: 'app' })
  })
})
