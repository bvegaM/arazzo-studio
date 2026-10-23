import { afterEach, describe, expect, it } from 'vitest'
import { es } from './locales/es'
import { en } from './locales/en'
import { joinOr, setLocale, t, type MessageKey } from '.'

// Los generadores {{...}} son texto literal, no parámetros.
const placeholders = (s: string) => [...s.replace(/\{\{[^}]*\}\}/g, '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n', () => {
  afterEach(() => setLocale('es'))

  it('en tiene las mismas claves que es', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
  })

  it('cada traducción usa los mismos parámetros que el original', () => {
    for (const key of Object.keys(es) as MessageKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(es[key]))
    }
  })

  it('traduce e interpola en el idioma actual', () => {
    setLocale('es')
    expect(t('tc.missing.title', { name: 'id' })).toBe('Sin el input obligatorio "id"')
    expect(joinOr([400, 422])).toBe('400 o 422')
    setLocale('en')
    expect(t('tc.missing.title', { name: 'id' })).toBe('Without the required input "id"')
    expect(joinOr([400, 422])).toBe('400 or 422')
  })

  it('deja vacíos los parámetros sin valor', () => {
    setLocale('es')
    expect(t('ev.notRun', { step: undefined })).toBe('No se ejecutó "".')
  })
})
