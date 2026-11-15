import { describe, expect, it } from 'vitest'
import { analyzeProject } from './analyze'
import { buildCollection, parseFile } from './loader'
import { runWorkflow } from './runner'
import type { HttpExecutor, HttpRequest } from './http'
import { setLocale } from '../i18n'

setLocale('es')

const OPENAPI = `openapi: 3.0.3
info: { title: Session, version: '1' }
servers: [{ url: https://api.example.com }]
components:
  securitySchemes:
    cookieKey: { type: apiKey, in: cookie, name: api_key }
security: [{ cookieKey: [] }]
paths:
  /me:
    get:
      operationId: me
      parameters: [{ name: session, in: cookie, schema: { type: string } }]
      responses: { '200': { description: ok }, '401': { description: no } }
`
const ARAZZO = `arazzo: 1.1.0
info: { title: t, version: '1' }
sourceDescriptions: [{ name: api, url: ./api.yaml, type: openapi }]
workflows:
  - workflowId: w
    steps:
      - stepId: me
        operationId: me
        parameters: [{ name: session, in: cookie, value: sess-123456 }]
        successCriteria: [{ condition: $statusCode == 200 }]
`

function setup() {
  const { projects } = buildCollection([parseFile({ name: 'a.arazzo.yaml', text: ARAZZO }), parseFile({ name: 'api.yaml', text: OPENAPI })])
  return { project: projects[0], analysis: analyzeProject(projects[0]) }
}

describe('parámetros y credenciales en cookie', () => {
  it('en escritorio envía un header Cookie y lo muestra tapado', async () => {
    const { project, analysis } = setup()
    let sent: HttpRequest | undefined
    const executor: HttpExecutor = async (req) => {
      sent = req
      return { status: 200, statusText: 'OK', headers: {}, bodyText: '{}', durationMs: 1 }
    }
    const run = await runWorkflow(project, analysis, 'w', { inputs: {}, credentials: { 'api:cookieKey': 'key-abcdef' }, servers: {}, executor, canSendCookies: true })
    expect(sent?.headers.Cookie).toBe('session=sess-123456; api_key=key-abcdef')
    expect(run.steps[0].request?.headers.Cookie).not.toContain('sess-123456')
    expect(run.steps[0].request?.headers.Cookie).not.toContain('key-abcdef')
    expect(run.status).toBe('success')
  })

  it('en el navegador no las envía y, si el paso falla, lo explica', async () => {
    const { project, analysis } = setup()
    let sent: HttpRequest | undefined
    const executor: HttpExecutor = async (req) => {
      sent = req
      return { status: 401, statusText: 'Unauthorized', headers: {}, bodyText: '', durationMs: 1 }
    }
    const run = await runWorkflow(project, analysis, 'w', { inputs: {}, credentials: { 'api:cookieKey': 'key-abcdef' }, servers: {}, executor })
    expect(sent?.headers.Cookie).toBeUndefined()
    expect(run.steps[0].reason?.message).toContain('session, api_key')
    expect(run.steps[0].reason?.message).toContain('app de escritorio')
  })
})
