// Panel guiado cuando la API no respondió: qué revisar, los headers CORS exactos y salidas rápidas.
import { useState } from 'react'
import { corsHeadersFor, isMixedContent, targetOrigins, type FailedRequest } from '../../core/cors'
import { t } from '../../i18n'
import { tn } from '../../i18n/react'
import { copyText } from '../../lib/browser'

interface Props {
  requests: FailedRequest[]
  caseCount: number
  onSimulate: () => void
  onEditEnvironment: () => void
}

export function ConnectionHelp({ requests, caseCount, onSimulate, onEditEnvironment }: Props) {
  const [copied, setCopied] = useState(false)
  const [hidden, setHidden] = useState(false)
  if (hidden || !requests.length) return null

  const origin = window.location.origin
  const targets = targetOrigins(requests)
  const headers = corsHeadersFor(requests, origin)
  const mixed = requests.some((r) => isMixedContent(window.location.protocol, r.url))

  return (
    <section className="conn-help" aria-labelledby="conn-help-title">
      <div className="conn-head">
        <span className="conn-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015.3-2.8M19 13a10 10 0 00-2.4-1.8M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0011.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <div className="grow">
          <h3 id="conn-help-title">{t('conn.title')}</h3>
          <p>{tn('conn.lead', { n: <strong>{caseCount}</strong>, targets: <code>{targets.join(', ')}</code> })}</p>
        </div>
        <button className="icon-btn" onClick={() => setHidden(true)} title={t('common.close')} aria-label={t('common.close')}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <ol className="conn-steps">
        <li>
          <strong>{t('conn.check1.title')}</strong>
          <span>{t('conn.check1.text')}</span>
          <span className="conn-links">
            {targets.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {t('conn.open', { url: u })} ↗
              </a>
            ))}
          </span>
        </li>
        {mixed && (
          <li>
            <strong>{t('conn.mixed.title')}</strong>
            <span>{t('conn.mixed.text')}</span>
          </li>
        )}
        <li>
          <strong>{t('conn.check2.title')}</strong>
          <span>{tn('conn.check2.text', { origin: <code>{origin}</code> })}</span>
          <div className="conn-code">
            <pre>{headers}</pre>
            <button
              className="small"
              onClick={async () => {
                setCopied(await copyText(headers))
                setTimeout(() => setCopied(false), 1600)
              }}
            >
              {copied ? `✓ ${t('results.copied')}` : t('conn.copyHeaders')}
            </button>
          </div>
        </li>
      </ol>

      <div className="conn-actions">
        <button className="primary" onClick={onSimulate}>
          {t('conn.simulate')}
        </button>
        <button onClick={onEditEnvironment}>{t('conn.editEnv')}</button>
        <span className="muted small">{t('conn.curlTip')}</span>
      </div>
    </section>
  )
}
