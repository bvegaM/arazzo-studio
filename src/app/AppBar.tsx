// Barra superior (como Bruno): la marca, el workspace abierto con su menú y el estado del guardado.
// En la app de escritorio para macOS es también la barra de la ventana (se arrastra desde aquí).
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { desktop } from '../lib/desktop'
import { Icon } from '../ui/components/kit'
import type { WorkspaceState } from './useWorkspace'

const WORKSPACE_ICON = 'M4 5h6l2 2h8v12H4zM4 9h16'
const CARET_ICON = 'M6 9l6 6 6-6'

/** Estado del guardado automático del workspace. */
export function SaveBadge({ status, error }: { status: string; error?: string }) {
  if (status === 'saving') return <span className="save-badge saving">{t('studio.saving')}</span>
  if (status === 'error') return <span className="save-badge err" title={error}>{t('studio.saveError')}</span>
  if (status === 'saved') return <span className="save-badge ok">✓ {t('studio.saved')}</span>
  return null
}

function WorkspaceMenu({ workspace }: { workspace: WorkspaceState }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const kind = workspace.kind ?? 'browser'
  const revealLabel = t(desktop?.platform === 'darwin' ? 'studio.reveal' : 'studio.revealOther')

  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      setConfirmDelete(false)
    }
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (renaming) {
    return (
      <form
        className="app-ws-rename"
        onSubmit={(e) => {
          e.preventDefault()
          setRenaming(false)
          if (name.trim() && name.trim() !== workspace.name) void workspace.renameWorkspace(name.trim())
        }}
      >
        <input
          autoFocus
          value={name}
          aria-label={t('studio.workspaceName')}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
          onBlur={() => setRenaming(false)}
        />
      </form>
    )
  }

  const item = (label: string, onSelect: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'danger' : ''}
      onClick={() => {
        onSelect()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="app-ws" ref={root}>
      <button
        className="app-ws-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('studio.workspaceMenu')}
        onClick={() => {
          setOpen((o) => !o)
          setConfirmDelete(false)
        }}
      >
        <Icon d={WORKSPACE_ICON} size={15} />
        <span className="clamp-1">{workspace.name}</span>
        <Icon d={CARET_ICON} size={14} />
      </button>
      {open && (
        <div className="row-menu-list app-ws-menu" role="menu">
          <div className="app-ws-head">
            <strong className="clamp-1">{workspace.name}</strong>
            <span className="muted small clamp-start" title={workspace.location}>
              <bdi>{t(`studio.where.${kind}`, { place: workspace.location ?? '' })}</bdi>
            </span>
          </div>
          {confirmDelete ? (
            <div className="app-ws-confirm">
              <p>{t(`studio.deleteWorkspaceConfirm.${kind}`, { name: workspace.name ?? '', place: workspace.location ?? '' })}</p>
              <div className="row">
                <button
                  className="small danger"
                  onClick={() => {
                    setOpen(false)
                    setConfirmDelete(false)
                    void workspace.deleteWorkspace()
                  }}
                >
                  {t(kind === 'desktop' ? 'studio.trash' : 'studio.delete')}
                </button>
                <button className="small" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {item(t('studio.renameWorkspace'), () => {
                setName(workspace.name ?? '')
                setOpen(false)
                setRenaming(true)
              })}
              {workspace.revealWorkspace &&
                item(revealLabel, () => {
                  setOpen(false)
                  workspace.revealWorkspace!()
                })}
              <hr />
              {item(t('studio.switchWorkspace'), () => {
                setOpen(false)
                void workspace.closeWorkspace()
              })}
              {item(t('studio.deleteWorkspace'), () => setConfirmDelete(true), true)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const HOME_ICON = 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'

/** En macOS de escritorio: si la ventana está en pantalla completa (sin semáforos). */
function useFullscreen(): boolean {
  const [full, setFull] = useState(false)
  useEffect(() => {
    if (!desktop) return
    void desktop.appIsFullscreen().then(setFull)
    return desktop.onFullscreen(setFull)
  }, [])
  return full
}

export function AppBar({ workspace, onHome }: { workspace: WorkspaceState; onHome: () => void }) {
  // Espacio para los semáforos de la ventana solo cuando se ven (macOS, fuera de pantalla completa).
  const fullscreen = useFullscreen()
  const traffic = desktop?.platform === 'darwin' && !fullscreen
  return (
    <header className={`app-bar ${traffic ? 'app-bar-mac' : ''}`}>
      {workspace.isOpen && (
        <button className="icon-btn app-home" onClick={onHome} title={t('home.title')} aria-label={t('home.title')}>
          <Icon d={HOME_ICON} size={16} />
        </button>
      )}
      {workspace.isOpen && <WorkspaceMenu workspace={workspace} />}
      <span className="app-bar-drag" />
      {/* Marca centrada, como el título de la ventana en Bruno. */}
      <div className="app-brand" aria-hidden="true">
        <span className="brand-mark app-mark">A</span>
        <strong>Arazzo Studio</strong>
      </div>
      {workspace.isOpen && <SaveBadge status={workspace.status} error={workspace.error} />}
    </header>
  )
}
