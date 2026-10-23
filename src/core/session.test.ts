import { describe, expect, it } from 'vitest'
import { readSavedSession, SESSION_VERSION, toSavedSession, type SessionState } from './session'
import type { TestCase } from './testcases'

const state: SessionState = {
  title: 'Demo',
  files: [{ name: 'a.arazzo.yaml', text: 'arazzo: 1.0.1' }],
  attachments: [],
  remotes: [],
  inputs: { wf: { customerId: 'C1', password: 'p4ss', nested: { apiKey: 'k', ok: 1 } } },
  cases: [{ id: 'c1', inputOverrides: { token: 't', limit: 5 } } as unknown as TestCase],
  skipped: ['otro'],
  selected: 'wf',
  mode: 'real',
  screen: 3,
  environments: [{ id: 'e1', name: 'QA', servers: { api: 'https://qa' }, credentials: { 'api:bearer': 'secreto' } }],
  activeEnv: 'e1',
}

describe('sesión guardada', () => {
  const saved = toSavedSession(state, new Date('2026-10-23T12:00:00Z'))

  it('no guarda credenciales ni valores sensibles', () => {
    const text = JSON.stringify(saved)
    for (const secret of ['secreto', 'p4ss', '"k"', '"t"']) expect(text).not.toContain(secret)
    expect(saved.inputs.wf).toEqual({ customerId: 'C1', nested: { ok: 1 } })
    expect(saved.cases[0].inputOverrides).toEqual({ limit: 5 })
    expect(saved.environments).toEqual([{ id: 'e1', name: 'QA', servers: { api: 'https://qa' } }])
  })

  it('guarda versión y fecha', () => {
    expect(saved.version).toBe(SESSION_VERSION)
    expect(saved.savedAt).toBe('2026-10-23T12:00:00.000Z')
  })

  it('solo acepta sesiones de esta versión y con archivos', () => {
    expect(readSavedSession(saved)).toBe(saved)
    expect(readSavedSession({ ...saved, version: 0 })).toBeUndefined()
    expect(readSavedSession({ ...saved, files: [] })).toBeUndefined()
    expect(readSavedSession(undefined)).toBeUndefined()
  })
})
