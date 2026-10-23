import { describe, expect, it } from 'vitest'
import { hasMaskedValues, toCurl } from './curl'
import { buildProject, parseFile } from './loader'
import { analyzeProject } from './analyze'
import { realRequest, runWorkflow } from './runner'
import type { HttpRequest } from './http'

describe('toCurl', () => {
  it('arma un comando con método, headers y body JSON', () => {
    const curl = toCurl({ method: 'post', url: 'https://api.test/cards', headers: { 'Content-Type': 'application/json' }, body: { name: "O'Brien" } })
    expect(curl).toBe(`curl -X POST 'https://api.test/cards' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\n  "name": "O'\\''Brien"\n}'`)
  })

  it('omite -X en GET y no agrega body', () => {
    expect(toCurl({ method: 'GET', url: 'https://api.test/x', headers: {} })).toBe(`curl 'https://api.test/x'`)
  })

  it('cambia los valores enmascarados por <secret>', () => {
    const req = { method: 'GET', url: 'https://api.test/x?api_key=ab••••yz&q=1', headers: { Authorization: 'Bearer to••••mo' } }
    expect(hasMaskedValues(req)).toBe(true)
    const curl = toCurl(req)
    expect(curl).toContain(`'https://api.test/x?api_key=<secret>&q=1'`)
    expect(curl).toContain(`-H 'Authorization: Bearer <secret>'`)
  })

  it('codifica el body de formularios', () => {
    expect(toCurl({ method: 'POST', url: 'u', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { a: 1, b: 'x y' } })).toContain(`--data-raw 'a=1&b=x+y'`)
  })
})

describe('secretos en la query', () => {
  const openapi = `openapi: 3.0.3
info: { title: t, version: '1' }
servers: [{ url: 'https://api.test' }]
components:
  securitySchemes:
    key: { type: apiKey, in: query, name: api_key }
security: [{ key: [] }]
paths:
  /ping:
    get:
      operationId: ping
      responses: { '200': { description: ok } }
`
  const arazzo = `arazzo: 1.0.1
info: { title: t, version: '1' }
sourceDescriptions: [{ name: api, url: ./api.yaml, type: openapi }]
workflows:
  - workflowId: w
    steps:
      - stepId: ping
        operationId: ping
        successCriteria: [{ condition: $statusCode == 200 }]
`
  it('enmascara la API key en la URL que se muestra y conserva la real aparte', async () => {
    const { project } = buildProject([parseFile({ name: 'w.arazzo.yaml', text: arazzo }), parseFile({ name: 'api.yaml', text: openapi })])
    const sent: HttpRequest[] = []
    const run = await runWorkflow(project!, analyzeProject(project!), 'w', {
      inputs: {},
      credentials: { 'api:key': 'secret-123456' },
      servers: {},
      executor: async (req) => {
        sent.push(req)
        return { status: 200, statusText: 'OK', headers: {}, bodyText: '', durationMs: 1 }
      },
    })
    expect(sent[0].url).toBe('https://api.test/ping?api_key=secret-123456')
    const shown = run.steps[0].request!
    expect(shown.url).toBe('https://api.test/ping?api_key=se••••56')
    expect(realRequest(shown).url).toBe(sent[0].url)
    expect(JSON.stringify(run)).not.toContain('secret-123456')
  })
})
