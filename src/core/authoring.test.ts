import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { attachSource, buildProject, parseFile, replaceArazzo } from './loader'
import { analyzeProject } from './analyze'
import { issueRanges, suggest, yamlProblems } from './authoring'
import { setLocale } from '../i18n'

setLocale('es')

const dir = new URL('../../test/fixtures/miles-transfer/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const ARAZZO = read('miles-transfer.arazzo.yaml')
const files = ['miles-transfer.arazzo.yaml', 'members.yaml', 'member-schemas.yaml', 'miles-events.asyncapi.yaml'].map((name) =>
  parseFile({ name, text: read(name) }),
)
const project = buildProject(files).project!

/** Sugerencias con el cursor donde está la marca "|". */
function at(text: string) {
  const pos = text.indexOf('|')
  return suggest(text.replace('|', ''), pos, project)
}

describe('editor: problemas en el texto', () => {
  it('ubica los errores de sintaxis YAML', () => {
    const problems = yamlProblems('arazzo: 1.1.0\ninfo: [sin cerrar\n')
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0].level).toBe('error')
  })

  it('subraya el valor que cita el problema y, si no, el stepId', () => {
    const text = ARAZZO.replace('operationId: $sourceDescriptions.members.getMember', 'operationId: $sourceDescriptions.members.noExiste')
    const p = replaceArazzo(project, parseFile({ name: 'x.yaml', text }))
    const a = analyzeProject(p)
    const ranges = issueRanges(text, a.workflows.flatMap((w) => w.issues))
    const missing = ranges.find((r) => r.level === 'error')!
    expect(text.slice(missing.from, missing.to)).toBe('$sourceDescriptions.members.noExiste')
  })
})

describe('editor: sugerencias', () => {
  it('operationId: todas las operaciones de los contratos, HTTP y AsyncAPI', () => {
    const s = at('workflows:\n  - workflowId: w\n    steps:\n      - stepId: a\n        operationId: |')!
    const labels = s.options.map((o) => o.label)
    expect(labels).toContain('$sourceDescriptions.members.createMember')
    expect(labels).toContain('$sourceDescriptions.milesEvents.requestTransfer')
    expect(s.options.find((o) => o.label.endsWith('createMember'))!.detail).toBe('POST /members')
  })

  it('$steps y $inputs del workflow donde está el cursor', () => {
    const text = ARAZZO.replace('value: $steps.createMember.outputs.memberId', 'value: $steps.createMember.outputs.|')
    expect(at(text)!.options.map((o) => o.label)).toEqual(['$steps.createMember.outputs.memberId'])
    const steps = at(ARAZZO.replace('value: $inputs.correlationId', 'value: $steps.|'))!
    expect(steps.options.map((o) => o.label)).toContain('$steps.awaitTransfer.outputs.')
    const inputs = at(ARAZZO.replace('value: $inputs.correlationId', 'value: $inputs.|'))!
    expect(inputs.options.map((o) => o.label)).toEqual(['$inputs.email', '$inputs.firstName', '$inputs.miles', '$inputs.partner', '$inputs.correlationId'])
  })

  it('channelPath, action y dependsOn', () => {
    const channel = at(ARAZZO.replace(/channelPath: .*/, 'channelPath: |'))!
    expect(channel.options.map((o) => o.detail)).toEqual(['miles.transfer.requested', 'miles.transfer.result'])
    expect(at(ARAZZO.replace('action: receive', 'action: |'))!.options.map((o) => o.label)).toEqual(['send', 'receive'])
    const deps = at(ARAZZO.replace('dependsOn: [requestTransfer]', 'dependsOn: [|'))!
    expect(deps.options.map((o) => o.label)).toEqual(['createMember', 'requestTransfer', 'awaitTransfer', 'getMember'])
    const list = at(ARAZZO.replace('dependsOn: [requestTransfer]', 'dependsOn:\n          - |'))!
    expect(list.options.map((o) => o.label)).toContain('requestTransfer')
  })

  it('reemplaza solo lo escrito', () => {
    const text = 'x: $inp'
    const s = suggest(text, text.length, project)!
    expect(s.from).toBe(3)
    expect(s.options.map((o) => o.label)).toEqual(['$inputs.'])
  })
})

describe('editor: reemplazar el Arazzo', () => {
  it('conserva los contratos adjuntados a mano', () => {
    const renamed = ARAZZO.replace('url: ./members.yaml', 'url: ./otro-nombre.yaml')
    const base = buildProject(files.map((f) => (f.name === 'miles-transfer.arazzo.yaml' ? parseFile({ name: f.name, text: renamed }) : f))).project!
    const attached = attachSource(base, 'members', files.find((f) => f.name === 'members.yaml')!)
    expect(attached.sources.find((s) => s.name === 'members')!.status).toBe('loaded')
    const edited = replaceArazzo(attached, parseFile({ name: 'miles-transfer.arazzo.yaml', text: renamed.replace('Traspaso de millas', 'Traspaso editado') }))
    expect(edited.arazzo.info.title).toBe('Traspaso editado')
    expect(edited.sources.find((s) => s.name === 'members')!.status).toBe('loaded')
  })
})
