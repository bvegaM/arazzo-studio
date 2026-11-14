// Bienvenida: un diálogo sobre el espacio de trabajo vacío (como Bruno) y, si se cierra,
// un estado vacío con los accesos para abrir una colección.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { SavedSession } from '../../core/session'
import type { ExampleId } from '../../app/example'
import { timeAgo } from '../../core/format'
import { t } from '../../i18n'
import { Icon } from '../components/kit'

const ICON = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  files: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4',
  resume: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  example: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3z',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
}

interface Actions {
  errors: string[]
  onFiles: (files: File[]) => void
  onExample: (id: ExampleId) => void
  /** Solo en la app de escritorio: abrir una carpeta con el Arazzo y sus contratos. */
  onOpenFolder?: () => void
  onCreate: () => void
  savedSession?: SavedSession
  onRestore: () => void
  onDiscard: () => void
}

const EXAMPLES: { id: ExampleId; title: string; hint: string }[] = [
  { id: 'cards', title: 'load.example', hint: 'ws.welcome.cardsHint' },
  { id: 'miles', title: 'load.exampleMiles', hint: 'load.exampleMilesHint' },
  { id: 'collection', title: 'ws.welcome.collection', hint: 'ws.welcome.collectionHint' },
]

/** Recibe archivos soltados encima. */
function useDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      },
    },
  }
}

function FileInput({ inputRef, onFiles }: { inputRef: React.RefObject<HTMLInputElement | null>; onFiles: (f: File[]) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".yaml,.yml,.json"
      hidden
      onChange={(e) => {
        onFiles([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  )
}

function Card({ icon, title, text, onClick }: { icon: string; title: string; text: string; onClick: () => void }) {
  return (
    <button className="wd-card" onClick={onClick}>
      <span className="wd-icon">
        <Icon d={icon} size={18} />
      </span>
      <strong>{title}</strong>
      <span className="muted small">{text}</span>
    </button>
  )
}

/** Diálogo de bienvenida: qué quieres hacer (abrir, continuar, probar un ejemplo o crear un Arazzo). */
export function WelcomeDialog(p: Actions & { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const featuredRef = useRef<HTMLButtonElement>(null)
  const [examples, setExamples] = useState(false)
  const { over, handlers } = useDrop(p.onFiles)
  const openFiles = () => input.current?.click()
  const open = p.onOpenFolder
    ? { icon: ICON.folder, title: t('load.openFolder'), text: t('ws.welcome.openFolderText'), run: p.onOpenFolder }
    : { icon: ICON.files, title: t('ws.welcome.openFiles'), text: t('ws.welcome.openFilesText'), run: openFiles }
  const session = p.savedSession

  // Al abrir: foco en la opción destacada y Esc para cerrar.
  const close = useRef(p.onClose)
  useLayoutEffect(() => {
    close.current = p.onClose
  })
  useEffect(() => {
    featuredRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let body: ReactNode
  if (examples) {
    body = (
      <>
        <button className="link wd-back" onClick={() => setExamples(false)}>
          <Icon d={ICON.back} size={14} /> {t('ws.welcome.back')}
        </button>
        <h3>{t('ws.welcome.examplesTitle')}</h3>
        <div className="wd-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} className="wd-example" onClick={() => p.onExample(ex.id)}>
              <strong>{t(ex.title as Parameters<typeof t>[0])}</strong>
              <span className="muted small">{t(ex.hint as Parameters<typeof t>[0])}</span>
            </button>
          ))}
        </div>
      </>
    )
  } else {
    body = (
      <>
        <div className="wd-eyebrow">{t('ws.welcome.getStarted')}</div>
        <h3>{t('ws.welcome.question')}</h3>
        {session ? (
          <button ref={featuredRef} className="wd-featured" onClick={p.onRestore}>
            <span className="wd-icon">
              <Icon d={ICON.resume} size={18} />
            </span>
            <span className="grow">
              <strong>{t('ws.welcome.resume')}</strong>
              <span className="muted small">
                {session.title ?? session.files[0].name} · {t('nav.files', { n: session.files.length })} · {timeAgo(new Date(session.savedAt))}
              </span>
            </span>
          </button>
        ) : (
          <button ref={featuredRef} className="wd-featured" onClick={open.run}>
            <span className="wd-icon">
              <Icon d={open.icon} size={18} />
            </span>
            <span className="grow">
              <strong>{open.title}</strong>
              <span className="muted small">{open.text}</span>
            </span>
          </button>
        )}
        <div className="wd-cards">
          {session && <Card icon={open.icon} title={open.title} text={open.text} onClick={open.run} />}
          <Card icon={ICON.example} title={t('ws.welcome.tryExample')} text={t('ws.welcome.tryExampleText')} onClick={() => setExamples(true)} />
          <Card icon={ICON.plus} title={t('ws.welcome.create')} text={t('ws.welcome.createText')} onClick={p.onCreate} />
        </div>
      </>
    )
  }

  return (
    <div className={`welcome-backdrop ${over ? 'over' : ''}`} {...handlers}>
      <div className="welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="wd-hero">
          <div className="brand-mark big" aria-hidden="true">
            A
          </div>
          <h2 id="welcome-title">{t('ws.welcome.title')}</h2>
          <p className="muted">{t('ws.welcome.tagline')}</p>
        </div>
        {body}
        {p.errors.length > 0 && (
          <div className="callout err small">
            {p.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        <div className="wd-footer">
          <span className="muted small">{over ? t('ws.welcome.dropNow') : t('ws.welcome.dropHint')}</span>
          {session && (
            <button className="link small muted-link" onClick={p.onDiscard}>
              {t('session.discard')}
            </button>
          )}
          <button className="link" onClick={p.onClose}>
            {t('ws.welcome.explore')}
          </button>
        </div>
        <FileInput inputRef={input} onFiles={p.onFiles} />
      </div>
    </div>
  )
}

/** Espacio de trabajo sin colección (después de cerrar la bienvenida). */
export function EmptyWorkspace(p: Actions & { onShowWelcome: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const { over, handlers } = useDrop(p.onFiles)
  return (
    <div className={`ws-empty ${over ? 'over' : ''}`} {...handlers}>
      <span className="wd-icon big">
        <Icon d={ICON.folder} size={26} />
      </span>
      <h2>{t('ws.empty.title')}</h2>
      <p className="muted">{t('ws.empty.text')}</p>
      <div className="row">
        {p.savedSession && (
          <button className="primary" onClick={p.onRestore}>
            {t('ws.welcome.resume')}
          </button>
        )}
        {p.onOpenFolder && (
          <button className={p.savedSession ? undefined : 'primary'} onClick={p.onOpenFolder}>
            {t('load.openFolder')}
          </button>
        )}
        <button className={p.savedSession || p.onOpenFolder ? undefined : 'primary'} onClick={() => input.current?.click()}>
          {t('ws.welcome.openFiles')}
        </button>
        <button onClick={p.onShowWelcome}>{t('ws.empty.showWelcome')}</button>
      </div>
      {p.errors.length > 0 && (
        <div className="callout err small">
          {p.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <FileInput inputRef={input} onFiles={p.onFiles} />
    </div>
  )
}
