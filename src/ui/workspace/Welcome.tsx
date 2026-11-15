// Bienvenida: un diálogo sobre el espacio de trabajo vacío (como Bruno) y, si se cierra,
// un estado vacío con los accesos para abrir una colección.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { SavedSession } from '../../core/session'
import type { ExampleId } from '../../app/example'
import { t } from '../../i18n'
import { Icon } from '../components/kit'
import type { ParentLocation, WorkspaceState } from '../../app/useWorkspace'
import { slugify } from '../../core/workspaceFormat'

const ICON = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  files: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4',
  resume: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  example: 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3z',
  plus: 'M12 5v14M5 12h14',
  workspace: 'M4 5h6l2 2h8v12H4zM4 9h16',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l4-8H7l-4 8',
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

/** Ruta legible de la carpeta donde se creará el workspace. */
function parentLabel(parent: ParentLocation): string {
  return parent.kind === 'desktop' ? parent.path : parent.kind === 'folder' ? parent.label : ''
}

/** Crear un workspace: nombre, dónde guardarlo (visible y editable) y nombre de su carpeta. */
function CreateWorkspace({ workspace }: { workspace: WorkspaceState }) {
  const [name, setName] = useState(t('studio.defaultName'))
  const [folder, setFolder] = useState<string>()
  const [parent, setParent] = useState<ParentLocation>()
  // En el navegador con acceso a carpetas: carpeta del disco o almacenamiento del navegador.
  const [webKind, setWebKind] = useState<'folder' | 'browser'>(workspace.locations.includes('folder') ? 'folder' : 'browser')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void workspace.defaultParent().then((p) => setParent((cur) => cur ?? p))
  }, [workspace])

  const folderName = folder ?? slugify(name)
  const isDesktop = workspace.locations.includes('desktop')
  const target: ParentLocation | undefined = isDesktop ? parent : webKind === 'browser' ? { kind: 'browser' } : parent?.kind === 'folder' ? parent : undefined
  const sep = parent?.kind === 'desktop' && parent.path.includes('\\') ? '\\' : '/'
  const preview = target && target.kind !== 'browser' ? `${parentLabel(target).replace(/[\\/]+$/, '')}${sep}${folderName}` : undefined
  const ready = !!name.trim() && !!target && (target.kind === 'browser' || !!folderName.trim()) && !busy

  async function change() {
    const picked = await workspace.pickParent(parent)
    if (picked) setParent(picked)
  }

  async function submit() {
    if (!ready || !target) return
    setBusy(true)
    try {
      await workspace.createWorkspace(name.trim(), target, folderName.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="wd-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="field">
        <span>{t('studio.workspaceName')}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {!isDesktop && workspace.locations.includes('folder') && (
        <div className="wd-choice" role="radiogroup" aria-label={t('studio.locationLabel')}>
          {(['folder', 'browser'] as const).map((k) => (
            <label key={k} className={`wd-choice-item ${webKind === k ? 'on' : ''}`}>
              <input type="radio" name="ws-kind" checked={webKind === k} onChange={() => setWebKind(k)} />
              <span className="grow">
                <strong>{t(`studio.location.${k}`)}</strong>
                <span className="muted small">{t(`studio.location.${k}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {(isDesktop || webKind === 'folder') && (
        <>
          <div className="field">
            <span>{t('studio.locationLabel')}</span>
            <div className="wd-path">
              <Icon d={ICON.folder} size={15} />
              {parent && parent.kind !== 'browser' ? (
                <span className="grow clamp-start" title={parentLabel(parent)}>
                  <bdi>{parentLabel(parent)}</bdi>
                </span>
              ) : (
                <span className="grow clamp-1 muted">{t('studio.pickFirst')}</span>
              )}
              <button type="button" className="small" onClick={() => void change()}>
                {parent && parent.kind !== 'browser' ? t('studio.change') : t('studio.pickFolder')}
              </button>
            </div>
          </div>
          <label className="field">
            <span>{t('studio.folderName')}</span>
            <input value={folderName} onChange={(e) => setFolder(e.target.value.replace(/[\\/:*?"<>|]/g, ''))} spellCheck={false} />
          </label>
        </>
      )}

      <p className="wd-preview small">
        {preview ? (
          <>
            <span className="muted">{t('studio.willCreate')}</span> <code title={preview}>{preview}</code>
          </>
        ) : target?.kind === 'browser' ? (
          <span className="muted">{t('studio.willCreateBrowser')}</span>
        ) : null}
      </p>

      <div className="row wd-actions">
        <button className="primary" type="submit" disabled={!ready}>
          {t('studio.createWorkspace')}
        </button>
      </div>
      {workspace.error && <p className="err small">{workspace.error}</p>}
    </form>
  )
}

/** Abrir un workspace: una carpeta del disco o uno guardado en el navegador. */
function OpenWorkspace({ workspace }: { workspace: WorkspaceState }) {
  const [saved, setSaved] = useState<{ id: string; label: string }[]>()
  useEffect(() => {
    void workspace.browserWorkspaces().then(setSaved)
  }, [workspace])
  return (
    <div className="wd-examples">
      {workspace.locations.includes('folder') && (
        <button className="wd-example wd-location" onClick={() => void workspace.openWorkspace('folder')}>
          <span className="wd-icon">
            <Icon d={ICON.folder} size={16} />
          </span>
          <span className="grow">
            <strong>{t('studio.openFolder')}</strong>
            <span className="muted small">{t('studio.openFolderHint')}</span>
          </span>
        </button>
      )}
      {saved?.map((w) => (
        <button key={w.id} className="wd-example wd-location" onClick={() => void workspace.openBrowserWorkspace(w.id, w.label)}>
          <span className="wd-icon">
            <Icon d={ICON.workspace} size={16} />
          </span>
          <span className="grow">
            <strong>{w.label}</strong>
            <span className="muted small">{t('studio.location.browser')}</span>
          </span>
        </button>
      ))}
      {saved && !saved.length && !workspace.locations.includes('folder') && <p className="muted small">{t('studio.noSaved')}</p>}
    </div>
  )
}

/** Diálogo de bienvenida: abrir o crear un workspace, continuar, o probar un ejemplo. */
export function WelcomeDialog(p: Actions & { onClose: () => void; workspace: WorkspaceState }) {
  const input = useRef<HTMLInputElement>(null)
  const featuredRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<'main' | 'examples' | 'create' | 'open'>('main')
  const ws = p.workspace
  // En escritorio "Abrir workspace" va directo al diálogo de carpetas.
  const openWorkspace = () => (ws.locations.includes('desktop') ? void ws.openWorkspace('desktop') : setView('open'))
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

  const back = (
    <button className="link wd-back" onClick={() => setView('main')}>
      <Icon d={ICON.back} size={14} /> {t('ws.welcome.back')}
    </button>
  )
  let body: ReactNode
  if (view === 'create') {
    body = (
      <>
        {back}
        <h3>{t('studio.createTitle')}</h3>
        <p className="muted small wd-lead">{t('studio.createLead')}</p>
        <CreateWorkspace workspace={ws} />
      </>
    )
  } else if (view === 'open') {
    body = (
      <>
        {back}
        <h3>{t('studio.openTitle')}</h3>
        <OpenWorkspace workspace={ws} />
      </>
    )
  } else if (view === 'examples') {
    body = (
      <>
        {back}
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
        {ws.last ? (
          <button ref={featuredRef} className="wd-featured" onClick={() => void ws.reopenLast()}>
            <span className="wd-icon">
              <Icon d={ICON.workspace} size={18} />
            </span>
            <span className="grow">
              <strong>{t('studio.reopen', { name: ws.last.name ?? ws.last.label.split(/[\\/]/).filter(Boolean).pop() ?? ws.last.label })}</strong>
              <span className="muted small clamp-1">
                {t('studio.reopenHint', { place: ws.last.kind === 'browser' ? t('studio.location.browser') : ws.last.label })}
              </span>
            </span>
          </button>
        ) : (
          <button ref={featuredRef} className="wd-featured" onClick={() => setView('create')}>
            <span className="wd-icon">
              <Icon d={ICON.workspace} size={18} />
            </span>
            <span className="grow">
              <strong>{t('studio.createTitle')}</strong>
              <span className="muted small">{t('studio.createText')}</span>
            </span>
          </button>
        )}
        <div className="wd-cards">
          {ws.last && <Card icon={ICON.plus} title={t('studio.createTitle')} text={t('studio.createShort')} onClick={() => setView('create')} />}
          <Card icon={ICON.open} title={t('studio.openTitle')} text={t('studio.openText')} onClick={openWorkspace} />
          <Card icon={ICON.example} title={t('ws.welcome.tryExample')} text={t('ws.welcome.tryExampleText')} onClick={() => setView('examples')} />
          {session && <Card icon={ICON.resume} title={t('ws.welcome.resume')} text={session.title ?? session.files[0].name} onClick={p.onRestore} />}
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
        {[...p.errors, ...(ws.error ? [ws.error] : [])].length > 0 && (
          <div className="callout err small">
            {[...p.errors, ...(ws.error ? [ws.error] : [])].map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        <div className="wd-footer">
          <span className="muted small">
            {over ? (
              t('ws.welcome.dropNow')
            ) : (
              <>
                {t('studio.quickHint')}{' '}
                <button className="link" onClick={open.run}>
                  {t('studio.quickOpen')}
                </button>
              </>
            )}
          </span>
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

/** Colección abierta sin Arazzo todavía (o workspace sin colecciones). */
export function EmptyCollection({
  workspace,
  onFiles,
  onCreateArazzo,
}: {
  workspace: WorkspaceState
  onFiles: (files: File[]) => void
  onCreateArazzo: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const { over, handlers } = useDrop(onFiles)
  if (!workspace.collections.length) {
    return (
      <div className="ws-empty">
        <span className="wd-icon big">
          <Icon d={ICON.workspace} size={26} />
        </span>
        <h2>{t('studio.firstCollection')}</h2>
        <p className="muted">{t('studio.firstCollectionText')}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void workspace.createCollection(name.trim())
          }}
        >
          <input autoFocus value={name} placeholder={t('studio.collectionName')} onChange={(e) => setName(e.target.value)} />
          <button className="primary" type="submit" disabled={!name.trim()}>
            {t('studio.newCollection')}
          </button>
        </form>
      </div>
    )
  }
  return (
    <div className={`ws-empty ${over ? 'over' : ''}`} {...handlers}>
      <span className="wd-icon big">
        <Icon d={ICON.files} size={26} />
      </span>
      <h2>{t('studio.emptyCollection', { name: workspace.activeCollection?.name ?? '' })}</h2>
      <p className="muted">{t('studio.emptyCollectionText')}</p>
      <div className="row">
        <button className="primary" onClick={() => input.current?.click()}>
          {t('ws.welcome.openFiles')}
        </button>
        <button onClick={onCreateArazzo}>{t('ws.welcome.create')}</button>
      </div>
      <FileInput inputRef={input} onFiles={onFiles} />
    </div>
  )
}
