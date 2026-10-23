import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildProject, parseFile } from './loader'
import { analyzeProject } from './analyze'
import { evaluateCriterion } from './criteria'
import { interpolate, type ExprContext } from './expressions'
import { fetchExecutor } from './http'
import { runWorkflow } from './runner'
import { applyCaseInputs, evaluateCase, generateTestCases } from './testcases'
import { createSimulatedExecutor } from './simulator'
import { setLocale } from '../i18n'

// Los textos esperados están en español; el idioma por defecto depende del entorno.
setLocale('es')

const dir = new URL('../../examples/credit-cards/', import.meta.url)
const files = ['card-onboarding.arazzo.yaml', 'credit-cards.yaml'].map((name) =>
  parseFile({ name, text: readFileSync(new URL(name, dir), 'utf8') }),
)

function ctx(partial: Partial<ExprContext>): ExprContext {
  return { inputs: {}, steps: {}, workflows: {}, sourceUrls: {}, ...partial }
}

describe('expresiones y criterios', () => {
  it('interpola expresiones completas y embebidas conservando tipos', () => {
    const c = ctx({ inputs: { limit: 1500, id: 'A1' }, steps: { s1: { outputs: { cardId: 'C9' } } } })
    expect(interpolate({ a: '$inputs.limit', b: 'id-{$inputs.id}', c: '$steps.s1.outputs.cardId' }, c)).toEqual({
      a: 1500,
      b: 'id-A1',
      c: 'C9',
    })
  })

  it('registra expresiones sin resolver', () => {
    const unresolved: string[] = []
    interpolate('$steps.nope.outputs.x', ctx({ unresolved }))
    expect(unresolved).toEqual(['$steps.nope.outputs.x'])
  })

  it('evalúa condiciones simples con explicación', () => {
    const c = ctx({ response: { status: 200, headers: {}, body: { status: 'pending', items: [1, 2] } } })
    expect(evaluateCriterion({ condition: "$statusCode == 200 && $response.body#/status == 'PENDING'" }, c).passed).toBe(true)
    const r = evaluateCriterion({ condition: '$statusCode == 201' }, c)
    expect(r.passed).toBe(false)
    expect(r.detail).toContain('Se esperaba $statusCode igual a 201, pero vale 200')
    expect(evaluateCriterion({ condition: '$response.body.items[1] >= 2' }, c).passed).toBe(true)
  })
})

describe('análisis del proyecto de ejemplo', () => {
  const { project, errors } = buildProject(files)
  it('asocia el contrato y no tiene errores', () => {
    expect(errors).toEqual([])
    expect(project!.sources[0].status).toBe('loaded')
    const analysis = analyzeProject(project!)
    const all = [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)]
    expect(all.filter((i) => i.level === 'error')).toEqual([])
    const wf = analysis.workflows[0]
    expect(wf.steps.map((s) => s.label)).toEqual([
      'POST /card-applications',
      'POST /card-applications/{applicationId}/approval',
      'POST /cards/{cardId}/activation',
      'GET /cards/{cardId}',
    ])
    expect(wf.dataEdges).toContainEqual({ fromStep: 'aprobar', toStep: 'consultar', output: 'cardId' })
    expect(analysis.credentials.map((c) => c.type)).toEqual(['bearer'])
  })

  it('genera casos de prueba con origen', () => {
    const analysis = analyzeProject(project!)
    const cases = generateTestCases(analysis.workflows[0])
    expect(cases.map((c) => c.id)).toContain('onboarding-tarjeta::missing-customerId')
    expect(cases.map((c) => c.id)).toContain('onboarding-tarjeta::invalid-productCode')
    expect(cases.find((c) => c.id.endsWith('no-auth'))?.expectation.statuses).toEqual([401, 403])
  })

  it('resuelve "<fuente>.<operationId>" con advertencia y detecta criterios $statusCode imposibles', () => {
    const p = structuredClone(project!)
    const step = p.arazzo.workflows[0].steps[0]
    step.operationId = 'creditCards.createCardApplication'
    step.successCriteria = [{ condition: '$statusCode == 201' }, { condition: '$statusCode == 200' }]
    const issues = analyzeProject(p).workflows[0].issues
    expect(analyzeProject(p).workflows[0].steps[0].kind).toBe('operation')
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('$sourceDescriptions.creditCards.createCardApplication'))).toBe(true)
    expect(issues.some((i) => i.level === 'error' && i.message.includes('nunca se cumplirán'))).toBe(true)
  })

  it('sugiere la ruta cuando el operationPath incluye el prefijo del servidor', () => {
    const p = structuredClone(project!)
    const step = p.arazzo.workflows[0].steps[3]
    delete step.operationId
    step.operationPath = '{$sourceDescriptions.creditCards.url}#/paths/~1sandbox~1cards~1{cardId}/get'
    const wa = analyzeProject(p).workflows[0]
    expect(wa.steps[3].op?.path).toBe('/cards/{cardId}')
    expect(wa.issues.some((i) => i.level === 'warning' && i.message.includes('prefijo del servidor'))).toBe(true)
  })

  it('detecta operaciones inexistentes', () => {
    const broken = structuredClone(project!)
    broken.arazzo.workflows[0].steps[1].operationId = 'approveApplication'
    const analysis = analyzeProject(broken)
    expect(analysis.workflows[0].issues.some((i) => i.level === 'error' && i.message.includes('approveApplication'))).toBe(true)
  })
})

function startMock(bug: boolean, port: number): Promise<ChildProcess> {
  return new Promise((resolve) => {
    const p = spawn('node', ['examples/mock-server.mjs'], { env: { ...process.env, PORT: String(port), MOCK_BUG: bug ? '1' : '0' } })
    p.stdout.on('data', (d) => String(d).includes('Mock Credit Cards API') && resolve(p))
  })
}

describe('ejecución contra el mock', () => {
  let ok: ChildProcess
  let buggy: ChildProcess
  beforeAll(async () => {
    ok = await startMock(false, 4511)
    buggy = await startMock(true, 4512)
  })
  afterAll(() => {
    ok.kill()
    buggy.kill()
  })

  const { project } = buildProject(files)
  const analysis = analyzeProject(project!)
  const inputs = { customerId: 'CUST-1', productCode: 'LATAM_PASS_VISA', requestedLimit: 1500, last4Digits: '4321' }
  const base = (port: number) => ({
    inputs,
    credentials: { 'creditCards:bearerAuth': 'token-demo' },
    servers: { creditCards: `http://localhost:${port}` },
    executor: fetchExecutor,
  })

  it('camino feliz exitoso', async () => {
    const run = await runWorkflow(project!, analysis, 'onboarding-tarjeta', base(4511))
    expect(run.steps.map((s) => s.status)).toEqual(['success', 'success', 'success', 'success'])
    expect(run.outputs.status).toBe('ACTIVE')
    expect(run.steps[0].request?.headers['Authorization']).not.toContain('token-demo')
  })

  it('dígitos incorrectos: falla en activar y salta consultar', async () => {
    const run = await runWorkflow(project!, analysis, 'onboarding-tarjeta', { ...base(4511), inputs: { ...inputs, last4Digits: '9999' } })
    expect(run.status).toBe('failed')
    const activar = run.steps.find((s) => s.stepId === 'activar')!
    expect(activar.reason?.category).toBe('error-api')
    expect(activar.reason?.message).toContain('422')
    expect(run.steps.find((s) => s.stepId === 'consultar')?.status).toBe('skipped')
  })

  it('reporta violaciones de contrato como advertencia', async () => {
    const run = await runWorkflow(project!, analysis, 'onboarding-tarjeta', base(4512))
    const activar = run.steps.find((s) => s.stepId === 'activar')!
    expect(activar.status).toBe('warning')
    expect(activar.contractIssues[0]).toContain('activatedAt')
    const consultar = run.steps.find((s) => s.stepId === 'consultar')!
    expect(consultar.contractIssues.join(' ')).toContain('/creditLimit')
  })

  it('evalúa todos los casos generados', async () => {
    const cases = generateTestCases(analysis.workflows[0])
    const verdicts: Record<string, string> = {}
    for (const tc of cases) {
      const wf = project!.arazzo.workflows.find((w) => w.workflowId === tc.workflowId)!
      const run = await runWorkflow(project!, analysis, tc.workflowId, {
        ...base(4511),
        executor: tc.scenario ? createSimulatedExecutor(project!, wf.steps, tc.scenario) : fetchExecutor,
        inputs: applyCaseInputs(tc, inputs),
        dropAuth: tc.dropAuth,
      })
      verdicts[tc.id] = evaluateCase(tc, run).verdict
    }
    expect(Object.values(verdicts).every((v) => v === 'passed')).toBe(true)
    expect(Object.keys(verdicts).filter((k) => k.includes('scenario'))).toHaveLength(4)
  })

  it('escenario simulado: detecta cuando se activa otra acción', async () => {
    const broken = structuredClone(project!)
    const activar = broken.arazzo.workflows[0].steps[2]
    // Una acción genérica de 422 antes que la específica: la específica nunca se activa.
    activar.onFailure = [{ name: 'generico', type: 'end', criteria: [{ condition: '$statusCode == 422' }] }, ...activar.onFailure!]
    const a = analyzeProject(broken)
    const tc = generateTestCases(a.workflows[0]).find((c) => c.id.endsWith('digitosIncorrectos'))!
    const run = await runWorkflow(broken, a, tc.workflowId, {
      ...base(4511),
      executor: createSimulatedExecutor(broken, broken.arazzo.workflows[0].steps, tc.scenario),
    })
    const r = evaluateCase(tc, run)
    expect(r.verdict).toBe('failed')
    expect(r.explanation).toContain('activó "generico" en lugar de "digitosIncorrectos"')
  })

  it('cobertura de respuestas', () => {
    const activar = analysis.workflows[0].coverage.find((c) => c.stepId === 'activar')!
    expect(activar.rows.map((r) => [r.status, r.kind])).toEqual([
      ['200', 'exito'],
      ['400', 'accion'],
      ['401', 'sin-manejo'],
      ['404', 'accion'],
      ['422', 'accion'],
    ])
  })

  it('error de red explicado', async () => {
    const run = await runWorkflow(project!, analysis, 'consultar-tarjeta', {
      ...base(4599),
      inputs: { cardId: 'CARD-1000' },
    })
    expect(run.steps[0].reason?.category).toBe('red')
  })
})

describe('datos por caso', () => {
  it('genera CPF y RUT válidos y resuelve plantillas', async () => {
    const { generateCpf, isValidCpf, resolveTemplates } = await import('./templates')
    for (let i = 0; i < 50; i++) expect(isValidCpf(generateCpf())).toBe(true)
    expect(isValidCpf('12345678901')).toBe(false)
    const r = resolveTemplates({ a: '{{email}}', b: 'doc-{{numero:4}}', c: '{{desconocido}}', d: 5 })
    expect(r.a).toMatch(/^prueba\+.+@example\.com$/)
    expect(r.b).toMatch(/^doc-\d{4}$/)
    expect(r.c).toBe('{{desconocido}}')
    expect(r.d).toBe(5)
  })

  it('aplica base, cambios del caso y datos propios en orden', async () => {
    const { applyCaseInputs, dataSummary, runnability } = await import('./testcases')
    const tc: any = { id: 'x', workflowId: 'w', title: 't', origin: 'escenario', description: '', scenario: { stepId: 's', status: 422, bodyValues: [] }, dataMode: 'real', expectation: { type: 'action', text: '' }, enabled: true }
    expect(runnability(tc, 'real').ok).toBe(false)
    tc.inputOverrides = { last4Digits: '9999', vacio: '' }
    expect(runnability(tc, 'real').ok).toBe(true)
    expect(applyCaseInputs(tc, { last4Digits: '4321', customerId: 'C1' })).toEqual({ last4Digits: '9999', customerId: 'C1' })
    expect(dataSummary(tc)).toBe('por defecto + last4Digits = 9999')
    tc.omitInputs = ['customerId']
    expect(applyCaseInputs(tc, { last4Digits: '4321', customerId: 'C1' })).toEqual({ last4Digits: '9999' })
    expect(dataSummary(tc)).toBe('por defecto + last4Digits = 9999, sin customerId')
  })

  it('caso con datos propios contra el mock real, e importación/exportación', async () => {
    const mock = await startMock(false, 4521)
    try {
      const { project } = buildProject(files)
      const analysis = analyzeProject(project!)
      const { createDataCase, applyCaseInputs, evaluateCase, generateTestCases } = await import('./testcases')
      const { exportScenarios, importScenarios } = await import('./scenariosFile')
      const base = { customerId: 'CUST-1', productCode: 'LATAM_PASS_VISA', requestedLimit: 1500, last4Digits: '4321' }
      const tc = createDataCase({
        workflowId: 'onboarding-tarjeta',
        title: 'Dígitos incorrectos',
        inputOverrides: { last4Digits: '9999' },
        stepId: 'activar',
        statuses: [422],
        code: 'DIGITS_MISMATCH',
        actionName: 'digitosIncorrectos',
      })
      const opts = {
        credentials: { 'creditCards:bearerAuth': 'token-demo' },
        servers: { creditCards: 'http://localhost:4521' },
        executor: fetchExecutor,
      }
      const run = await runWorkflow(project!, analysis, tc.workflowId, { ...opts, inputs: applyCaseInputs(tc, base) })
      expect(evaluateCase(tc, run).verdict).toBe('passed')

      // El mismo escenario por respuesta, ahora contra la API real con sus datos
      const scenario = generateTestCases(analysis.workflows[0]).find((c) => c.id.endsWith('digitosIncorrectos'))!
      const real = { ...scenario, dataMode: 'real' as const, inputOverrides: { last4Digits: '0000' } }
      const run2 = await runWorkflow(project!, analysis, real.workflowId, { ...opts, inputs: applyCaseInputs(real, base) })
      expect(run2.steps.some((s) => s.simulated)).toBe(false)
      expect(evaluateCase(real, run2).verdict).toBe('passed')

      const yaml = exportScenarios({ bases: { 'onboarding-tarjeta': base }, cases: [tc, real] })
      const generated = generateTestCases(analysis.workflows[0])
      const imported = importScenarios(yaml, generated, ['onboarding-tarjeta', 'consultar-tarjeta'])
      expect(imported.errors).toEqual([])
      expect(imported.bases['onboarding-tarjeta']).toEqual(base)
      expect(imported.cases.find((c) => c.id === real.id)).toMatchObject({ dataMode: 'real', inputOverrides: { last4Digits: '0000' } })
      expect(imported.cases.filter((c) => c.origin === 'datos')[0]).toMatchObject({ title: 'Dígitos incorrectos', expectation: { code: 'DIGITS_MISMATCH', statuses: [422] } })
    } finally {
      mock.kill()
    }
  })
})

describe('reporte', () => {
  it('oculta tokens y credenciales y arma el HTML', async () => {
    const { maskDeep, buildHtmlReport } = await import('./report')
    const masked = maskDeep({ access_token: 'ffdd9cde-3fe1', basicAuthCredential: 'ZjdkOGQ0YTM=', nested: { clientSecret: 'abcdefgh' }, customerName: 'Maria' })
    expect(masked.access_token).not.toContain('9cde')
    expect(masked.basicAuthCredential).not.toContain('OGQ0')
    expect(masked.nested.clientSecret).toBe('ab••••gh')
    expect(masked.customerName).toBe('Maria')
    const html = buildHtmlReport({
      arazzoTitle: 'Demo <x>',
      generatedAt: new Date('2026-10-22T12:00:00Z'),
      servers: { creditCards: 'http://localhost:4010' },
      cases: [
        {
          tc: { id: 'a', workflowId: 'w', title: 'Camino feliz', origin: 'arazzo', description: '', expectation: { type: 'success', text: 'ok' }, enabled: true },
          verdict: 'passed',
          explanation: 'Todo bien',
          steps: [],
          inputsUsed: { accessToken: 'secreto-largo-123', nombre: 'Maria' },
        },
      ],
    })
    expect(html).toContain('Demo &lt;x&gt;')
    expect(html).toContain('Pasó')
    expect(html).not.toContain('secreto-largo-123')
  })
})
