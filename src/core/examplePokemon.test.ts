// El ejemplo de la PokéAPI (examples/pokemon) carga sin errores y sus journeys pasan en simulación.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { analyzeProject } from './analyze'
import { lintContract } from './contractLint'
import { buildCollection, parseFile } from './loader'
import { runWorkflow } from './runner'
import { createSimulatedExecutor } from './simulator'
import { setLocale } from '../i18n'

setLocale('es')

const read = (name: string) => readFileSync(new URL(`../../examples/pokemon/${name}`, import.meta.url), 'utf8')
const files = ['pokemon.arazzo.yaml', 'pokeapi.openapi.yaml'].map((name) => parseFile({ name, text: read(name) }))

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

  it.each(['pokemonCard', 'typeExplorer'])('el journey %s pasa en simulación', async (workflowId) => {
    const steps = project.arazzo.workflows.find((w) => w.workflowId === workflowId)!.steps
    const inputs = workflowId === 'pokemonCard' ? { pokemon: 'pikachu' } : { type: 'fire' }
    const run = await runWorkflow(project, analysis, workflowId, { inputs, credentials: {}, servers: {}, executor: createSimulatedExecutor(project, steps) })
    expect(run.steps.map((s) => [s.stepId, s.status])).toEqual(steps.map((s) => [s.stepId, 'success']))
  })
})
