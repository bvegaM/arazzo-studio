import { describe, expect, it } from 'vitest'
import { fillServers, newEnvironment, uniqueName } from './environments'

describe('ambientes', () => {
  it('crea ambientes con id propio, copiando URLs y sin credenciales', () => {
    const a = newEnvironment('QA', { api: 'https://qa' })
    const b = newEnvironment('QA', a.servers)
    expect(a.id).not.toBe(b.id)
    expect(b).toMatchObject({ name: 'QA', servers: { api: 'https://qa' }, credentials: {} })
    expect(b.servers).not.toBe(a.servers)
  })

  it('genera nombres sin repetir', () => {
    expect(uniqueName('QA', ['DEV'])).toBe('QA')
    expect(uniqueName('QA', ['qa', 'QA 2'])).toBe('QA 3')
  })

  it('completa URLs faltantes sin pisar las del usuario', () => {
    const env = { ...newEnvironment('DEV'), servers: { api: 'http://mio' } }
    const [filled] = fillServers([env], { api: 'https://contrato', otra: 'https://otra' })
    expect(filled.servers).toEqual({ api: 'http://mio', otra: 'https://otra' })
    expect(fillServers([filled], { api: 'x' })[0]).toBe(filled)
  })
})
