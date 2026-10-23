import { describe, expect, it } from 'vitest'
import { exampleValue, fieldKind, leavesFirst, missingInputs, normalizeSchema, setKey, valueSummary } from './schemaForm'
import { defaultInputs } from './testcases'

const schema = {
  type: 'object',
  required: ['cliente'],
  properties: {
    cliente: {
      type: 'object',
      required: ['nombre', 'direccion'],
      properties: {
        nombre: { type: 'string', example: 'Ana' },
        direccion: {
          type: 'object',
          required: ['calle'],
          properties: { calle: { type: 'string' }, numero: { type: 'integer', example: 10 } },
        },
      },
    },
    items: { type: 'array', items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } } },
    extra: { type: 'object' },
  },
}

describe('formulario por esquema', () => {
  it('elige el control según el tipo', () => {
    expect(fieldKind(schema.properties.cliente)).toBe('object')
    expect(fieldKind(schema.properties.items)).toBe('array')
    expect(fieldKind(schema.properties.extra)).toBe('json')
    expect(fieldKind({ type: ['integer', 'null'] })).toBe('number')
    expect(fieldKind({ properties: { a: {} } })).toBe('object')
  })

  it('une allOf', () => {
    const s = normalizeSchema({ allOf: [{ properties: { a: {} }, required: ['a'] }, { properties: { b: {} } }] })
    expect(Object.keys(s.properties)).toEqual(['a', 'b'])
    expect(s.required).toEqual(['a'])
  })

  it('setKey quita vacíos y devuelve undefined si no queda nada', () => {
    expect(setKey({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 })
    expect(setKey({ a: 1 }, 'a', '')).toBeUndefined()
  })

  it('arma valores por defecto anidados con los ejemplos', () => {
    expect(exampleValue(schema.properties.cliente)).toEqual({ nombre: 'Ana', direccion: { numero: 10 } })
    expect(defaultInputs(schema)).toEqual({ cliente: { nombre: 'Ana', direccion: { numero: 10 } } })
  })

  it('lista los obligatorios anidados que faltan', () => {
    expect(missingInputs(schema, {})).toEqual(['cliente'])
    expect(missingInputs(schema, { cliente: { nombre: 'Ana', direccion: { numero: 1 } } })).toEqual(['cliente.direccion.calle'])
    expect(missingInputs(schema, { cliente: { nombre: 'A', direccion: { calle: 'X' } }, items: [{ sku: 'a' }, {}] })).toEqual(['items[1].sku'])
  })
})

describe('resúmenes del formulario', () => {
  it('pone los campos simples antes que los grupos', () => {
    expect(leavesFirst(Object.entries(schema.properties)).map(([k]) => k)).toEqual(['extra', 'cliente', 'items'])
  })

  it('resume valores anidados', () => {
    expect(valueSummary({ nombre: 'Ana', direccion: { calle: 'X' }, tags: [1, 2], vacio: '' })).toBe('nombre: Ana · direccion: {…} · tags: [2]')
    expect(valueSummary({ a: 1, b: 2, c: 3, d: 4 })).toBe('a: 1 · b: 2 · c: 3 · …')
    expect(valueSummary(['x', '', 'y'])).toBe('x · y')
  })
})
