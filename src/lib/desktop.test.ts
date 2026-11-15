import { describe, expect, it } from 'vitest'
import { createDesktopExecutor, type DesktopBridge } from './desktop'
import { NetworkError } from '../core/http'
import { setLocale } from '../i18n'

setLocale('es')

/** Puente falso: responde con `reply` y registra lo que pide la app. */
function fakeBridge(reply: Awaited<ReturnType<DesktopBridge['request']>>) {
  const calls: { requests: Parameters<DesktopBridge['request']>[0][]; aborted: string[] } = { requests: [], aborted: [] }
  const bridge: DesktopBridge = {
    platform: 'darwin',
    request: async (req) => {
      calls.requests.push(req)
      return reply
    },
    abort: (id) => calls.aborted.push(id),
    grpcDescribe: async () => ({ ok: true, services: [] }),
    grpcInvoke: async () => ({ ok: false, error: 'n/a', durationMs: 0 }),
    grpcCancel: () => {},
    ntlmRequest: async () => ({ ok: false, aborted: false, error: 'n/a', durationMs: 0 }),
    oauth2Authorize: async () => ({ ok: false, error: 'n/a' }),
    openFolder: async () => undefined,
    writeFile: async (path) => path,
    saveAs: async () => undefined,
    wsPickFolder: async () => undefined,
    wsList: async () => [],
    wsRead: async () => undefined,
    wsWrite: async () => {},
    wsRemove: async () => {},
    wsRemoveDir: async () => {},
    wsDefaultLocation: async () => '/tmp',
    wsPickLocation: async () => undefined,
    wsCreateAt: async (parent, folder) => `${parent}/${folder}`,
    wsReveal: async () => {},
    wsTrash: async () => {},
    secretGet: async () => undefined,
    secretSet: async () => {},
    secretRemove: async () => {},
    secretRemovePrefix: async () => {},
    appSetTheme: async () => {},
    appToggleDevTools: async () => {},
    appMetrics: async () => ({ cpu: 0, memory: 0, uptime: 0, pid: 1, processes: [] }),
    appIsFullscreen: async () => false,
    onFullscreen: () => () => {},
    onShortcut: () => () => {},
    termCreate: async () => ({ id: '1', cwd: '/tmp', shell: 'zsh' }),
    termWrite: () => {},
    termResize: () => {},
    termKill: async () => {},
    onTermData: () => () => {},
    onTermExit: () => () => {},
  }
  return { bridge, calls }
}

describe('ejecutor HTTP de la app de escritorio', () => {
  it('pasa la petición al proceso principal y devuelve su respuesta', async () => {
    const { bridge, calls } = fakeBridge({ ok: true, status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, bodyText: '{"id":1}', durationMs: 12 })
    const res = await createDesktopExecutor(bridge)({ method: 'post', url: 'https://api.example.com/members', headers: { Authorization: 'Bearer x' }, body: '{}' })
    expect(res).toEqual({ status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, bodyText: '{"id":1}', durationMs: 12 })
    expect(calls.requests[0]).toMatchObject({ method: 'POST', url: 'https://api.example.com/members', headers: { Authorization: 'Bearer x' }, body: '{}' })
  })

  it('explica un error de red con la causa real', async () => {
    const { bridge } = fakeBridge({ ok: false, aborted: false, error: 'ECONNREFUSED', durationMs: 3 })
    const run = createDesktopExecutor(bridge)({ method: 'get', url: 'http://localhost:9', headers: {} })
    await expect(run).rejects.toBeInstanceOf(NetworkError)
    await expect(run).rejects.toThrow('ECONNREFUSED')
  })

  it('cancelar la ejecución cancela la petición en el proceso principal', async () => {
    const { bridge, calls } = fakeBridge({ ok: false, aborted: true, error: 'AbortError', durationMs: 1 })
    const controller = new AbortController()
    const request = bridge.request
    bridge.request = async (req) => {
      controller.abort()
      return request(req)
    }
    await expect(createDesktopExecutor(bridge)({ method: 'get', url: 'https://api.example.com', headers: {} }, controller.signal)).rejects.toThrow('cancelada')
    expect(calls.aborted).toEqual([calls.requests[0].id])
  })
})
