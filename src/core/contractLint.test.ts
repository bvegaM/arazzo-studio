import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { contractOutline, contractProblems, lintContract, pathRange } from './contractLint'
import { buildCollection, parseFile, replaceFileInCollection } from './loader'
import { setLocale } from '../i18n'

setLocale('es')

const openapi = `openapi: 3.0.3
info:
  title: Members
  version: 1.0.0
paths:
  /members/{memberId}:
    get:
      operationId: getMember
      parameters:
        - name: memberId
          in: path
          required: true
          schema:
            $ref: '#/components/schemas/Id'
      responses:
        '200':
          description: ok
  /members:
    post:
      operationId: getMember
      responses:
        '201':
          description: created
components:
  schemas:
    Id:
      type: string
`

describe('revisión de contratos', () => {
  it('marca operationId repetidos y los ubica en el texto', () => {
    const issues = lintContract(YAML.parse(openapi))
    const dup = issues.find((i) => i.message.includes('repetido'))
    expect(dup?.path).toEqual(['paths', '/members', 'post', 'operationId'])
    const [p] = contractProblems(openapi, [dup!])
    expect(openapi.slice(p.from, p.to)).toBe('operationId: getMember')
    expect(p.from).toBeGreaterThan(openapi.indexOf('/members:'))
  })

  it('detecta parámetros de ruta sin declarar y $ref internos rotos', () => {
    const doc = YAML.parse(openapi.replace("'#/components/schemas/Id'", "'#/components/schemas/Nope'").replace('/members:', '/members/{tier}:'))
    const messages = lintContract(doc).map((i) => i.message)
    expect(messages.some((m) => m.includes('{tier}'))).toBe(true)
    expect(messages.some((m) => m.includes('#/components/schemas/Nope'))).toBe(true)
  })

  it('un contrato correcto no tiene errores', () => {
    const doc = YAML.parse(openapi.replace('operationId: getMember\n      responses', 'operationId: createMember\n      responses'))
    expect(lintContract(doc).filter((i) => i.level === 'error')).toEqual([])
  })

  it('lista las operaciones de OpenAPI y AsyncAPI 3', () => {
    expect(contractOutline(YAML.parse(openapi)).map((o) => `${o.method} ${o.target}`)).toEqual(['GET /members/{memberId}', 'POST /members'])
    const asyncDoc = {
      asyncapi: '3.0.0',
      info: { title: 'x', version: '1' },
      channels: { result: { address: 'miles.transfer.result' } },
      operations: { onResult: { action: 'receive', channel: { $ref: '#/channels/result' } }, bad: { action: 'listen', channel: {} } },
    }
    expect(contractOutline(asyncDoc)[0]).toMatchObject({ method: 'RECEIVE', target: 'miles.transfer.result', operationId: 'onResult' })
    expect(lintContract(asyncDoc).filter((i) => i.level === 'error').map((i) => i.path)).toEqual([
      ['operations', 'bad'],
      ['operations', 'bad'],
    ])
  })

  it('ubica la ruta más cercana si la exacta no existe', () => {
    const [from] = pathRange(openapi, ['paths', '/members', 'post', 'noExiste'])
    expect(openapi.slice(from).startsWith('post:')).toBe(true)
  })
})

describe('editar un contrato de la colección', () => {
  const arazzo = `arazzo: 1.0.1
info: { title: t, version: '1' }
sourceDescriptions:
  - name: members
    url: ./members.yaml
    type: openapi
workflows:
  - workflowId: w
    steps:
      - stepId: s
        operationId: getMember
`
  it('reemplaza el contrato en las fuentes que lo usan y conserva el resto', () => {
    const files = [parseFile({ name: 'flow.arazzo.yaml', text: arazzo }), parseFile({ name: 'members.yaml', text: openapi })]
    const { projects } = buildCollection(files)
    expect(projects[0].sources[0].status).toBe('loaded')
    const edited = parseFile({ name: 'members.yaml', text: openapi.replace('title: Members', 'title: Members v2') })
    const next = replaceFileInCollection(projects, edited)
    expect(next[0].sources[0].doc.info.title).toBe('Members v2')
    const broken = replaceFileInCollection(projects, parseFile({ name: 'members.yaml', text: 'openapi: [' }))
    expect(broken[0].sources[0].status).toBe('error')
    // Corregido otra vez, vuelve a cargarse.
    expect(replaceFileInCollection(broken, edited)[0].sources[0].status).toBe('loaded')
  })
})
