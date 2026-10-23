import { describe, expect, it } from 'vitest'
import { corsHeadersFor, isMixedContent, targetOrigins, type FailedRequest } from './cors'

const requests: FailedRequest[] = [
  { method: 'post', url: 'https://api.test/cards?x=1', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ••••', Accept: '*/*' } },
  { method: 'GET', url: 'https://api.test/cards/1', headers: { Authorization: 'Bearer ••••', 'X-Channel': 'WEB' } },
]

describe('ayuda de CORS', () => {
  it('arma los headers con métodos y headers usados', () => {
    expect(corsHeadersFor(requests, 'http://localhost:5173')).toBe(
      'Access-Control-Allow-Origin: http://localhost:5173\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\nAccess-Control-Allow-Headers: Content-Type, Authorization, X-Channel',
    )
  })

  it('lista los orígenes destino sin repetir', () => {
    expect(targetOrigins(requests)).toEqual(['https://api.test'])
  })

  it('detecta contenido mixto', () => {
    expect(isMixedContent('https:', 'http://api')).toBe(true)
    expect(isMixedContent('http:', 'http://api')).toBe(false)
  })
})
