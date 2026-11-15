import { describe, expect, it } from 'vitest'
import type { Environment } from './environments'
import {
  environmentPath,
  isCollectionContentPath,
  parseCollection,
  parseEnvironment,
  parseWorkspace,
  scenariosPath,
  serializeCollection,
  serializeEnvironment,
  serializeWorkspace,
  slugify,
  uniqueFolder,
} from './workspaceFormat'

describe('formato del workspace en disco', () => {
  it('workspace y colección se escriben y se leen igual', () => {
    const ws = { id: 'ws-1', name: 'Partners LatAm', collections: ['cobrand', 'pay-with-miles'] }
    expect(parseWorkspace(serializeWorkspace(ws))).toEqual(ws)
    expect(parseCollection(serializeCollection({ name: 'Cobrand' }), 'x')).toEqual({ name: 'Cobrand' })
    expect(parseCollection('', 'carpeta')).toEqual({ name: 'carpeta' })
  })

  it('un ambiente guarda URLs, variables y color, pero nunca valores secretos ni credenciales', () => {
    const env: Environment = {
      id: 'e1',
      name: 'Prod (LatAm)',
      color: 'red',
      servers: { members: 'https://api.example.com' },
      credentials: { 'members:bearerAuth': 'token-ultra-secreto' },
      variables: [
        { name: 'clientId', value: 'cli-123', secret: false },
        { name: 'apiKey', value: 'clave-privada', secret: true },
      ],
    }
    const text = serializeEnvironment(env)
    expect(text).not.toContain('token-ultra-secreto')
    expect(text).not.toContain('clave-privada')
    expect(environmentPath(env)).toBe('environments/prod-latam.yaml')
    const back = parseEnvironment(text, 'x')
    expect(back).toMatchObject({ name: 'Prod (LatAm)', color: 'red', servers: env.servers, credentials: {} })
    expect(back.variables).toEqual([
      { name: 'clientId', value: 'cli-123', secret: false },
      { name: 'apiKey', value: '', secret: true },
    ])
  })

  it('distingue el contenido de la colección de los datos de Arazzo Studio', () => {
    expect(isCollectionContentPath('cobrand.arazzo.yaml')).toBe(true)
    expect(isCollectionContentPath('contracts/members.json')).toBe(true)
    expect(isCollectionContentPath('collection.yaml')).toBe(false)
    expect(isCollectionContentPath('environments/prod.yaml')).toBe(false)
    expect(isCollectionContentPath(scenariosPath('cobrand.arazzo.yaml'))).toBe(false)
    expect(isCollectionContentPath('README.md')).toBe(false)
  })

  it('nombres de carpeta y archivo seguros y sin repetir', () => {
    expect(slugify('Pay with Miles ✈')).toBe('pay-with-miles')
    expect(uniqueFolder('Cobrand', ['cobrand', 'cobrand-2'])).toBe('cobrand-3')
  })
})
