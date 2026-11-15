import { describe, expect, it } from 'vitest'
import { analyzeProject } from './analyze'
import { emptyFlowAuth, journeyApis, parseFlowAuth, renameFlowFile, resolveFlowAuth, serializeFlowAuth, splitFlowAuthSecrets, withFlowAuthSecrets, type FlowAuth } from './flowAuth'
import type { HttpRequest, RequestMeta } from './http'
import { buildProject, parseFile } from './loader'
import { runWorkflow } from './runner'
import { setLocale } from '../i18n'

setLocale('es')

const J = 'pokedex.arazzo.yaml#capturar'
const COL = '#collection'

describe('autorización de los journeys: gana lo más específico', () => {
  it('journey + API → API → contrato (o la colección)', () => {
    const cfg: FlowAuth = { apis: { poke: { type: 'bearer', token: 'api' }, auth: { type: 'inherit' } }, journeys: { [J]: { poke: { type: 'basic', username: 'ash' } } } }
    expect(resolveFlowAuth(cfg, J, 'poke', { type: 'none' }, COL)).toMatchObject({ origin: 'journey', auth: { type: 'basic' }, tokenKey: `flow:${J}:poke` })
    expect(resolveFlowAuth(cfg, 'otro#x', 'poke', { type: 'none' }, COL)).toMatchObject({ origin: 'api', auth: { type: 'bearer' }, tokenKey: 'flow:api:poke' })
    expect(resolveFlowAuth(cfg, J, 'sin-config', { type: 'none' }, COL)).toEqual({ origin: 'contract' })
    // inherit a nivel API: la de la colección (si no tiene, sin autorización).
    expect(resolveFlowAuth(cfg, J, 'auth', { type: 'apikey', key: 'k' }, COL)).toMatchObject({ origin: 'collection', auth: { type: 'apikey' }, tokenKey: COL })
    expect(resolveFlowAuth(cfg, J, 'auth', { type: 'none' }, COL)).toEqual({ origin: 'collection', auth: { type: 'none' } })
    // El journey puede volver al contrato aunque la API tenga la suya.
    const back: FlowAuth = { ...cfg, journeys: { [J]: { poke: { type: 'contract' } } } }
    expect(resolveFlowAuth(back, J, 'poke', { type: 'none' }, COL)).toEqual({ origin: 'journey' })
  })

  it('el archivo no lleva secretos ni lo que deja todo como estaba', () => {
    const cfg: FlowAuth = {
      apis: { poke: { type: 'oauth2', clientId: 'app', clientSecret: 's3cr3t', accessTokenUrl: 'https://a/token' }, igual: { type: 'contract' } },
      journeys: { [J]: { poke: { type: 'bearer', token: '{{token}}' }, igual: { type: 'inherit' } } },
    }
    const text = serializeFlowAuth(cfg)!
    expect(text).not.toContain('s3cr3t')
    expect(text).not.toContain('igual')
    expect(text).toContain('{{token}}')
    const { secrets } = splitFlowAuthSecrets(cfg)
    expect(secrets).toEqual({ apis: { poke: { clientSecret: 's3cr3t' } }, journeys: {} })
    const back = withFlowAuthSecrets(parseFlowAuth(text), secrets)
    expect(back.apis.poke).toEqual(cfg.apis.poke)
    expect(back.journeys[J].poke).toEqual(cfg.journeys[J].poke)
    expect(serializeFlowAuth(emptyFlowAuth())).toBeUndefined()
    expect(renameFlowFile(back, 'pokedex.arazzo.yaml', 'kanto.arazzo.yaml').journeys).toHaveProperty(['kanto.arazzo.yaml#capturar'])
  })
})

describe('el runner con autorización propia', () => {
  const openapi = `openapi: 3.0.3
info: { title: Poke, version: '1' }
servers: [{ url: 'https://poke.test' }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
security: [{ bearerAuth: [] }]
paths:
  /pokemon:
    get:
      operationId: listar
      responses: { '200': { description: ok } }
`
  const arazzo = `arazzo: 1.0.1
info: { title: Pokédex, version: '1' }
sourceDescriptions: [{ name: poke, url: ./poke.yaml, type: openapi }]
workflows:
  - workflowId: capturar
    steps:
      - stepId: listar
        operationId: listar
        parameters: [{ name: X-Trace, in: header, value: abc }]
`
  const { project } = buildProject([parseFile({ name: 'pokedex.arazzo.yaml', text: arazzo }), parseFile({ name: 'poke.yaml', text: openapi })])
  const analysis = analyzeProject(project!)
  const run = async (ownAuth: boolean, dropAuth = false) => {
    const calls: { req: HttpRequest; meta?: RequestMeta }[] = []
    const result = await runWorkflow(project!, analysis, 'capturar', {
      inputs: {},
      credentials: { 'poke:bearerAuth': 'tok-contrato' },
      servers: {},
      dropAuth,
      ownAuth: ownAuth ? (source, wf) => source === 'poke' && wf === 'capturar' : undefined,
      executor: async (req, _signal, meta) => {
        calls.push({ req, meta })
        return { status: 200, statusText: 'OK', headers: {}, bodyText: '{}', durationMs: 1 }
      },
    })
    return { calls, result }
  }

  it('sin autorización propia usa la del contrato', async () => {
    const { calls } = await run(false)
    expect(calls[0].req.headers.Authorization).toBe('Bearer tok-contrato')
    expect(calls[0].meta).toMatchObject({ workflowId: 'capturar', sourceName: 'poke' })
  })

  it('con autorización propia no usa la del contrato y lo dice en lo que se muestra', async () => {
    const { calls, result } = await run(true)
    expect(calls[0].req.headers.Authorization).toBeUndefined()
    expect(calls[0].req.headers['X-Trace']).toBe('abc')
    expect(result.steps[0].request?.headers.Authorization).toContain('Arazzo Studio')
  })

  it('el caso "sin credenciales" avisa al executor', async () => {
    const { calls } = await run(true, true)
    expect(calls[0].meta?.dropAuth).toBe(true)
    expect(calls[0].req.headers.Authorization).toBeUndefined()
  })

  it('las APIs que llama el journey, con lo que pide su contrato', () => {
    expect(journeyApis(analysis.workflows[0]).map((a) => [a.source, a.schemes.map((s) => s.schemeName)])).toEqual([['poke', ['bearerAuth']]])
  })
})
