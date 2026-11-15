// Inicio del workspace (como el Overview de Bruno): cifras, acciones rápidas, las colecciones con su
// carpeta y, a la derecha, la documentación del workspace (README.md en su carpeta).
import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { desktop } from '../../lib/desktop'
import type { WorkspaceState } from '../../app/useWorkspace'
import { Icon } from '../components/kit'
import { DocsPanel } from './DocsPanel'
import { RowMenu, type RowAction } from '../components/RowMenu'

const ICONS = {
  collection: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  plus: 'M12 5v14M5 12h14',
  import: 'M12 3v12m0 0l-5-5m5 5l5-5M5 21h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
}

export interface HomeStats {
  journeys: number
  arazzo: number
  contracts: number
  environments: number
}

interface Props {
  workspace: WorkspaceState
  /** Cifras de la colección abierta. */
  stats: HomeStats
  onFiles: (files: File[]) => void
  onOpenCollection: (folder: string) => void
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="home-stat">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  )
}

export function WorkspaceHome({ workspace, stats, onFiles, onOpenCollection }: Props) {
  const files = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState<string>()
  const [confirm, setConfirm] = useState<{ folder: string; remove: boolean }>()
  const [renaming, setRenaming] = useState<string>()
  const revealLabel = t(desktop?.platform === 'darwin' ? 'studio.reveal' : 'studio.revealOther')
  const active = workspace.activeCollection?.folder
  const pathOf = (folder: string) => (workspace.kind === 'browser' ? folder : `${workspace.location}/${folder === '.' ? '' : folder}`.replace(/\/$/, ''))

  const actions = (folder: string): RowAction[] => [
    ...(folder !== active ? [{ label: t('home.open'), onSelect: () => onOpenCollection(folder) }] : []),
    { label: t('studio.rename'), onSelect: () => setRenaming(folder) },
    ...(workspace.reveal ? [{ label: revealLabel, onSelect: () => workspace.reveal!(folder) }] : []),
    { label: t('studio.removeCollection'), onSelect: () => setConfirm({ folder, remove: false }) },
    ...(folder !== '.' ? [{ label: t('studio.deleteCollection'), danger: true, onSelect: () => setConfirm({ folder, remove: true }) }] : []),
  ]

  return (
    <div className="home">
      <div className="home-main">
        <div className="home-stats">
          <Stat n={workspace.collections.length} label={t('home.collections')} />
          <Stat n={stats.journeys} label={t('home.journeys')} />
          <Stat n={stats.contracts} label={t('home.contracts')} />
          <Stat n={stats.environments} label={t('home.environments')} />
        </div>
        {workspace.activeCollection && <p className="muted small home-stats-note">{t('home.statsNote', { name: workspace.activeCollection.name })}</p>}

        <h4>{t('home.quickActions')}</h4>
        <div className="home-actions">
          <button className="home-action" onClick={() => setNewName('')}>
            <Icon d={ICONS.plus} size={14} /> {t('studio.newCollection')}
          </button>
          <button className="home-action" onClick={() => files.current?.click()} disabled={!workspace.activeCollection} title={workspace.activeCollection ? undefined : t('home.importNeedsCollection')}>
            <Icon d={ICONS.import} size={14} /> {t('home.importFiles')}
          </button>
          {workspace.revealWorkspace && (
            <button className="home-action" onClick={workspace.revealWorkspace}>
              <Icon d={ICONS.folder} size={14} /> {revealLabel}
            </button>
          )}
          <input
            ref={files}
            type="file"
            multiple
            accept=".yaml,.yml,.json"
            hidden
            onChange={(e) => {
              onFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>
        {newName !== undefined && (
          <form
            className="home-new"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim()) return
              void workspace.createCollection(newName.trim())
              setNewName(undefined)
            }}
          >
            <input autoFocus value={newName} placeholder={t('studio.collectionName')} onChange={(e) => setNewName(e.target.value)} />
            <button className="primary" type="submit" disabled={!newName.trim()}>
              {t('studio.create')}
            </button>
            <button type="button" onClick={() => setNewName(undefined)}>
              {t('common.cancel')}
            </button>
            {newName.trim() && <span className="muted small home-new-path">{t('studio.collectionWhere', { path: pathOf(workspace.collectionFolderFor(newName)) })}</span>}
          </form>
        )}

        <h4>{t('home.collections')}</h4>
        {workspace.collections.length ? (
          <ul className="home-collections">
            {workspace.collections.map((c) => (
              <li key={c.folder} className={c.folder === active ? 'active' : ''}>
                <div className="home-collection">
                  <Icon d={ICONS.collection} size={16} />
                  {renaming === c.folder ? (
                    <form
                      className="grow home-rename"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const v = new FormData(e.currentTarget).get('name')?.toString().trim()
                        if (v && v !== c.name) void workspace.renameCollection(c.folder, v)
                        setRenaming(undefined)
                      }}
                    >
                      <input name="name" defaultValue={c.name} autoFocus onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === 'Escape' && setRenaming(undefined)} />
                    </form>
                  ) : (
                    <button className="grow home-collection-main" onClick={() => onOpenCollection(c.folder)}>
                      <strong>{c.name}</strong>
                      <span className="muted small clamp-start">
                        <bdi>{pathOf(c.folder)}</bdi>
                      </span>
                    </button>
                  )}
                  {c.folder === active && <span className="badge b-ok">{t('home.openNow')}</span>}
                  <RowMenu actions={actions(c.folder)} />
                </div>
                {confirm?.folder === c.folder && (
                  <div className="tree-confirm">
                    <span className="grow">
                      {confirm.remove ? t('studio.deleteCollectionConfirm', { name: c.name, folder: c.folder }) : t('studio.removeCollectionConfirm', { name: c.name })}
                    </span>
                    <button
                      className="small danger"
                      onClick={() => {
                        setConfirm(undefined)
                        void workspace.removeCollection(c.folder, confirm.remove)
                      }}
                    >
                      {confirm.remove ? t('studio.delete') : t('studio.remove')}
                    </button>
                    <button className="small" onClick={() => setConfirm(undefined)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t('home.noCollections')}</p>
        )}
        {workspace.activeCollection && stats.arazzo === 0 && <div className="callout info small">{t('home.emptyCollection', { name: workspace.activeCollection.name })}</div>}
      </div>
      <DocsPanel
        docs={workspace.docs}
        onSave={workspace.saveDocs}
        template={() => t('home.docsTemplate', { name: workspace.name ?? '' })}
        hint={t('home.docsHint')}
      />
    </div>
  )
}
