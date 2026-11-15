import { describe, expect, it } from 'vitest'
import { analyzeProject } from './analyze'
import { evaluateCriterion } from './criteria'
import { evaluateSelector, type ExprContext } from './expressions'
import { buildCollection, parseFile } from './loader'
import { runWorkflow } from './runner'
import { loadXPath, replaceXPath, selectXPath } from './xpath'
import type { HttpExecutor, HttpRequest } from './http'
import { setLocale } from '../i18n'

setLocale('es')
await loadXPath()

const XML = `<?xml version="1.0"?>
<order id="A-17"><status>CONFIRMED</status><items><item sku="X1">2</item><item sku="Y9">1</item></items></order>`

const ctx = (body: string): ExprContext => ({ inputs: {}, steps: {}, workflows: {}, sourceUrls: {}, response: { status: 200, headers: {}, body } })

describe('XPath 1.0', () => {
  it('selecciona elementos, atributos y valores escalares', () => {
    expect(selectXPath(XML, '/order/status')).toMatchObject({ found: true, value: 'CONFIRMED', count: 1 })
    expect(selectXPath(XML, '/order/@id').value).toBe('A-17')
    expect(selectXPath(XML, 'count(//item)').value).toBe(2)
    expect(selectXPath(XML, "//item[@sku='Z']").found).toBe(false)
    expect(selectXPath('{"no":"xml"}', '/a').found).toBe(false)
  })

  it('criterio xpath sobre el body', () => {
    const ok = evaluateCriterion({ context: '$response.body', condition: "/order[status='CONFIRMED']", type: 'xpath' }, ctx(XML))
    expect(ok.passed).toBe(true)
    const v30 = evaluateCriterion({ context: '$response.body', condition: '//item[@sku="Z"]', type: { type: 'xpath', version: 'xpath-30' } as any }, ctx(XML))
    expect(v30.passed).toBe(false)
    expect(v30.detail).toContain('no encontró')
    const notXml = evaluateCriterion({ context: '$response.body', condition: '/a', type: 'xpath' }, ctx('{"a":1}'))
    expect(notXml.detail).toContain('no es XML')
  })

  it('selector xpath en un output', () => {
    expect(evaluateSelector({ context: '$response.body', selector: '/order/items/item[2]/@sku', type: 'xpath' }, ctx(XML)).value).toBe('Y9')
  })

  it('reemplaza nodos de un payload XML', () => {
    const r = replaceXPath('<req><user>x</user></req>', '/req/user', 'ana')
    expect(r).toEqual({ xml: '<req><user>ana</user></req>', count: 1 })
  })

  it('un journey SOAP con criterio, output y reemplazo XPath', async () => {
    const openapi = `openapi: 3.0.3
info: { title: Orders, version: '1' }
servers: [{ url: https://soap.example.com }]
paths:
  /orders:
    post:
      operationId: createOrder
      requestBody: { content: { application/xml: { schema: { type: string } } } }
      responses: { '200': { description: ok, content: { application/xml: { schema: { type: string } } } } }
`
    const arazzo = `arazzo: 1.1.0
info: { title: t, version: '1' }
sourceDescriptions: [{ name: orders, url: ./orders.yaml, type: openapi }]
workflows:
  - workflowId: w
    inputs: { type: object, properties: { customer: { type: string } } }
    steps:
      - stepId: create
        operationId: createOrder
        requestBody:
          contentType: application/xml
          payload: '<order><customer>?</customer></order>'
          replacements:
            - target: /order/customer
              targetSelectorType: xpath
              value: $inputs.customer
        successCriteria:
          - context: $response.body
            condition: /order[status='CONFIRMED']
            type: xpath
        outputs:
          orderId:
            context: $response.body
            selector: /order/@id
            type: xpath
`
    const { projects } = buildCollection([parseFile({ name: 'a.arazzo.yaml', text: arazzo }), parseFile({ name: 'orders.yaml', text: openapi })])
    let sent: HttpRequest | undefined
    const executor: HttpExecutor = async (req) => {
      sent = req
      return { status: 200, statusText: 'OK', headers: { 'content-type': 'application/xml' }, bodyText: XML, durationMs: 1 }
    }
    const run = await runWorkflow(projects[0], analyzeProject(projects[0]), 'w', { inputs: { customer: 'Ana' }, credentials: {}, servers: {}, executor })
    expect(sent?.body).toBe('<order><customer>Ana</customer></order>')
    expect(run.steps[0].status).toBe('success')
    expect(run.steps[0].outputs.orderId).toBe('A-17')
  })
})
