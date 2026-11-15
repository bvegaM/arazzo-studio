// Documentación en Markdown (README.md) de un workspace o de una colección: se lee con formato y se
// edita ahí mismo. Sin documentación, sugiere qué incluir y ofrece empezar (o generarla).
import { useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { Icon } from '../components/kit'
import { Markdown } from '../components/Markdown'

const DOC_ICON = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4'
const EDIT_ICON = 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4'
const PLUS_ICON = 'M12 5v14M5 12h14'

interface Props {
  docs?: string
  onSave: (text: string) => Promise<void>
  /** Texto con el que empieza un README nuevo. */
  template: () => string
  hint: string
  /** Acción extra en el estado vacío y al editar (p. ej. "Generar documentación"). */
  generate?: { label: string; run: () => string }
  ideas?: ReactNode
}

export function DocsPanel({ docs, onSave, template, hint, generate, ideas }: Props) {
  const [draft, setDraft] = useState<string>()
  const editing = draft !== undefined
  return (
    <aside className="home-docs">
      <div className="home-docs-head">
        <Icon d={DOC_ICON} size={15} />
        <strong className="grow">{t('home.docs')}</strong>
        {docs && !editing && (
          <button className="small" onClick={() => setDraft(docs)}>
            <Icon d={EDIT_ICON} size={13} /> {t('home.editDocs')}
          </button>
        )}
      </div>
      {editing ? (
        <div className="home-docs-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus spellCheck={false} aria-label={t('home.docs')} />
          <div className="row">
            <span className="muted small grow">{hint}</span>
            {generate && (
              <button onClick={() => setDraft(generate.run())} title={t('collection.regenerateHint')}>
                {generate.label}
              </button>
            )}
            <button onClick={() => setDraft(undefined)}>{t('common.cancel')}</button>
            <button
              className="primary"
              onClick={async () => {
                await onSave(draft)
                setDraft(undefined)
              }}
            >
              {t('home.saveDocs')}
            </button>
          </div>
        </div>
      ) : docs ? (
        <div className="home-docs-body">
          <Markdown text={docs} />
        </div>
      ) : (
        <div className="home-docs-empty">
          <span className="wd-icon big">
            <Icon d={DOC_ICON} size={24} />
          </span>
          <p>{t('home.docsEmpty')}</p>
          {ideas ?? (
            <ul>
              <li>{t('home.docsIdea1')}</li>
              <li>{t('home.docsIdea2')}</li>
              <li>{t('home.docsIdea3')}</li>
              <li>{t('home.docsIdea4')}</li>
            </ul>
          )}
          <div className="row">
            <button className="accent" onClick={() => setDraft(template())}>
              <Icon d={PLUS_ICON} size={14} /> {t('home.addDocs')}
            </button>
            {generate && <button onClick={() => setDraft(generate.run())}>{generate.label}</button>}
          </div>
        </div>
      )}
    </aside>
  )
}
