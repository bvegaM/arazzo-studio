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

export function AppBar({ workspace }: { workspace: WorkspaceState }) {
  const mac = desktop?.platform === 'darwin'
  return (
    <header className={`app-bar ${mac ? 'app-bar-mac' : ''}`}>
      <span className="brand-mark app-mark" aria-hidden="true">
        A
      </span>
      {workspace.isOpen ? <WorkspaceMenu workspace={workspace} /> : <strong className="app-bar-title">Arazzo Studio</strong>}
      <span className="app-bar-drag" />
      {workspace.isOpen && <SaveBadge status={workspace.status} error={workspace.error} />}
    </header>
  )
}
