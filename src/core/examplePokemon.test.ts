// El ejemplo de la PokéAPI (examples/pokemon) carga sin errores y sus journeys pasan en simulación.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { analyzeProject } from './analyze'
import { lintContract } from './contractLint'
import { buildCollection, parseFile } from './loader'
import { runDependencies, runWorkflow } from './runner'
import { createSimulatedExecutor } from './simulator'
import { generateTestCases } from './testcases'
import { collectionDocsMarkdown } from './collectionDocs'
import { listJourneys } from './collection'
import type { HttpExecutor } from './http'
import { setLocale } from '../i18n'

setLocale('es')

const read = (name: string) => readFileSync(new URL(`../../examples/pokemon/${name}`, import.meta.url), 'utf8')
const files = ['pokemon.arazzo.yaml', 'pokeapi.openapi.yaml', 'pokedex-events.asyncapi.yaml'].map((name) => parseFile({ name, text: read(name) }))

describe('ejemplo de la PokéAPI', () => {
  const { projects, errors } = buildCollection(files)
  const project = projects[0]
  const analysis = analyzeProject(project)

  it('carga el contrato y no tiene errores de análisis ni de contrato', () => {
    expect(errors).toEqual([])
    expect(project.sources[0].status).toBe('loaded')
    const problems = [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)].filter((i) => i.level === 'error')
    expect(problems).toEqual([])
    expect(lintContract(YAML.parse(read('pokeapi.openapi.yaml'))).filter((i) => i.level === 'error')).toEqual([])
  })

  it.each(['pokemonCard', 'typeExplorer', 'battleMatchup', 'registerSighting'])('el journey %s pasa en simulación', async (workflowId) => {
    const steps = project.arazzo.workflows.find((w) => w.workflowId === workflowId)!.steps
    const inputs: Record<string, Record<string, unknown>> = {
      pokemonCard: { pokemon: 'pikachu' },
      typeExplorer: { type: 'fire' },
      battleMatchup: {},
      registerSighting: { pokemon: 'pikachu', trainer: 'Ash', correlationId: 'c-1' },
    }
    // battleMatchup depende de typeExplorer: corre antes y deja sus outputs en $workflows.
    const deps = await runDependencies(project, analysis, workflowId, {
      credentials: {},
      servers: {},
      executor: createSimulatedExecutor(project, []),
      executorFor: (id) => createSimulatedExecutor(project, project.arazzo.workflows.find((w) => w.workflowId === id)!.steps),
      inputsFor: (id) => inputs[id] ?? {},
    })
    expect(deps.error).toBeUndefined()
    const run = await runWorkflow(project, analysis, workflowId, { inputs: inputs[workflowId], credentials: {}, servers: {}, executor: createSimulatedExecutor(project, steps), workflowOutputs: deps.outputs })
    // Los pasos de mensajería quedan 'warning' (simulados) también con la API real; aquí todo es simulación.
    expect(run.steps.map((s) => [s.stepId, s.status === 'warning' ? 'success' : s.status])).toEqual(steps.map((s) => [s.stepId, 'success']))
  })

  it('si falta un input que va en la ruta, espera 400 o 404 y explica la URL que queda', async () => {
    const wa = analysis.workflows.find((w) => w.workflow.workflowId === 'typeExplorer')!
    const missing = generateTestCases(wa).find((c) => c.omitInput === 'type')!
    expect(missing.expectation).toMatchObject({ type: 'failure', stepId: 'getType', statuses: [404] })
    expect(missing.description).toContain('/type/')
    // Como la PokéAPI real: /type/ devuelve la lista de tipos con 200.
    const listing: HttpExecutor = async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: '{"count":21,"results":[]}', durationMs: 1 })
    const run = await runWorkflow(project, analysis, 'typeExplorer', { inputs: {}, credentials: {}, servers: {}, executor: listing })
    expect(run.steps[0].reason?.message).toContain('https://pokeapi.co/api/v2/type/')
  })

  it('genera la documentación de la colección', () => {
    const journeys = listJourneys([project], { [project.arazzoFileName]: analysis })
    const md = collectionDocsMarkdown({ name: 'Pokédex', version: '1.0.0', journeys, sources: project.sources, environments: [{ name: 'local', servers: { pokeapi: 'https://pokeapi.co/api/v2' } }] })
    expect(md).toContain('# Pokédex')
    expect(md).toContain('### Pokemon card')
    expect(md).toContain('1. **getPokemon** — GET `/pokemon/{idOrName}`')
    expect(md).toContain('`pokemon`*')
    expect(md).toContain('pokeapi → `https://pokeapi.co/api/v2`')
  })
})
