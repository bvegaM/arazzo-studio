import { describe, expect, it } from 'vitest'
import { exampleValue, fieldKind, invalidPaths, leavesFirst, missingInputs, normalizeSchema, setKey, validateValue, valueSummary } from './schemaForm'
import { defaultInputs } from './testcases'
import { setLocale } from '../i18n'

setLocale('es')

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

describe('validación en vivo', () => {
  it('revisa patrón, longitudes, números y formatos', () => {
    expect(validateValue({ type: 'string', pattern: '^[0-9]{4}$' }, '12a4')).toBe('No cumple el patrón ^[0-9]{4}$')
    expect(validateValue({ type: 'string', pattern: '^[0-9]{4}$' }, '1234')).toBeUndefined()
    expect(validateValue({ type: 'string', minLength: 3 }, 'ab')).toBe('Debe tener al menos 3 caracteres')
    expect(validateValue({ type: 'integer', minimum: 1 }, 0)).toBe('Debe ser mayor o igual a 1')
    expect(validateValue({ type: 'integer' }, 1.5)).toBe('Debe ser un número entero')
    expect(validateValue({ type: 'number', exclusiveMaximum: 10 }, 10)).toBe('Debe ser menor que 10')
    expect(validateValue({ type: 'string', format: 'email' }, 'ana@')).toBe('No es un correo válido')
    expect(validateValue({ type: 'string', format: 'date' }, '2026-10-23')).toBeUndefined()
    expect(validateValue({ type: 'string', format: 'date' }, '23/10/2026')).toBe('Usa el formato AAAA-MM-DD')
    expect(validateValue({ type: 'array', minItems: 1, items: {} }, ['a'])).toBeUndefined()
  })

  it('no revisa vacíos ni generadores, y tolera patrones inválidos', () => {
    expect(validateValue({ type: 'string', format: 'email' }, '{{email}}')).toBeUndefined()
    expect(validateValue({ type: 'string', minLength: 3 }, undefined)).toBeUndefined()
    expect(validateValue({ type: 'string', pattern: '([' }, 'x')).toBeUndefined()
  })

  it('lista las rutas inválidas en objetos y listas', () => {
    const s = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        dir: { type: 'object', properties: { postal: { type: 'string', pattern: '^\\d{5}$' } } },
        tags: { type: 'array', maxItems: 1, items: { type: 'string', minLength: 2 } },
      },
    }
    expect(invalidPaths(s, { email: 'x', dir: { postal: '123' }, tags: ['a', 'bb'] })).toEqual(['email', 'dir.postal', 'tags', 'tags[0]'])
  })
})
