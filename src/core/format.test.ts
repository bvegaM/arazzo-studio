import { describe, expect, it } from 'vitest'
import { humanizeId, timeAgo } from './format'
import { setLocale } from '../i18n'

describe('humanizeId', () => {
  it.each([
    ['startCobrandedLifeCycle', 'Start cobranded life cycle'],
    ['consultCobrandedLifeCycleStatus', 'Consult cobranded life cycle status'],
    ['getHTTPStatus', 'Get HTTP status'],
    ['create_user-v2', 'Create user v2'],
    ['createUserV2', 'Create user V2'],
    ['apply-card', 'Apply card'],
    ['PING', 'PING'],
    ['', ''],
  ])('%s → %s', (id, text) => {
    expect(humanizeId(id)).toBe(text)
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  it('usa la unidad más grande que corresponde', () => {
    setLocale('es')
    expect(timeAgo(new Date('2026-10-23T10:00:00Z'), now)).toBe('hace 2 horas')
    expect(timeAgo(new Date('2026-10-22T12:00:00Z'), now)).toBe('ayer')
    expect(timeAgo(new Date('2026-10-23T11:59:40Z'), now)).toBe('hace un momento')
    setLocale('en')
    expect(timeAgo(new Date('2026-10-23T11:55:00Z'), now)).toBe('5 minutes ago')
    setLocale('es')
  })
})
