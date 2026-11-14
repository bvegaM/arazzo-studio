import { useRef, useState } from 'react'
import type { SavedSession } from '../../core/session'
import type { ExampleId } from '../../app/example'
import { timeAgo } from '../../core/format'
import { t } from '../../i18n'

interface Props {
  errors: string[]
  onFiles: (files: File[]) => void
  onExample: (id: ExampleId) => void
  /** Solo en la app de escritorio: abrir una carpeta con el Arazzo y sus contratos. */
  onOpenFolder?: () => void
  savedSession?: SavedSession
  onRestore: () => void
  onDiscard: () => void
}

/** Aviso para continuar la sesión anterior: qué era, cuándo fue y qué no se guardó. */
function ResumeBanner({ session, onRestore, onDiscard }: { session: SavedSession; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div className="resume" role="region" aria-label={t('session.title')}>
      <div className="resume-icon" aria-hidden="true">
        ↺
      </div>
      <div className="resume-text">
        <strong>{t('session.title')}</strong>
        <span>
          {session.title ?? session.files[0].name} · {t('nav.files', { n: session.files.length })} · {timeAgo(new Date(session.savedAt))}
        </span>
        <span className="muted small">{t('session.noCredentials')}</span>
      </div>
      <div className="resume-actions">
        <button className="primary" onClick={onRestore}>
          {t('session.continue')}
        </button>
        <button className="ghost" onClick={onDiscard}>
          {t('session.discard')}
        </button>
      </div>
    </div>
  )
}

/** Pantalla inicial, sin colección abierta: abrir una carpeta o archivos, o probar un ejemplo. */
export function Welcome(p: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="brand-mark big" aria-hidden="true">
          A
        </div>
        <h1>Arazzo Studio</h1>
        <p>{t('ws.welcome.tagline')}</p>
      </div>

      {p.savedSession && <ResumeBanner session={p.savedSession} onRestore={p.onRestore} onDiscard={p.onDiscard} />}

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          p.onFiles([...e.dataTransfer.files])
        }}
      >
        <div className="dropzone-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24">
            <path d="M12 16V4m0 0l-5 5m5-5l5 5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div className="big">{t(p.onOpenFolder ? 'ws.welcome.dropDesktop' : 'load.drop')}</div>
          <div className="muted small">{t('load.dropHint')}</div>
        </div>
        <div className="row">
          {p.onOpenFolder && (
            <button className="primary" onClick={p.onOpenFolder} title={t('load.openFolderHint')}>
              {t('load.openFolder')}
            </button>
          )}
          <button className={p.onOpenFolder ? undefined : 'primary'} onClick={() => input.current?.click()}>
            {t('load.choose')}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".yaml,.yml,.json"
          hidden
          onChange={(e) => {
            p.onFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>

      {p.errors.length > 0 && (
        <div className="callout err">
          {p.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <div className="welcome-examples">
        <span className="muted small">{t('ws.welcome.examples')}</span>
        <button onClick={() => p.onExample('cards')}>{t('load.example')}</button>
        <button onClick={() => p.onExample('miles')} title={t('load.exampleMilesHint')}>
          {t('load.exampleMiles')}
        </button>
      </div>

      <ol className="how-it-works" aria-label={t('load.how.title')}>
        {([1, 2, 3] as const).map((n) => (
          <li key={n}>
            <span className="how-num" aria-hidden="true">
              {n}
            </span>
            <div>
              <strong>{t(`ws.how.${n}.title`)}</strong>
              <p>{t(`ws.how.${n}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
