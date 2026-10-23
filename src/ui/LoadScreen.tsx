import { useRef, useState } from 'react'
import type { ParsedFile, Project } from '../core/loader'
import { isRemote } from '../core/loader'
import { ActionBar, PageHeader, Section } from './kit'

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
}

const KIND_LABEL = { arazzo: 'Arazzo', openapi: 'OpenAPI', unknown: 'No reconocido' }

export function LoadScreen(p: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sources = p.project?.sources ?? []
  const missing = sources.filter((s) => s.status !== 'loaded')

  return (
    <>
      <PageHeader
        step={1}
        title="Cargar archivos"
        description="Sube el Arazzo y los contratos OpenAPI que referencia. Todo se procesa en tu navegador."
        actions={p.files.length > 0 && <button onClick={p.onReset}>Empezar de nuevo</button>}
      />

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
          <div className="big">{p.files.length ? 'Agregar más archivos' : 'Arrastra aquí tus archivos .yaml, .yml o .json'}</div>
          <div className="muted small">Puedes soltar el Arazzo y sus contratos juntos</div>
        </div>
        <div className="row">
          <button className="primary" onClick={() => input.current?.click()}>
            Elegir archivos
          </button>
          {!p.files.length && (
            <button className="ghost" onClick={p.onExample}>
              Probar con el ejemplo de tarjetas
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
            <div className="eyebrow">Arazzo cargado</div>
            <div className="project-title">{p.project.arazzo.info?.title ?? p.project.arazzoFileName}</div>
            <div className="muted small">
              {p.project.arazzoFileName} · versión {String(p.project.arazzo.arazzo)} · {p.project.arazzo.workflows?.length ?? 0} workflow(s)
            </div>
          </div>
          <span className={`badge ${missing.length ? 'b-err' : 'b-ok'}`}>
            {missing.length ? `❌ Faltan ${missing.length} contrato(s)` : '✅ Contratos completos'}
          </span>
        </div>
      )}

      {p.project && (
        <Section
          title="Contratos que pide el Arazzo"
          badges={<span className="badge b-skip">{sources.length - missing.length}/{sources.length}</span>}
          subtitle={missing.length ? `Falta: ${missing.map((s) => s.name).join(', ')}` : 'Todos asociados'}
          defaultOpen={missing.length > 0}
          tone={missing.length ? 'err' : undefined}
        >
          <ul className="list">
            {sources.map((s) => (
              <li key={s.name}>
                <span className={`badge ${s.status === 'loaded' ? 'b-ok' : 'b-err'}`}>
                  {s.status === 'loaded' ? '✅ Cargado' : s.status === 'missing' ? '❌ Falta' : '❌ Error'}
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
                      Subir contrato
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
                    {isRemote(s.url) && <button onClick={() => p.onFetchRemote(s.name)}>Descargar de la URL</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.files.length > 0 && (
        <Section title="Archivos detectados" badges={<span className="badge b-skip">{p.files.length}</span>} subtitle={p.files.map((f) => f.name).join(' · ')}>
          <ul className="list">
            {p.files.map((f) => (
              <li key={f.name}>
                <span className={`badge ${f.kind === 'unknown' ? 'b-err' : 'b-accent'}`}>{KIND_LABEL[f.kind]}</span>
                <code className="grow">{f.name}</code>
                {f.doc?.info?.title && <span className="muted small">{f.doc.info.title}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.project && (
        <ActionBar
          info={missing.length ? 'Puedes continuar, pero los pasos de los contratos que faltan no se podrán ejecutar.' : undefined}
          right={
            <button className="primary" onClick={p.onNext}>
              Revisar contratos →
            </button>
          }
        />
      )}
    </>
  )
}
