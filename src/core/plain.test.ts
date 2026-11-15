/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { plainCriterion, plainExpression, summarizeRuns } from './plain'
import { evaluateCase, type CaseRun, type TestCase } from './testcases'
import { setLocale } from '../i18n'

setLocale('es')

describe('criterios en lenguaje simple', () => {
  it('traduce status, comparaciones y combinaciones', () => {
    expect(plainCriterion({ condition: '$statusCode == 200' })).toBe('La API responde 200 (OK)')
    expect(plainCriterion({ condition: '$statusCode == 200 && $response.body#/capture_rate >= 0' })).toBe(
      'La API responde 200 (OK) y el dato «capture rate» de la respuesta es al menos 0',
    )
    expect(plainCriterion({ condition: "$response.body#/status == 'ACTIVE'" })).toBe('El dato «status» de la respuesta es «ACTIVE»')
    expect(plainCriterion({ condition: '$response.header.X-Request-Id != null' })).toBe('El header «X-Request-Id» no es vacío')
  })

  it('traduce JSONPath, regex y XPath sin mostrar la expresión', () => {
    expect(plainCriterion({ context: '$response.body', condition: '$.abilities[?(@.is_hidden == false)]', type: 'jsonpath' })).toBe(
      'La respuesta incluye «abilities» con la condición esperada',
    )
    expect(plainCriterion({ context: '$response.body', condition: '$.damage_relations.double_damage_to[0]', type: 'jsonpath' })).toBe(
      'La respuesta incluye «damage relations › double damage to»',
    )
    expect(plainCriterion({ context: '$response.body#/email', condition: '^\\S+@\\S+$', type: 'regex' })).toBe(
      'El dato «email» de la respuesta tiene el formato esperado',
    )
    expect(plainCriterion({ context: '$response.body', condition: '//pokemon/name', type: 'xpath' })).toBe('La respuesta incluye «pokemon › name»')
  })

  it('si no entiende la regla, una frase genérica', () => {
    expect(plainCriterion({ condition: '$steps.a.outputs.b == $inputs.c || foo' })).toBe('Se cumple la regla técnica del paso')
    expect(plainCriterion({ condition: '$response.body#/id == $inputs.id' })).toBe('El dato «id» de la respuesta es el input «id»')
  })

  it('expresiones de runtime en palabras', () => {
    expect(plainExpression('$inputs.pokemon')).toBe('El input «pokemon»')
    expect(plainExpression('$steps.getPokemon.outputs.mainType')).toBe('El dato «main type» del paso «get pokemon»')
    expect(plainExpression('pikachu')).toBe('pikachu')
  })
})

const tc = (over: Partial<TestCase>): TestCase =>
  ({ id: over.title ?? 'x', workflowId: 'wf', title: 'x', origin: 'arazzo', description: '', enabled: true, expectation: { type: 'success', text: '' }, ...over }) as TestCase
const run = (over: Partial<CaseRun>): CaseRun => ({ tc: tc({}), state: 'done', steps: [], ...over }) as CaseRun

describe('veredicto de una ejecución', () => {
  const main = tc({ title: 'Camino feliz' })
  const missing = tc({ title: 'Sin el input "pokemon"', origin: 'schema', expectation: { type: 'failure', stepId: 'getPokemon', statuses: [404], text: '' } })

  it('una validación de datos que la API no rechaza es advertencia, no falla', () => {
    const result = { status: 'failed', steps: [{ stepId: 'getPokemon', status: 'failed', response: { status: 200 } }], actions: [] } as any
    expect(evaluateCase(missing, result).verdict).toBe('warning')
    // La misma expectativa en un caso de seguridad sí es una falla.
    expect(evaluateCase({ ...missing, origin: 'security' }, result).verdict).toBe('failed')
  })

  it('el flujo principal funciona, con advertencias', () => {
    const s = summarizeRuns([run({ tc: main, verdict: 'passed' }), run({ tc: missing, verdict: 'warning' })])!
    expect(s.tone).toBe('warn')
    expect(s.headline).toBe('El flujo principal funciona.')
    expect(s.points[0]).toContain('«Sin el input "pokemon"»')
  })

  it('todo bien', () => {
    expect(summarizeRuns([run({ tc: main, verdict: 'passed' }), run({ tc: missing, verdict: 'passed' })])).toMatchObject({
      tone: 'ok',
      headline: 'El flujo principal funciona y todas las comprobaciones salieron como se esperaba.',
    })
  })

  it('el flujo principal se detiene en un paso', () => {
    const s = summarizeRuns([run({ tc: main, verdict: 'failed', steps: [{ stepId: 'getSpecies', status: 'failed' } as any] })])!
    expect(s).toMatchObject({ tone: 'err', headline: 'El flujo principal no funciona: se detiene en el paso «get species».' })
  })

  it('sin resumen mientras corre', () => {
    expect(summarizeRuns([run({ tc: main, state: 'running' })])).toBeUndefined()
  })
})
