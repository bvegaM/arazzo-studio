import { describe, expect, it } from 'vitest'
import { analyzeProject } from './analyze'
import { buildCollection, parseFile } from './loader'
import { runDependencies, runWorkflow, workflowDependencies } from './runner'
import type { HttpExecutor } from './http'
import { setLocale } from '../i18n'

setLocale('es')

const OPENAPI = `openapi: 3.0.3
info: { title: Members, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /members:
    post:
      operationId: createMember
      responses: { '201': { description: ok } }
  /members/{memberId}:
    get:
      operationId: getMember
      parameters: [{ name: memberId, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: ok } }
`
const arazzo = (extra = '') => `arazzo: 1.1.0
info: { title: t, version: '1' }
sourceDescriptions: [{ name: members, url: ./members.yaml, type: openapi }]
workflows:
  - workflowId: enroll
    steps:
      - stepId: create
        operationId: createMember
        successCriteria: [{ condition: $statusCode == 201 }]
        outputs: { id: $response.body#/id }
    outputs: { memberId: $steps.create.outputs.id }
  - workflowId: audit
    dependsOn: [enroll]
    steps:
      - stepId: read
        operationId: getMember
        parameters: [{ name: memberId, in: path, value: $workflows.enroll.outputs.memberId }]
    outputs: { checked: $steps.read.outputs.ok }
  - workflowId: transfer
    dependsOn: [audit]
    steps:
      - stepId: get
        operationId: getMember
        parameters: [{ name: memberId, in: path, value: $workflows.enroll.outputs.memberId }]
${extra}`

function setup(text: string) {
  const { projects } = buildCollection([parseFile({ name: 'a.arazzo.yaml', text }), parseFile({ name: 'members.yaml', text: OPENAPI })])
  return { project: projects[0], analysis: analyzeProject(projects[0]) }
}

describe('dependsOn entre workflows', () => {
  it('ordena las dependencias, también las indirectas', () => {
    const { project, analysis } = setup(arazzo())
    expect(workflowDependencies(project, 'transfer').order).toEqual(['enroll', 'audit'])
    const info = analysis.workflows.find((w) => w.workflow.workflowId === 'transfer')!.issues.find((i) => i.level === 'info' && i.message.includes('dependsOn'))
    expect(info?.message).toContain('"enroll" → "audit"')
  })

  it('detecta ciclos y workflows que no existen', () => {
    const cyc = setup(arazzo('    \n  - workflowId: a\n    dependsOn: [b]\n    steps: [{ stepId: s, operationId: getMember }]\n  - workflowId: b\n    dependsOn: [a]\n    steps: [{ stepId: s, operationId: getMember }]\n'))
    expect(workflowDependencies(cyc.project, 'a').error).toContain('a → b → a')
    expect(cyc.analysis.workflows.find((w) => w.workflow.workflowId === 'a')!.issues.some((i) => i.level === 'error')).toBe(true)
    const missing = setup(arazzo().replace('dependsOn: [audit]', 'dependsOn: [nope]'))
    expect(workflowDependencies(missing.project, 'transfer').error).toContain('"nope"')
  })

  it('ejecuta las dependencias una vez y deja sus outputs en $workflows', async () => {
    const { project, analysis } = setup(arazzo())
    const urls: string[] = []
    const executor: HttpExecutor = async (req) => {
      urls.push(`${req.method.toUpperCase()} ${req.url}`)
      return req.method.toUpperCase() === 'POST'
        ? { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, bodyText: '{"id":"MBR-7"}', durationMs: 1 }
        : { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: '{}', durationMs: 1 }
    }
    const deps = await runDependencies(project, analysis, 'transfer', { credentials: {}, servers: {}, executor, inputsFor: () => ({}) })
    expect(deps.error).toBeUndefined()
    expect(deps.runs.map((r) => r.workflowId)).toEqual(['enroll', 'audit'])
    const run = await runWorkflow(project, analysis, 'transfer', { inputs: {}, credentials: {}, servers: {}, executor, workflowOutputs: deps.outputs })
    expect(run.status).toBe('success')
    expect(urls).toEqual(['POST https://api.example.com/members', 'GET https://api.example.com/members/MBR-7', 'GET https://api.example.com/members/MBR-7'])
  })

  it('si una dependencia falla, se detiene y lo explica', async () => {
    const { project, analysis } = setup(arazzo())
    const executor: HttpExecutor = async () => ({ status: 500, statusText: 'Error', headers: {}, bodyText: '', durationMs: 1 })
    const deps = await runDependencies(project, analysis, 'transfer', { credentials: {}, servers: {}, executor, inputsFor: () => ({}) })
    expect(deps.runs.map((r) => r.workflowId)).toEqual(['enroll'])
    expect(deps.error).toContain('"enroll"')
  })
})
