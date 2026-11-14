import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { attachToCollection, buildCollection, parseFile } from './loader'
import { analyzeProject } from './analyze'
import { caseJourney, collectionCases, collectionCredentials, journeyKey, listJourneys, migrateLegacySession, splitJourneyKey } from './collection'
import type { TestCase } from './testcases'
import { setLocale } from '../i18n'

setLocale('es')

const read = (path: string) => readFileSync(new URL(`../../examples/${path}`, import.meta.url), 'utf8')
const cards = ['credit-cards/card-onboarding.arazzo.yaml', 'credit-cards/credit-cards.yaml']
const miles = ['miles-transfer/miles-transfer.arazzo.yaml', 'miles-transfer/members.yaml', 'miles-transfer/member-schemas.yaml', 'miles-transfer/miles-events.asyncapi.yaml']
const parse = (paths: string[]) => paths.map((p) => parseFile({ name: p, text: read(p) }))

function collection(files = parse([...cards, ...miles])) {
  const { projects, errors } = buildCollection(files)
  const analyses = Object.fromEntries(projects.map((p) => [p.arazzoFileName, analyzeProject(p)]))
  return { projects, analyses, errors, journeys: listJourneys(projects, analyses) }
}

describe('colección con varios Arazzo', () => {
  it('arma un proyecto por Arazzo, cada uno con sus contratos', () => {
    const { projects, errors, journeys } = collection()
    expect(errors).toEqual([])
    expect(projects.map((p) => p.arazzoFileName)).toEqual(['credit-cards/card-onboarding.arazzo.yaml', 'miles-transfer/miles-transfer.arazzo.yaml'])
    for (const p of projects) expect(p.sources.every((s) => s.status === 'loaded')).toBe(true)
    expect(journeys.map((j) => j.key)).toEqual([
      'credit-cards/card-onboarding.arazzo.yaml#onboarding-tarjeta',
      'credit-cards/card-onboarding.arazzo.yaml#consultar-tarjeta',
      'miles-transfer/miles-transfer.arazzo.yaml#enrollAndTransfer',
    ])
  })

  it('dos archivos con el mismo workflowId no chocan', () => {
    const copy = parseFile({ name: 'otro/miles-copia.arazzo.yaml', text: read(miles[0]) })
    const { journeys } = collection([...parse(miles), copy])
    const keys = journeys.map((j) => j.key)
    expect(keys).toEqual(['miles-transfer/miles-transfer.arazzo.yaml#enrollAndTransfer', 'otro/miles-copia.arazzo.yaml#enrollAndTransfer'])
    const cases = collectionCases(journeys, [])
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
    expect(new Set(cases.map(caseJourney))).toEqual(new Set(keys))
  })

  it('conserva lo que el usuario cambió en los casos y descarta los de journeys que ya no están', () => {
    const { journeys } = collection()
    const first = collectionCases(journeys, [])
    const own: TestCase = { ...first[0], id: 'propio', origin: 'datos', arazzo: 'borrado.arazzo.yaml' }
    const again = collectionCases(journeys, [{ ...first[0], enabled: false }, own])
    expect(again[0].enabled).toBe(false)
    expect(again.some((c) => c.id === 'propio')).toBe(false)
  })

  it('las credenciales y la adjunción de contratos son de toda la colección', () => {
    const files = parse([...cards, ...miles]).filter((f) => f.name !== 'credit-cards/credit-cards.yaml')
    const { projects, analyses } = collection(files)
    expect(projects[0].sources[0].status).toBe('missing')
    const attached = attachToCollection(projects, 'creditCards', parse([cards[1]])[0])
    expect(attached[0].sources[0].status).toBe('loaded')
    expect(collectionCredentials(Object.values(analyses)).map((c) => c.key)).toContain('members:bearerAuth')
  })

  it('migra una sesión anterior a las colecciones al primer Arazzo', () => {
    const file = 'a.arazzo.yaml'
    const legacy = { inputs: { wf: { x: 1 } }, cases: [{ id: 'wf::happy', workflowId: 'wf' } as TestCase], selected: 'wf' }
    const migrated = migrateLegacySession(file, legacy)
    expect(migrated.inputs).toEqual({ [journeyKey(file, 'wf')]: { x: 1 } })
    expect(migrated.cases[0]).toMatchObject({ id: 'a.arazzo.yaml::wf::happy', arazzo: file })
    expect(splitJourneyKey(migrated.selected)).toEqual({ file, workflowId: 'wf' })
  })
})
