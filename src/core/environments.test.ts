import { beforeAll, describe, expect, it } from 'vitest'
import { loadFaker } from './dynamicVars'
import { fillServers, newEnvironment, redactSecrets, secretValues, uniqueName, variableValues } from './environments'
import { dynamicHelp, resolveTemplates, unknownTemplates } from './templates'

describe('ambientes', () => {
  it('crea ambientes con id propio, copiando URLs y sin credenciales', () => {
    const a = newEnvironment('QA', { api: 'https://qa' })
    const b = newEnvironment('QA', a.servers)
    expect(a.id).not.toBe(b.id)
    expect(b).toMatchObject({ name: 'QA', servers: { api: 'https://qa' }, credentials: {} })
    expect(b.servers).not.toBe(a.servers)
  })

  it('genera nombres sin repetir', () => {
    expect(uniqueName('QA', ['DEV'])).toBe('QA')
    expect(uniqueName('QA', ['qa', 'QA 2'])).toBe('QA 3')
  })

  it('completa URLs faltantes sin pisar las del usuario', () => {
    const env = { ...newEnvironment('DEV'), servers: { api: 'http://mio' } }
    const [filled] = fillServers([env], { api: 'https://contrato', otra: 'https://otra' })
    expect(filled.servers).toEqual({ api: 'http://mio', otra: 'https://otra' })
    expect(fillServers([filled], { api: 'x' })[0]).toBe(filled)
  })
})

describe('variables y secretos de un ambiente', () => {
  const env = {
    credentials: { 'members:bearerAuth': '{{token}}' },
    variables: [
      { name: 'clientId', value: 'cli-123', secret: false },
      { name: 'token', value: 'tok-super-secreto', secret: true },
      { name: 'email', value: 'fijo@example.com', secret: false },
      { name: 'mal nombre', value: 'x', secret: false },
    ],
  }

  it('resuelve {{variable}} antes que los generadores y deja lo desconocido', () => {
    const vars = variableValues(env)
    expect(vars['mal nombre']).toBeUndefined()
    expect(resolveTemplates({ a: '{{clientId}}', b: 'id-{{ clientId }}', c: '{{email}}', d: '{{otra}}', e: '{{uuid}}' }, vars)).toMatchObject({
      a: 'cli-123',
      b: 'id-cli-123',
      c: 'fijo@example.com',
      d: '{{otra}}',
    })
    expect(unknownTemplates('{{clientId}} {{otra}} {{uuid}}', vars)).toEqual(['otra'])
  })

  it('al crear un ambiente copia las variables y solo el nombre de los secretos', () => {
    const copy = newEnvironment('prod', { members: 'https://api' }, env.variables)
    expect(copy.variables.find((v) => v.name === 'clientId')?.value).toBe('cli-123')
    expect(copy.variables.find((v) => v.name === 'token')).toEqual({ name: 'token', value: '', secret: true })
  })

  it('oculta los secretos en cualquier parte de un valor', () => {
    const secrets = secretValues({ variables: env.variables, credentials: { x: 'tok-super-secreto', y: 'ab' } })
    expect(secrets).toEqual(['tok-super-secreto'])
    expect(redactSecrets({ url: 'https://x?k=tok-super-secreto', list: ['Bearer tok-super-secreto'] }, secrets)).toEqual({
      url: 'https://x?k=••••',
      list: ['Bearer ••••'],
    })
  })
})

describe('variables dinámicas (como Postman y Bruno)', () => {
  beforeAll(() => loadFaker())
  it('genera un valor nuevo en cada aparición', () => {
    const out = resolveTemplates({
      id: '{{$randomUUID}}',
      guid: '{{$guid}}',
      email: '{{$randomEmail}}',
      ua: '{{$randomUserAgent}}',
      ip: '{{$randomIP}}',
      ts: '{{$timestamp}}',
      name: 'Hola {{$randomFirstName}} {{$randomLastName}}',
    })
    expect(out.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(out.guid).not.toBe(out.id)
    expect(out.email).toMatch(/^\S+@\S+\.\S+$/)
    // faker a veces da user agents cortos (p. ej. "Opera/9.80 …" recortado): basta con que haya uno.
    expect(out.ua.length).toBeGreaterThan(5)
    expect(out.ua).not.toContain('{{')
    expect(out.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(out.ts).toMatch(/^\d{10}$/)
    expect(out.name).toMatch(/^Hola \S+ \S+/)
    expect(out.name).not.toContain('{{')
  })

  it('una variable del ambiente no tapa a las dinámicas y lo desconocido se avisa', () => {
    expect(resolveTemplates('{{$noExiste}}')).toBe('{{$noExiste}}')
    expect(unknownTemplates('{{$randomCity}} {{$noExiste}}')).toEqual(['$noExiste'])
    expect(resolveTemplates('{{$randomCity}}', { randomCity: 'fija' })).not.toBe('fija')
  })

  it('cada dinámica tiene descripción', () => {
    for (const d of dynamicHelp()) expect(d.description).not.toMatch(/^dyn\./)
  })
})
