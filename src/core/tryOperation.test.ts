import { describe, expect, it } from 'vitest'
import { buildCollection, parseFile } from './loader'
import { listOperations } from './openapi'
import { runWorkflow } from './runner'
import { createSimulatedExecutor } from './simulator'
import { buildTryProject, initialForm, missingRequired, TRY_WORKFLOW } from './tryOperation'
import type { HttpExecutor } from './http'
import { setLocale } from '../i18n'

setLocale('es')

const OPENAPI = `openapi: 3.0.3
info: { title: Members, version: '1' }
servers: [{ url: https://api.example.com }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
security: [{ bearerAuth: [] }]
paths:
  /members/{memberId}:
    get:
      operationId: getMember
      parameters:
        - { name: memberId, in: path, required: true, schema: { type: string, example: MBR-1 } }
        - { name: expand, in: query, schema: { type: string } }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: object, required: [id], properties: { id: { type: string } } }
              example: { id: MBR-1 }
  /members:
    post:
      operationId: createMember
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { email: { type: string, format: email } } }
      responses:
        '201': { description: created }
`
const ARAZZO = `arazzo: 1.0.1
info: { title: t, version: '1' }
sourceDescriptions: [{ name: members, url: ./members.yaml, type: openapi }]
workflows: [{ workflowId: w, steps: [{ stepId: s, operationId: getMember }] }]
`

function setup() {
  const { projects } = buildCollection([parseFile({ name: 'a.arazzo.yaml', text: ARAZZO }), parseFile({ name: 'members.yaml', text: OPENAPI })])
  const source = projects[0].sources[0]
  const ops = listOperations(source)
  return { source, get: ops.find((o) => o.method === 'get')!, post: ops.find((o) => o.method === 'post')! }
}

describe('probar una operación sola', () => {
  it('arma el formulario con los ejemplos del contrato', () => {
    const { get, post } = setup()
    const form = initialForm(get)
    expect(form.params.map((p) => [p.name, p.in, p.required, p.value])).toEqual([
      ['memberId', 'path', true, 'MBR-1'],
      ['expand', 'query', false, ''],
    ])
    expect(JSON.parse(initialForm(post).body!)).toEqual({ email: 'demo@example.com' })
    expect(missingRequired({ ...form, params: form.params.map((p) => ({ ...p, value: '' })) })).toEqual(['memberId'])
  })

  it('envía la petición con parámetros, variables y credenciales, y valida la respuesta', async () => {
    const { source, get } = setup()
    const form = initialForm(get)
    form.params[1].value = '{{expand}}'
    const built = buildTryProject(source, get, form, (s) => s.replace('{{expand}}', 'benefits'))
    const seen: { url: string; auth?: string }[] = []
    const executor: HttpExecutor = async (req) => {
      seen.push({ url: req.url, auth: req.headers.Authorization })
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: '{"name":"sin id"}', durationMs: 5 }
    }
    const run = await runWorkflow(built.project!, built.analysis!, TRY_WORKFLOW, { inputs: {}, credentials: { 'members:bearerAuth': 'tok' }, servers: {}, executor })
    expect(seen[0]).toEqual({ url: 'https://api.example.com/members/MBR-1?expand=benefits', auth: 'Bearer tok' })
    const step = run.steps[0]
    expect(step.stepId).toBe('getMember')
    expect(step.response?.status).toBe(200)
    // La respuesta no trae el campo obligatorio del contrato.
    expect(step.status).toBe('warning')
    expect(step.contractIssues.join(' ')).toContain('id')
  })

  it('funciona en simulación con los ejemplos del contrato', async () => {
    const { source, post } = setup()
    const built = buildTryProject(source, post, initialForm(post))
    const steps = built.project!.arazzo.workflows[0].steps
    const run = await runWorkflow(built.project!, built.analysis!, TRY_WORKFLOW, { inputs: {}, credentials: {}, servers: {}, executor: createSimulatedExecutor(built.project!, steps) })
    expect(run.steps[0].response?.status).toBe(201)
    expect(run.steps[0].request?.body).toEqual({ email: 'demo@example.com' })
  })

  it('avisa si el body no es JSON', () => {
    const { source, post } = setup()
    expect(buildTryProject(source, post, { params: [], body: '{ mal', contentType: 'application/json' }).error).toContain('JSON')
  })
})
