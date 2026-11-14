import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildProject, parseFile, type ParsedFile } from './loader'
import { analyzeProject } from './analyze'
import { runWorkflow, type RunOptions } from './runner'
import { evaluateCase, generateTestCases } from './testcases'
import { createSimulatedExecutor, createSimulatedMessenger } from './simulator'
import { NetworkError, fetchExecutor, type HttpExecutor } from './http'
import { setLocale } from '../i18n'

setLocale('es')

const MEMBERS = `
openapi: 3.0.3
info: { title: Members, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /members:
    post:
      operationId: createMember
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: 'schemas.yaml#/NewMember' }
      responses:
        '201':
          description: Creado
          content:
            application/json:
              schema: { $ref: 'schemas.yaml#/Member' }
              example: { member: { id: M-1, tier: GOLD }, miles: 0 }
  /members/{id}:
    get:
      operationId: getMember
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: 'schemas.yaml#/Member' }
`

const SCHEMAS = `
NewMember:
  type: object
  required: [email]
  properties:
    email: { type: string }
Member:
  type: object
  properties:
    member: { $ref: '#/MemberData' }
    miles: { type: integer }
MemberData:
  type: object
  properties:
    id: { type: string }
    tier: { type: string }
`

const MILES = `
asyncapi: 3.0.0
info: { title: Miles events, version: '1' }
channels:
  transferRequested:
    address: miles.transfer.requested
    messages:
      request: { $ref: '#/components/messages/TransferRequested' }
  transferCompleted:
    address: miles.transfer.completed
    messages:
      completed: { $ref: '#/components/messages/TransferCompleted' }
operations:
  requestTransfer:
    action: send
    channel: { $ref: '#/channels/transferRequested' }
  onTransferCompleted:
    action: receive
    channel: { $ref: '#/channels/transferCompleted' }
components:
  messages:
    TransferRequested:
      payload:
        type: object
        properties:
          memberId: { type: string }
          miles: { type: integer }
    TransferCompleted:
      correlationId: { location: '$message.header#/correlationId' }
      headers:
        type: object
        properties:
          correlationId: { type: string }
      payload:
        type: object
        required: [status]
        properties:
          status: { type: string, enum: [COMPLETED, REJECTED] }
          balance: { type: integer }
      examples:
        - payload: { status: COMPLETED, balance: 1500 }
`

const ARAZZO = `
arazzo: 1.1.0
info: { title: Traspaso de millas, version: '1' }
sourceDescriptions:
  - { name: members, url: ./members.yaml, type: openapi }
  - { name: milesEvents, url: ./miles.asyncapi.yaml, type: asyncapi }
workflows:
  - workflowId: transferMiles
    inputs:
      type: object
      required: [email, correlationId]
      properties:
        email: { type: string }
        correlationId: { type: string }
        miles: { type: integer }
    steps:
      - stepId: createMember
        operationId: $sourceDescriptions.members.createMember
        requestBody:
          payload: { email: $inputs.email }
        successCriteria:
          - condition: $statusCode == 201
        outputs:
          memberId:
            context: $response.body
            selector: $.member.id
            type: jsonpath
      - stepId: requestTransfer
        operationId: $sourceDescriptions.milesEvents.requestTransfer
        action: send
        parameters:
          - { name: correlationId, in: header, value: $inputs.correlationId }
        requestBody:
          payload:
            memberId: $steps.createMember.outputs.memberId
            miles: $inputs.miles
      - stepId: awaitTransfer
        channelPath: '{$sourceDescriptions.milesEvents.url}#/channels/transferCompleted'
        action: receive
        correlationId: $inputs.correlationId
        timeout: 5000
        dependsOn: [requestTransfer]
        successCriteria:
          - condition: $message.payload#/status == 'COMPLETED'
        onFailure:
          - name: transferRejected
            type: end
            criteria:
              - condition: $message.payload#/status == 'REJECTED'
          - name: noConfirmation
            type: end
        outputs:
          balance: $message.payload#/balance
          correlation: $message.header.correlationId
      - stepId: getMember
        operationId: $sourceDescriptions.members.getMember
        parameters:
          - { name: id, in: path, value: $steps.createMember.outputs.memberId }
          - { name: query, in: querystring, value: 'expand=benefits&lang={$inputs.email}' }
`

const files = (extra: Record<string, string> = {}): ParsedFile[] =>
  Object.entries({
    'transfer.arazzo.yaml': ARAZZO,
    'members.yaml': MEMBERS,
    'schemas.yaml': SCHEMAS,
    'miles.asyncapi.yaml': MILES,
    ...extra,
  }).map(([name, text]) => parseFile({ name, text }))

const INPUTS = { email: 'ana@example.com', correlationId: 'corr-42', miles: 500 }

function setup(fileList = files()) {
  const { project, errors } = buildProject(fileList)
  const analysis = analyzeProject(project!)
  const wa = analysis.workflows[0]
  return { project: project!, errors, analysis, wa }
}

function simulated(project: ReturnType<typeof setup>['project'], steps = setup().wa.workflow.steps): Pick<RunOptions, 'executor' | 'messenger'> {
  return { executor: createSimulatedExecutor(project, steps), messenger: createSimulatedMessenger(steps) }
}

describe('Arazzo 1.1 con OpenAPI, AsyncAPI y $ref externos', () => {
  it('resuelve $ref a otros archivos, también los $ref locales de esos archivos', () => {
    const { project, errors } = setup()
    expect(errors).toEqual([])
    const members = project.sources.find((s) => s.name === 'members')!
    expect(members.status).toBe('loaded')
    expect(members.missingRefs).toBeUndefined()
    const schema = members.doc.paths['/members'].post.responses['201'].content['application/json'].schema
    expect(schema.properties.member.properties.tier).toEqual({ type: 'string' })
    expect(project.sources.find((s) => s.name === 'milesEvents')!.status).toBe('loaded')
  })

  it('avisa qué archivos referenciados faltan', () => {
    const { project, analysis } = setup(files().filter((f) => f.name !== 'schemas.yaml'))
    expect(project.sources.find((s) => s.name === 'members')!.missingRefs).toEqual(['schemas.yaml'])
    expect(analysis.issues.some((i) => i.level === 'error' && i.message.includes('schemas.yaml'))).toBe(true)
  })

  it('analiza los pasos de AsyncAPI sin errores', () => {
    const { analysis, wa } = setup()
    const all = [...analysis.issues, ...wa.issues]
    expect(all.filter((i) => i.level === 'error')).toEqual([])
    expect(wa.steps.map((s) => s.label)).toEqual([
      'POST /members',
      'SEND miles.transfer.requested',
      'RECEIVE miles.transfer.completed',
      'GET /members/{id}',
    ])
    expect(wa.steps[1].mutating).toBe(false)
    // Los servidores a configurar son solo los HTTP.
    expect(wa.sources.map((s) => s.name)).toEqual(['members'])
    expect(analysis.issues.some((i) => i.level === 'info' && i.message.includes('broker'))).toBe(true)
  })

  it('ejecuta el journey en simulación: mensajes, correlación, selector y querystring', async () => {
    const { project, analysis, wa } = setup()
    const run = await runWorkflow(project, analysis, 'transferMiles', {
      inputs: INPUTS,
      credentials: {},
      servers: {},
      ...simulated(project, wa.workflow.steps),
    })
    expect(run.status).toBe('success')
    const [create, send, receive, get] = run.steps
    expect(create.outputs.memberId).toBe('M-1')
    expect(send.message).toMatchObject({ action: 'send', channel: 'miles.transfer.requested', payload: { memberId: 'M-1', miles: 500 } })
    expect(send.request?.headers).toEqual({ correlationId: 'corr-42' })
    expect(receive.status).toBe('success')
    expect(receive.outputs).toEqual({ balance: 1500, correlation: 'corr-42' })
    expect(receive.contractIssues).toEqual([])
    expect(get.request?.url).toBe('https://api.example.com/members/M-1?expand=benefits&lang=ana%40example.com')
  })

  it('genera escenarios de mensaje y de timeout y los verifica', async () => {
    const { project, analysis, wa } = setup()
    const cases = generateTestCases(wa).filter((c) => c.scenario?.stepId === 'awaitTransfer')
    expect(cases.map((c) => c.expectation.actionName).sort()).toEqual(['noConfirmation', 'transferRejected'])
    for (const tc of cases) {
      const steps = wa.workflow.steps
      const run = await runWorkflow(project, analysis, 'transferMiles', {
        inputs: INPUTS,
        credentials: {},
        servers: {},
        executor: createSimulatedExecutor(project, steps, tc.scenario),
        messenger: createSimulatedMessenger(steps, tc.scenario),
      })
      expect(evaluateCase(tc, run).verdict, tc.title).toBe('passed')
      expect(run.steps.find((s) => s.stepId === 'getMember')!.status).toBe('skipped')
    }
  })

  it('contra la API real, los pasos de mensajería se simulan y quedan con advertencia', async () => {
    const { project, analysis, wa } = setup()
    const run = await runWorkflow(project, analysis, 'transferMiles', {
      inputs: INPUTS,
      credentials: {},
      servers: {},
      executor: createSimulatedExecutor(project, wa.workflow.steps),
    })
    expect(run.status).toBe('success')
    const receive = run.steps.find((s) => s.stepId === 'awaitTransfer')!
    expect(receive.status).toBe('warning')
    expect(receive.reason?.category).toBe('mensajeria')
  })

  it('dependsOn: un paso no corre si su dependencia no terminó bien', async () => {
    const arazzo = ARAZZO.replace('dependsOn: [requestTransfer]', 'dependsOn: [getMember]')
    const { project, analysis, wa } = setup(files({ 'transfer.arazzo.yaml': arazzo }))
    expect(wa.issues.some((i) => i.stepId === 'awaitTransfer' && i.message.includes('se ejecuta después'))).toBe(true)
    const run = await runWorkflow(project, analysis, 'transferMiles', {
      inputs: INPUTS,
      credentials: {},
      servers: {},
      ...simulated(project, wa.workflow.steps),
    })
    const receive = run.steps.find((s) => s.stepId === 'awaitTransfer')!
    expect(receive.status).toBe('failed')
    expect(receive.reason?.category).toBe('dependencia')
  })

  it('timeout de un paso HTTP: corta la petición y lo explica', async () => {
    const hanging: HttpExecutor = (_req, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new NetworkError('abortado', 0))))
    const arazzo = ARAZZO.replace("        requestBody:\n          payload: { email: $inputs.email }", "        timeout: 20\n        requestBody:\n          payload: { email: $inputs.email }")
    const p = setup(files({ 'transfer.arazzo.yaml': arazzo }))
    expect(p.wa.workflow.steps[0].timeout).toBe(20)
    const run = await runWorkflow(p.project, p.analysis, 'transferMiles', { inputs: INPUTS, credentials: {}, servers: {}, executor: hanging })
    expect(run.steps[0].status).toBe('failed')
    expect(run.steps[0].reason?.message).toContain('20 ms')
  })
})

describe('otras novedades de la 1.1', () => {
  const OPENAPI = `
openapi: 3.0.3
info: { title: Tokens, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /balance:
    get:
      operationId: getBalance
      responses:
        '200': { description: OK, content: { application/json: { example: { miles: 10 } } } }
        '401': { description: No autorizado, content: { application/json: { example: { code: EXPIRED } } } }
  /token:
    post:
      operationId: refresh
      responses:
        '200': { description: OK, content: { application/json: { example: { token: nuevo } } } }
`
  const ARAZZO_ACTIONS = `
arazzo: 1.1.0
info: { title: Acciones, version: '1' }
sourceDescriptions: [{ name: api, url: ./api.yaml }]
workflows:
  - workflowId: balance
    inputs: { type: object, properties: { refreshToken: { type: string } } }
    steps:
      - stepId: getBalance
        operationId: getBalance
        successCriteria: [{ condition: $statusCode == 200 }]
        onFailure:
          - name: renew
            type: goto
            workflowId: renewToken
            parameters:
              - { name: token, value: $inputs.refreshToken }
            criteria: [{ condition: $statusCode == 401 }]
  - workflowId: renewToken
    inputs: { type: object, properties: { token: { type: string } } }
    steps:
      - stepId: refresh
        operationId: refresh
        parameters: [{ name: X-Refresh, in: header, value: $inputs.token }]
`

  it('goto a un workflow con parameters: se convierten en sus inputs', async () => {
    const { project } = buildProject([
      parseFile({ name: 'a.arazzo.yaml', text: ARAZZO_ACTIONS }),
      parseFile({ name: 'api.yaml', text: OPENAPI }),
    ])
    const analysis = analyzeProject(project!)
    const steps = project!.arazzo.workflows[0].steps
    const run = await runWorkflow(project!, analysis, 'balance', {
      inputs: { refreshToken: 'rt-1' },
      credentials: {},
      servers: {},
      executor: createSimulatedExecutor(project!, steps, { stepId: 'getBalance', status: 401, bodyValues: [] }),
    })
    const sub = run.steps[0].subRun!
    expect(sub.workflowId).toBe('renewToken')
    expect(sub.steps[0].request?.headers['X-Refresh']).toBe('rt-1')
  })

  it('AsyncAPI 2.x: publish es send y subscribe es receive', () => {
    const v2 = `
asyncapi: 2.6.0
info: { title: Legacy, version: '1' }
channels:
  points/earned:
    subscribe:
      operationId: onPointsEarned
      message: { payload: { type: object, properties: { points: { type: integer } } } }
    publish:
      operationId: earnPoints
      message: { payload: { type: object } }
`
    const arazzo = `
arazzo: 1.1.0
info: { title: v2, version: '1' }
sourceDescriptions: [{ name: legacy, url: ./legacy.yaml, type: asyncapi }]
workflows:
  - workflowId: earn
    steps:
      - { stepId: send, operationId: earnPoints }
      - stepId: wait
        operationPath: '{$sourceDescriptions.legacy.url}#/channels/points~1earned/subscribe'
        timeout: 1000
`
    const { project } = buildProject([parseFile({ name: 'e.arazzo.yaml', text: arazzo }), parseFile({ name: 'legacy.yaml', text: v2 })])
    const wa = analyzeProject(project!).workflows[0]
    expect(wa.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(wa.steps.map((s) => s.label)).toEqual(['SEND points/earned', 'RECEIVE points/earned'])
  })

  it('avisa si la versión de Arazzo es más nueva que la soportada', () => {
    const { project } = buildProject([
      parseFile({ name: 'a.arazzo.yaml', text: ARAZZO_ACTIONS.replace('arazzo: 1.1.0', 'arazzo: 1.2.0') }),
      parseFile({ name: 'api.yaml', text: OPENAPI }),
    ])
    expect(analyzeProject(project!).issues.some((i) => i.message.includes('1.2.0'))).toBe(true)
  })
})

describe('ejemplo de traspaso de millas (examples/miles-transfer)', () => {
  const dir = new URL('../../examples/miles-transfer/', import.meta.url)
  const example = ['miles-transfer.arazzo.yaml', 'members.yaml', 'member-schemas.yaml', 'miles-events.asyncapi.yaml'].map((name) =>
    parseFile({ name, text: readFileSync(new URL(name, dir), 'utf8') }),
  )
  const { project, analysis, wa } = setup(example)
  const inputs = { email: 'ana@example.com', firstName: 'Ana', miles: 500, partner: 'COBRAND_BANK', correlationId: 'c-1' }

  let mock: ChildProcess
  beforeAll(async () => {
    mock = await new Promise<ChildProcess>((resolve) => {
      const p = spawn('node', ['examples/mock-server.mjs'], { env: { ...process.env, PORT: '4513' } })
      p.stdout.on('data', (d) => String(d).includes('http://localhost:4513') && resolve(p))
    })
  })
  afterAll(() => mock.kill())

  it('carga sin errores', () => {
    expect([...analysis.issues, ...wa.issues].filter((i) => i.level === 'error')).toEqual([])
  })

  it('corre en simulación y todos los casos generados pasan', async () => {
    for (const tc of generateTestCases(wa).filter((c) => c.scenario || c.expectation.type === 'success')) {
      const steps = wa.workflow.steps
      const run = await runWorkflow(project, analysis, 'enrollAndTransfer', {
        inputs,
        credentials: {},
        servers: {},
        executor: createSimulatedExecutor(project, steps, tc.scenario),
        messenger: createSimulatedMessenger(steps, tc.scenario),
      })
      expect(evaluateCase(tc, run).verdict, tc.title).toBe('passed')
    }
  })

  it('contra el mock: HTTP real y mensajería simulada', async () => {
    const run = await runWorkflow(project, analysis, 'enrollAndTransfer', {
      inputs: { ...inputs, email: `ana-${Date.now()}@example.com` },
      credentials: { 'members:bearerAuth': 'token-demo' },
      servers: { members: 'http://localhost:4513' },
      executor: fetchExecutor,
    })
    expect(run.status).toBe('success')
    expect(run.steps.map((s) => s.status)).toEqual(['success', 'warning', 'warning', 'success'])
    expect(run.steps[0].simulated).toBeFalsy()
    expect(run.steps[2].simulated).toBe(true)
    expect(run.outputs.memberId).toMatch(/^MBR-/)
  })
})
