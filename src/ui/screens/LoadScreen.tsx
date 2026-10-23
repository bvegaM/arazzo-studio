import { useRef, useState } from 'react'
import type { ParsedFile, Project } from '../../core/loader'
import { isRemote } from '../../core/loader'
import type { SavedSession } from '../../core/session'
import { timeAgo } from '../../core/format'
import { t } from '../../i18n'
import { ActionBar, PageHeader, Section } from '../components/kit'

interface Props {
  files: ParsedFile[]
  project?: Project
  errors: string[]
  onFiles: (files: File[]) => void
  onAttach: (sourceName: string, file: File) => void
  onFetchRemote: (sourceName: string) => void
  onExample: () => void
  onReset: () => void
  onNext: () => void
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

const KIND_LABEL = { arazzo: 'Arazzo', openapi: 'OpenAPI' }

export function LoadScreen(p: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sources = p.project?.sources ?? []
  const missing = sources.filter((s) => s.status !== 'loaded')

  return (
    <>
      <PageHeader
        step={1}
        title={t('load.title')}
        description={t('load.description')}
        actions={p.files.length > 0 && <button onClick={p.onReset}>{t('load.reset')}</button>}
      />

      {p.savedSession && !p.project && <ResumeBanner session={p.savedSession} onRestore={p.onRestore} onDiscard={p.onDiscard} />}

      <div
        className={`dropzone ${over ? 'over' : ''} ${p.files.length ? 'compact' : ''}`}
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
          <div className="big">{p.files.length ? t('load.addMore') : t('load.drop')}</div>
          <div className="muted small">{t('load.dropHint')}</div>
        </div>
        <div className="row">
          <button className="primary" onClick={() => input.current?.click()}>
            {t('load.choose')}
          </button>
          {!p.files.length && (
            <button className="ghost" onClick={p.onExample}>
              {t('load.example')}
            </button>
          )}
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

      {!p.files.length && (
        <ol className="how-it-works" aria-label={t('load.how.title')}>
          {([1, 2, 3] as const).map((n) => (
            <li key={n}>
              <span className="how-num" aria-hidden="true">
                {n}
              </span>
              <div>
                <strong>{t(`load.how.${n}.title`)}</strong>
                <p>{t(`load.how.${n}.text`)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {p.errors.length > 0 && (
        <div className="callout err">
          {p.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {p.project && (
        <div className="project-card">
          <div>
            <div className="eyebrow">{t('load.loaded')}</div>
            <div className="project-title">{p.project.arazzo.info?.title ?? p.project.arazzoFileName}</div>
            <div className="muted small">
              {p.project.arazzoFileName} · {t('load.version', { version: String(p.project.arazzo.arazzo) })} · {t('nav.workflows', { n: p.project.arazzo.workflows?.length ?? 0 })}
            </div>
          </div>
          <span className={`badge ${missing.length ? 'b-err' : 'b-ok'}`}>
            {missing.length ? `✕ ${t('load.missingContracts', { n: missing.length })}` : `✓ ${t('load.contractsComplete')}`}
          </span>
        </div>
      )}

      {p.project && (
        <Section
          title={t('load.sourcesTitle')}
          badges={<span className="badge b-skip">{sources.length - missing.length}/{sources.length}</span>}
          subtitle={missing.length ? t('load.missingList', { names: missing.map((s) => s.name).join(', ') }) : t('load.allLinked')}
          defaultOpen={missing.length > 0}
          tone={missing.length ? 'err' : undefined}
        >
          <ul className="list">
            {sources.map((s) => (
              <li key={s.name}>
                <span className={`badge ${s.status === 'loaded' ? 'b-ok' : 'b-err'}`}>
                  {s.status === 'loaded' ? `✓ ${t('load.status.loaded')}` : s.status === 'missing' ? `✕ ${t('load.status.missing')}` : `✕ ${t('load.status.error')}`}
                </span>
                <div className="grow">
                  <strong>{s.name}</strong>
                  <div className="muted small">
                    <code>{s.url}</code>
                    {s.fileName && s.status === 'loaded' && <> ← {s.fileName}</>}
                  </div>
                  {s.error && <div className="small" style={{ color: 'var(--err)' }}>{s.error}</div>}
                </div>
                {s.status !== 'loaded' && (
                  <div className="row">
                    <label className="button-like">
                      {t('load.upload')}
                      <input
                        type="file"
                        accept=".yaml,.yml,.json"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) p.onAttach(s.name, f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {isRemote(s.url) && <button onClick={() => p.onFetchRemote(s.name)}>{t('load.fetch')}</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.files.length > 0 && (
        <Section title={t('load.detected')} badges={<span className="badge b-skip">{p.files.length}</span>} subtitle={p.files.map((f) => f.name).join(' · ')}>
          <ul className="list">
            {p.files.map((f) => (
              <li key={f.name}>
                <span className={`badge ${f.kind === 'unknown' ? 'b-err' : 'b-accent'}`}>{f.kind === 'unknown' ? t('load.unknownKind') : KIND_LABEL[f.kind]}</span>
                <code className="grow">{f.name}</code>
                {f.doc?.info?.title && <span className="muted small">{f.doc.info.title}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.project && (
        <ActionBar
          info={missing.length ? t('load.continueWarning') : undefined}
          right={
            <button className="primary" onClick={p.onNext}>
              {t('load.next')}
            </button>
          }
        />
      )}
    </>
  )
}
