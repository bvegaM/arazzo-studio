/* eslint-disable @typescript-eslint/no-explicit-any */
// Vista previa del contrato con Swagger UI (la misma de Swagger Editor). Se carga al abrirla.
// "Try it out" no sale desde el navegador: cada petición pasa por el ejecutor de la app (en
// escritorio, el proceso principal, sin CORS), con el servidor y las credenciales del ambiente.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HttpRequest, HttpResponse } from '../../core/http'
import { t } from '../../i18n'
import { Empty } from './kit'

export interface PreviewCredential {
  schemeName: string
  type: string
  value: string
}

interface Props {
  /** Contrato OpenAPI ya armado (con los $ref a otros archivos resueltos). */
  spec: any
  /** URL del ambiente activo para este contrato: se agrega primera en "Servers". */
  envServer?: { url: string; envName: string }
  /** Credenciales del ambiente que Swagger UI deja autorizadas desde el inicio. */
  credentials: PreviewCredential[]
  onRequest: (req: HttpRequest) => Promise<HttpResponse>
  /** Valores secretos del ambiente: se tapan (••••) en el cURL que muestra Swagger UI. */
  secrets: string[]
}

/** El contrato con el servidor del ambiente primero en la lista. */
function withEnvServer(spec: any, env: Props['envServer']): any {
  if (!env?.url || !spec || typeof spec !== 'object') return spec
  const servers: any[] = Array.isArray(spec.servers) ? spec.servers : []
  const rest = servers.filter((s) => s?.url !== env.url)
  return { ...spec, servers: [{ url: env.url, description: t('swagger.envServer', { env: env.envName }) }, ...rest] }
}

/** Ajustes de la vista previa dentro del Shadow DOM (márgenes como en Swagger Editor). */
const PREVIEW_CSS = `
:host { display: block; }
.swagger-ui { font-family: sans-serif; color: #3b4151; }
.swagger-ui .wrapper { padding: 0 20px; }
.swagger-ui .information-container .info { margin: 24px 0 16px; }
`

function headersOf(init: any): Record<string, string> {
  const h = init?.headers
  if (!h) return {}
  if (typeof h.forEach === 'function' && !(h instanceof Array)) {
    const out: Record<string, string> = {}
    h.forEach((v: string, k: string) => (out[k] = v))
    return out
  }
  return Object.fromEntries(Object.entries<any>(h).map(([k, v]) => [k, String(v)]))
}

export function SwaggerPreview(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ui = useRef<any>(null)
  const [failed, setFailed] = useState<string>()
  const latest = useRef(p)
  useLayoutEffect(() => {
    latest.current = p
  })

  // Las peticiones de "Try it out" pasan por la app.
  const userFetch = async (url: string, init: any): Promise<Response> => {
    const body = init?.body
    const res = await latest.current.onRequest({
      method: String(init?.method ?? 'GET').toUpperCase(),
      url,
      headers: headersOf(init),
      body: typeof body === 'string' ? body : body === undefined || body === null ? undefined : String(body),
    })
    const noBody = res.status === 204 || res.status === 205 || res.status === 304
    return new Response(noBody ? null : res.bodyText, { status: res.status, statusText: res.statusText, headers: res.headers })
  }

  // El cURL de "Try it out" lleva las credenciales: se muestran tapadas, como en el resto de la app.
  const mask = (text: string) => latest.current.secrets.reduce((s, secret) => (secret ? s.split(secret).join('••••') : s), text)
  const maskRequest = (req: any) =>
    req && typeof req.update === 'function'
      ? req
          .update('url', (u: unknown) => (typeof u === 'string' ? mask(u) : u))
          .update('headers', (h: any) => (h && typeof h.map === 'function' ? h.map((v: unknown) => (typeof v === 'string' ? mask(v) : v)) : h))
          .update('body', (b: unknown) => (typeof b === 'string' ? mask(b) : b))
      : req
  const maskPlugin = () => ({
    wrapComponents: {
      curl: (Original: any, system: any) => (props: any) => system.React.createElement(Original, { ...props, request: maskRequest(props.request) }),
      RequestSnippets: (Original: any, system: any) => (props: any) => system.React.createElement(Original, { ...props, request: maskRequest(props.request) }),
    },
  })

  const authorize = () => {
    const instance = ui.current
    if (!instance) return
    for (const c of latest.current.credentials) {
      if (!c.value) continue
      if (c.type === 'basic') {
        const i = c.value.indexOf(':')
        instance.preauthorizeBasic(c.schemeName, i < 0 ? c.value : c.value.slice(0, i), i < 0 ? '' : c.value.slice(i + 1))
      } else instance.preauthorizeApiKey(c.schemeName, c.value.replace(/^Bearer\s+/i, ''))
    }
  }

  useEffect(() => {
    let disposed = false
    const shadowHost = host.current
    // Swagger UI va en un Shadow DOM con su propio CSS: se ve igual que la original y los estilos
    // de la app no la tocan (ni ella a la app).
    const shadow = shadowHost ? (shadowHost.shadowRoot ?? shadowHost.attachShadow({ mode: 'open' })) : undefined
    let node: HTMLDivElement | undefined
    void (async () => {
      try {
        const [{ default: SwaggerUI }, { default: css }] = await Promise.all([import('swagger-ui-dist/swagger-ui-es-bundle.js'), import('swagger-ui-dist/swagger-ui.css?inline')])
        if (disposed || !shadow) return
        const style = document.createElement('style')
        style.textContent = `${css}\n${PREVIEW_CSS}`
        node = document.createElement('div')
        shadow.replaceChildren(style, node)
        ui.current = SwaggerUI({
          domNode: node,
          spec: withEnvServer(latest.current.spec, latest.current.envServer),
          deepLinking: false,
          docExpansion: 'list',
          defaultModelsExpandDepth: 1,
          displayRequestDuration: true,
          tryItOutEnabled: false,
          persistAuthorization: false,
          syntaxHighlight: { activated: true, theme: 'agate' },
          requestInterceptor: (req: any) => {
            req.userFetch = userFetch
            return req
          },
          onComplete: authorize,
          plugins: [maskPlugin],
        })
      } catch (e) {
        setFailed((e as Error).message)
      }
    })()
    return () => {
      disposed = true
      ui.current = null
      shadow?.replaceChildren()
    }
    // Se monta una sola vez; los cambios llegan por los efectos de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El contrato cambia mientras se edita: Swagger UI se actualiza sin perder lo desplegado.
  useEffect(() => {
    const instance = ui.current
    if (!instance || !p.spec) return
    instance.specActions.updateJsonSpec(withEnvServer(p.spec, p.envServer))
    authorize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.spec, p.envServer?.url, p.envServer?.envName])

  useEffect(() => {
    authorize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.credentials.map((c) => `${c.schemeName}=${c.value}`).join('|')])

  if (failed) return <Empty>{t('swagger.failed', { error: failed })}</Empty>
  return <div className="swagger-host" ref={host} />
}
