import { describe, expect, it } from 'vitest'
import { humanizeId } from './format'

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
