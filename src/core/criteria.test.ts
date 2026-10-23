import { describe, expect, it } from 'vitest'
import { evaluateCriterion, findKeyPointer, regexFieldMismatches } from './criteria'
import type { ExprContext } from './expressions'
import { setLocale } from '../i18n'

setLocale('es')

const body = { cardId: 'c1', status: 'INACTIVE', limits: { daily: 100 } }
const ctx = { inputs: {}, steps: {}, workflows: {}, sourceUrls: {}, statusCode: 200, response: { status: 200, headers: {}, body } } as unknown as ExprContext

describe('diferencias de un criterio', () => {
  it('condición simple: campo, esperado, recibido y ruta', () => {
    const r = evaluateCriterion({ condition: "$response.body#/status == 'ACTIVE'" }, ctx)
    expect(r.passed).toBe(false)
    expect(r.mismatches).toEqual([{ subject: '$response.body#/status', pointer: '/status', op: '==', expected: 'ACTIVE', actual: 'INACTIVE' }])
  })

  it('status code: sin ruta en el body', () => {
    const r = evaluateCriterion({ condition: '$statusCode == 201' }, ctx)
    expect(r.mismatches).toEqual([{ subject: '$statusCode', pointer: undefined, op: '==', expected: 201, actual: 200 }])
  })

  it('regex sobre el body: explica con los campos que pide el patrón', () => {
    const r = evaluateCriterion({ condition: '^\\{.*"status":"ACTIVE"', context: '$response.body', type: 'regex' }, ctx)
    expect(r.passed).toBe(false)
    expect(r.detail).toBe('"status" vale "INACTIVE" y se esperaba "ACTIVE"')
    expect(r.mismatches).toEqual([{ subject: 'status', pointer: '/status', op: '==', expected: 'ACTIVE', actual: 'INACTIVE' }])
  })

  it('regex sin pares reconocibles: diferencia general', () => {
    const r = evaluateCriterion({ condition: '^xyz', context: '$response.body', type: 'regex' }, ctx)
    expect(r.mismatches?.[0]).toMatchObject({ subject: '$response.body', pointer: '', op: 'regex' })
  })

  it('busca campos anidados e ignora valores con comodines', () => {
    expect(findKeyPointer(body, 'daily')).toBe('/limits/daily')
    expect(regexFieldMismatches('"daily":200', body)).toEqual([{ subject: 'daily', pointer: '/limits/daily', op: '==', expected: 200, actual: 100 }])
    expect(regexFieldMismatches('"status":"ACT.*"', body)).toEqual([])
  })

  it('sin diferencias cuando se cumple', () => {
    expect(evaluateCriterion({ condition: "$response.body#/status == 'INACTIVE'" }, ctx).mismatches).toBeUndefined()
  })
})
