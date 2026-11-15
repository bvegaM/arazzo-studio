// "Nuevo request", como el "Create new" de Postman: HTTP, GraphQL, gRPC, WebSocket o pegar un cURL.
import { useEffect, useState } from 'react'
import type { RequestKind } from '../../core/requests'
import { Icon } from '../components/kit'
import { t } from '../../i18n'

const KINDS: { kind: RequestKind; icon: string; badge: string; cls: string }[] = [
  { kind: 'http', icon: 'M4 7h16M4 12h16M4 17h10', badge: 'HTTP', cls: 'm-get' },
  { kind: 'graphql', icon: 'M12 2l8.66 5v10L12 22l-8.66-5V7L12 2zM12 2v20M3.34 7l17.32 10M20.66 7L3.34 17', badge: 'GQL', cls: 'm-gql' },
  { kind: 'grpc', icon: 'M4 6h6v6H4zM14 12h6v6h-6zM10 9h4v6', badge: 'gRPC', cls: 'm-grpc' },
  { kind: 'websocket', icon: 'M4 8h11l-3-3M20 16H9l3 3', badge: 'WS', cls: 'm-ws' },
]

export function NewRequestDialog({
  onCreate,
  onCurl,
  onClose,
  isDesktop,
  startWithCurl,
  onCreateArazzo,
}: {
  onCreate: (kind: RequestKind) => void
  /** Devuelve el error si el texto no es un cURL válido. */
  onCurl: (command: string) => string | undefined
  onClose: () => void
  isDesktop: boolean
  startWithCurl?: boolean
  /** Crear un flujo Arazzo (un journey de varios pasos) en vez de un request suelto. */
  onCreateArazzo?: () => void
}) {
  const [curl, setCurl] = useState<string | undefined>(startWithCurl ? '' : undefined)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="welcome-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome-dialog nr-dialog" role="dialog" aria-label={t('request.new.title')}>
        <div className="prefs-head">
          <h3>{curl === undefined ? t('request.new.title') : t('request.new.curlTitle')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <Icon d="M6 6l12 12M18 6L6 18" size={14} />
          </button>
        </div>
        {curl === undefined ? (
          <>
            <div className="nr-grid">
              {KINDS.map((k) => (
                <button key={k.kind} className="nr-card" data-kind={k.kind} onClick={() => onCreate(k.kind)}>
                  <span className={`nr-icon ${k.cls}`}>
                    <Icon d={k.icon} size={22} />
                  </span>
                  <strong>{t(`request.kind.${k.kind}`)}</strong>
                  <span className="muted small">{t(`request.kind.${k.kind}.hint`)}</span>
                  {k.kind === 'grpc' && !isDesktop && <span className="nr-tag">{t('request.new.desktopOnly')}</span>}
                </button>
              ))}
            </div>
            {onCreateArazzo && (
              <button className="nr-curl-btn nr-arazzo" data-kind="arazzo" onClick={onCreateArazzo}>
                <span className="nr-icon m-arazzo">
                  <Icon d="M4 6h7v5H4zM13 13h7v5h-7zM7.5 11v4.5H13" size={18} />
                </span>
                <span className="grow">
                  <strong>{t('request.new.arazzo')}</strong>
                  <span className="muted small">{t('request.new.arazzoHint')}</span>
                </span>
              </button>
            )}
            <button className="nr-curl-btn" data-kind="curl" onClick={() => setCurl('')}>
              <span className="nr-icon m-curl">
                <Icon d="M4 17l6-6-6-6M12 19h8" size={18} />
              </span>
              <span className="grow">
                <strong>{t('request.new.fromCurl')}</strong>
                <span className="muted small">{t('request.new.fromCurlHint')}</span>
              </span>
            </button>
          </>
        ) : (
          <form
            className="nr-curl"
            onSubmit={(e) => {
              e.preventDefault()
              setError(onCurl(curl))
            }}
          >
            <p className="muted small">{t('request.new.curlLead')}</p>
            <textarea
              autoFocus
              value={curl}
              spellCheck={false}
              placeholder={"curl 'https://pokeapi.co/api/v2/pokemon/pikachu' \\\n  -H 'accept: application/json'"}
              onChange={(e) => {
                setCurl(e.target.value)
                setError(undefined)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  setError(onCurl(curl))
                }
              }}
            />
            {error && <div className="callout err small">{error}</div>}
            <div className="ob-actions">
              <button type="button" className="link" onClick={() => setCurl(undefined)}>
                {t('ws.welcome.back')}
              </button>
              <span className="spacer" />
              <button className="primary" type="submit" disabled={!curl.trim()}>
                {t('request.new.import')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
