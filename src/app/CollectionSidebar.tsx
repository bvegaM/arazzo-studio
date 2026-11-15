// Barra lateral del espacio de trabajo: la colección (Arazzo → journeys → pasos), sus contratos y los ambientes.
import { useRef, useState } from 'react'
import type { WorkflowAnalysis } from '../core/analyze'
import { caseJourney } from '../core/collection'
import { humanizeId } from '../core/format'
import { isRemote } from '../core/loader'
import type { CaseRun } from '../core/testcases'
import { t } from '../i18n'
import { MethodBadge } from '../ui/components/badges'
import { Chevron, Icon } from '../ui/components/kit'
import { RowMenu, type RowAction } from '../ui/components/RowMenu'
import { desktop } from '../lib/desktop'
import type { Studio } from './useStudio'
import type { WorkspaceState } from './useWorkspace'

export interface Selection {
  /** Journey activo (workflowId). */
  journey?: string
  /** Paso abierto dentro del journey activo. */
  step?: string
  /** La pestaña de ambiente está activa. */
  env?: boolean
}

interface Props {
  studio: Studio
  workspace: WorkspaceState
  selection: Selection
  onOpenJourney: (workflowId: string) => void
  onOpenStep: (workflowId: string, stepId: string) => void
  onOpenEnv: () => void
  /** Abre un contrato (por nombre de archivo) en el editor. */
  onOpenContract: (file: string) => void
  activeContract?: string
  /** Escritorio: abre la terminal de Dev Tools en una carpeta. */
  onOpenTerminal?: (cwd?: string) => void
  /** Abre el resumen de una colección (la abre si no es la activa). */
  onOpenCollectionOverview: (folder: string) => void
}

/** Estado del journey para el punto de color: la última ejecución o, si no hay, su validación. */
function journeyTone(key: string, wa: WorkflowAnalysis, runs: CaseRun[]): { cls: string; title: string } {
  const mine = runs.filter((r) => caseJourney(r.tc) === key)
  if (mine.some((r) => r.state === 'running' || r.state === 'pending')) return { cls: 'sd-running', title: t('results.runningState') }
  const done = mine.filter((r) => r.state === 'done')
  if (done.some((r) => r.verdict === 'failed')) return { cls: 'sd-failed', title: t('results.filter.failed') }
  if (done.some((r) => r.verdict === 'inconclusive')) return { cls: 'sd-inconclusive', title: t('results.filter.inconclusive') }
  if (done.length) return { cls: 'sd-passed', title: t('results.filter.passed') }
  if (wa.issues.some((i) => i.level === 'error')) return { cls: 'sd-failed', title: t('nav.errors', { n: wa.issues.filter((i) => i.level === 'error').length }) }
  return { cls: 'sd-idle', title: t('ws.tree.notRun') }
}



 /** Nombre nuevo de un archivo: si no trae extensión, conserva la del original (.arazzo.yaml…). */
function withExtension(value: string, original: string): string {
  const v = value.trim().replace(/[\\/]/g, '')
  if (/\.(ya?ml|json)$/i.test(v)) return v
  return v + (original.match(/(\.arazzo)?\.(ya?ml|json)$/i)?.[0] ?? '.yaml')
}

/** Campo para renombrar en línea: Enter guarda, Esc cancela. */
function RenameForm({ value, onSubmit, onCancel }: { value: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value)
  return (
    <form
      className="tree-form tree-rename"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim() && text.trim() !== value) onSubmit(text.trim())
        else onCancel()
      }}
    >
      <input
        autoFocus
        value={text}
        onFocus={(e) => {
          // Selecciona el nombre sin la extensión, como en Finder.
          const dot = value.search(/(\.arazzo)?\.(ya?ml|json)$/i)
          e.target.setSelectionRange(0, dot > 0 ? dot : value.length)
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        spellCheck={false}
      />
      <button className="small primary" type="submit" disabled={!text.trim()}>
        {t('studio.rename')}
      </button>
      <button className="small" type="button" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </form>
  )
}

const COLLECTIONS_ICON = 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8'
const SETTINGS_ICON = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4'
 const SEARCH_ICON = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35'
const SORT_ICON = 'M3 6h9M3 12h6M3 18h3M17 4v16m0 0l-3-3m3 3l3-3'
const COLLAPSE_ICON = 'M4 4h16v16H4zM8 12h8'
const TERMINAL_ICON = 'M4 17l6-6-6-6M12 19h8'
const OPENAPI_ICON = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4'
const EVENTS_ICON = 'M4 12h4l3-8 4 16 3-8h2'
const IMPORT_ICON = 'M12 3v12m0 0l-5-5m5 5l5-5M5 21h14'
const FOLDER_ICON = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'
const PLUS_ICON = 'M12 5v14M5 12h14'
const CLOSE_ICON = 'M6 6l12 12M18 6L6 18'

export function CollectionSidebar({ studio, workspace, selection, onOpenJourney, onOpenStep, onOpenEnv, onOpenContract, activeContract, onOpenTerminal, onOpenCollectionOverview }: Props) {
  const { projects, journeys, runs, environments, activeEnv, envActions } = studio
  const sources = studio.collectionSources
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [closing, setClosing] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const attach = useRef<HTMLInputElement>(null)
  const [attachTo, setAttachTo] = useState<string>()
  const toggle = (key: string, def = false) => setCollapsed((c) => ({ ...c, [key]: !(c[key] ?? def) }))
  // Búsqueda en el árbol: con texto, todo lo que coincide queda desplegado.
  const [query, setQuery] = useState<string>()
  const q = (query ?? '').trim().toLowerCase()
  const hit = (...texts: (string | undefined)[]) => texts.some((x) => x?.toLowerCase().includes(q))
  const isCollapsed = (key: string, def = false) => (q && key !== 'contracts' && key !== 'envs' ? false : (collapsed[key] ?? def))
  const collapseAll = () =>
    setCollapsed((c) => ({
      ...c,
      ...Object.fromEntries(workspace.collections.map((x) => [`col:${x.folder}`, true])),
      ...Object.fromEntries(projects.map((p) => [`file:${p.arazzoFileName}`, true])),
      ...Object.fromEntries(journeys.map((j) => [j.key, true])),
    }))
  const terminalAt = (folder?: string) => onOpenTerminal?.(folder === undefined ? workspace.location : workspace.folderPath(folder))
  const [newCollection, setNewCollection] = useState<string>()
  const contractFiles = useRef<HTMLInputElement>(null)
  // Contratos de la colección que ningún Arazzo usa todavía (p. ej. uno recién creado).
  const bound = new Set(sources.map((s) => s.fileName).filter(Boolean))
  const unbound = studio.files.filter((f) => f.kind !== 'arazzo' && !bound.has(f.name))
  // Renombrar en línea y confirmar antes de quitar o borrar (colección o archivo).
  const [editing, setEditing] = useState<{ kind: 'collection' | 'file'; id: string }>()
  const [confirm, setConfirm] = useState<{ kind: 'removeCollection' | 'deleteCollection' | 'deleteFile'; id: string }>()
  const [actionError, setActionError] = useState<string>()
  const revealLabel = t(desktop?.platform === 'darwin' ? 'studio.reveal' : 'studio.revealOther')
  const act = (task: Promise<unknown>) =>
    task.then(
      () => setActionError(undefined),
      (e: Error) => setActionError(e.message),
    )
  const activeFolder = workspace.activeCollection?.folder
  const fileActions = (file: string): RowAction[] => [
    { label: t('studio.rename'), onSelect: () => setEditing({ kind: 'file', id: file }) },
    ...(workspace.reveal && activeFolder ? [{ label: revealLabel, onSelect: () => workspace.reveal!(activeFolder, file) }] : []),
    { label: t('studio.deleteFile'), danger: true, onSelect: () => setConfirm({ kind: 'deleteFile', id: file }) },
  ]
  const collectionActions = (folder: string): RowAction[] => [
    { label: t('collection.overview'), icon: SETTINGS_ICON, onSelect: () => onOpenCollectionOverview(folder) },
    { label: t('studio.rename'), onSelect: () => setEditing({ kind: 'collection', id: folder }) },
    ...(workspace.reveal ? [{ label: revealLabel, onSelect: () => workspace.reveal!(folder) }] : []),
    ...(onOpenTerminal && workspace.folderPath(folder) ? [{ label: t('sidebar.openTerminal'), icon: TERMINAL_ICON, onSelect: () => terminalAt(folder) }] : []),
    { label: t('studio.removeCollection'), onSelect: () => setConfirm({ kind: 'removeCollection', id: folder }) },
    ...(folder !== '.' ? [{ label: t('studio.deleteCollection'), danger: true, onSelect: () => setConfirm({ kind: 'deleteCollection', id: folder }) }] : []),
  ]
  const confirmStrip = (kind: NonNullable<typeof confirm>['kind'], id: string, text: string, yes: string, run: () => Promise<unknown>) =>
    confirm?.kind === kind && confirm.id === id ? (
      <div className="tree-confirm">
        <span>{text}</span>
        <button
          className="small danger"
          onClick={() => {
            setConfirm(undefined)
            void act(run())
          }}
        >
          {yes}
        </button>
        <button className="small" onClick={() => setConfirm(undefined)}>
          {t('common.cancel')}
        </button>
      </div>
    ) : null

  const fileTree = (
    <>
            {projects.map((project) => {
        const file = project.arazzoFileName
        const fileKey = `file:${file}`
        const fileJourneys = journeys.filter(
          (j) => j.file === file && (!q || hit(j.workflowId, humanizeId(j.workflowId), j.wa.workflow.summary) || j.wa.steps.some((rs) => hit(rs.step.stepId, rs.op?.path))),
        )
        if (q && !fileJourneys.length) return null
        const fileErrors = (studio.analysisOf(file)?.issues ?? []).filter((i) => i.level === 'error').length
        return (
          <div key={file} className="tree-group">
            {editing?.kind === 'file' && editing.id === file ? (
              <RenameForm
                value={file.split('/').pop() ?? file}
                onCancel={() => setEditing(undefined)}
                onSubmit={(v) => {
                  setEditing(undefined)
                  void act(workspace.renameArazzo(file, withExtension(v, file)))
                }}
              />
            ) : (
              <div className="tree-row-wrap">
                <button className="tree-row tree-file" onClick={() => toggle(fileKey)} aria-expanded={!isCollapsed(fileKey)} title={file}>
                  <Chevron open={!isCollapsed(fileKey)} />
                  <span className="tree-icon">⧉</span>
                  <span className="grow clamp-1">
                    {projects.length > 1 ? (project.arazzo.info?.title ?? file) : file}
                    {projects.length > 1 && <span className="tree-file-name">{file.split(/[\\/]/).pop()}</span>}
                  </span>
                  {fileErrors > 0 && <span className="err small">!</span>}
                </button>
                {workspace.isOpen && <RowMenu actions={fileActions(file)} />}
              </div>
            )}
            {confirmStrip('deleteFile', file, t('studio.deleteFileConfirm', { name: file }), t('studio.delete'), () => workspace.deleteArazzo(file))}
            {!isCollapsed(fileKey) &&
              fileJourneys.map(({ key, wa }) => {
                const tone = journeyTone(key, wa, runs)
                const open = !isCollapsed(key, key !== selection.journey)
                const active = selection.journey === key && !selection.step && !selection.env
                return (
                  <div key={key} className="tree-group">
                    <div className={`tree-row tree-journey ${active ? 'active' : ''}`}>
                      <button className="tree-twisty" onClick={() => toggle(key, key !== selection.journey)} aria-label={t('ws.tree.toggleSteps')} aria-expanded={open}>
                        <Chevron open={open} />
                      </button>
                      <button className="tree-main" onClick={() => onOpenJourney(key)} title={wa.workflow.summary ?? wa.workflow.workflowId}>
                        <span className={`status-dot ${tone.cls}`} title={tone.title} />
                        <span className="grow clamp-1">{humanizeId(wa.workflow.workflowId)}</span>
                      </button>
                    </div>
                    {open &&
                      wa.steps
                        .filter((rs) => !q || hit(wa.workflow.workflowId, humanizeId(wa.workflow.workflowId), wa.workflow.summary) || hit(rs.step.stepId, rs.op?.path))
                        .map((rs) => {
                        const stepActive = selection.journey === key && selection.step === rs.step.stepId && !selection.env
                        const hasError = wa.issues.some((i) => i.stepId === rs.step.stepId && i.level === 'error')
                        return (
                          <button
                            key={rs.step.stepId}
                            className={`tree-row tree-step ${stepActive ? 'active' : ''}`}
                            onClick={() => onOpenStep(key, rs.step.stepId)}
                            title={rs.step.description ?? rs.label}
                          >
                            {rs.op ? <MethodBadge method={rs.op.method} /> : <span className="method m-flow">{rs.kind === 'workflow' ? 'FLOW' : '?'}</span>}
                            <span className={`grow clamp-1 ${hasError ? 'err' : ''}`}>{rs.step.stepId}</span>
                          </button>
                        )
                      })}
                  </div>
                )
              })}
          </div>
        )
      })}
    </>
  )

  return (
    <aside className="ws-sidebar">
      {workspace.isOpen && (
        <>
          <div className="tree-head tree-head-top">
            <Icon d={COLLECTIONS_ICON} size={15} />
            <strong className="tree-title">{t('studio.collections')}</strong>
            <span className="spacer" />
            <button
              className={`icon-btn ${query !== undefined ? 'on' : ''}`}
              onClick={() => setQuery((v) => (v === undefined ? '' : undefined))}
              title={t('sidebar.search')}
              aria-label={t('sidebar.search')}
              aria-pressed={query !== undefined}
            >
              <Icon d={SEARCH_ICON} size={14} />
            </button>
            <button className="icon-btn" onClick={() => setNewCollection('')} title={t('studio.newCollection')} aria-label={t('studio.newCollection')}>
              <Icon d={PLUS_ICON} size={14} />
            </button>
            <RowMenu
              inline
              label={t('sidebar.collectionsMenu')}
              actions={[
                { label: t('sidebar.sortAz'), icon: SORT_ICON, onSelect: () => void act(workspace.sortCollections()) },
                { label: t('sidebar.collapseAll'), icon: COLLAPSE_ICON, onSelect: collapseAll },
                ...(onOpenTerminal && workspace.location && workspace.kind === 'desktop' ? [{ label: t('sidebar.openTerminal'), icon: TERMINAL_ICON, onSelect: () => terminalAt() }] : []),
              ]}
            />
          </div>
          {query !== undefined && (
            <div className="tree-search">
              <Icon d={SEARCH_ICON} size={13} />
              <input
                autoFocus
                value={query}
                placeholder={t('sidebar.searchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery(undefined)}
                aria-label={t('sidebar.search')}
              />
            </div>
          )}
          {newCollection !== undefined && (
            <form
              className="tree-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newCollection.trim()) return
                void workspace.createCollection(newCollection.trim())
                setNewCollection(undefined)
              }}
            >
              <input autoFocus value={newCollection} placeholder={t('studio.collectionName')} onChange={(e) => setNewCollection(e.target.value)} />
              {newCollection.trim() && (
                <span className="muted small tree-form-hint clamp-1">
                  {t('studio.collectionWhere', {
                    path: workspace.kind === 'browser' ? workspace.collectionFolderFor(newCollection) : `${workspace.location}/${workspace.collectionFolderFor(newCollection)}`,
                  })}
                </span>
              )}
              <button className="small primary" type="submit" disabled={!newCollection.trim()}>
                {t('studio.create')}
              </button>
              <button className="small" type="button" onClick={() => setNewCollection(undefined)}>
                {t('common.cancel')}
              </button>
            </form>
          )}
          {!workspace.collections.length && newCollection === undefined && <p className="muted small tree-empty">{t('studio.noCollections')}</p>}
          {actionError && (
            <div className="tree-confirm">
              <span className="grow">{actionError}</span>
              <button className="small" onClick={() => setActionError(undefined)}>
                {t('common.close')}
              </button>
            </div>
          )}
        </>
      )}

      {(projects.length > 0 || workspace.isOpen) && (
        <>
          {!workspace.isOpen && (
          <div className="tree-head">
            <span className="tree-label">{t('ws.tree.collection')}</span>
            <span className="spacer" />
            {studio.isDesktop && (
              <button className="icon-btn" onClick={studio.openFolder} title={t('load.openFolder')} aria-label={t('load.openFolder')}>
                <Icon d={FOLDER_ICON} size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={() => files.current?.click()} title={t('ws.tree.addFiles')} aria-label={t('ws.tree.addFiles')}>
              <Icon d={PLUS_ICON} size={14} />
            </button>
            <button className="icon-btn" onClick={() => setClosing(true)} title={t('ws.tree.close')} aria-label={t('ws.tree.close')}>
              <Icon d={CLOSE_ICON} size={14} />
            </button>
          </div>
          )}
          {closing && !workspace.isOpen && (
            <div className="tree-confirm">
              <span>{t('ws.tree.closeConfirm')}</span>
              <button className="small danger" onClick={studio.reset}>
                {t('ws.tree.closeYes')}
              </button>
              <button className="small" onClick={() => setClosing(false)}>
                {t('common.cancel')}
              </button>
            </div>
          )}

          <nav className="tree" aria-label={t('ws.tree.collection')}>
            {workspace.isOpen ? (
              workspace.collections.map((c) => {
                const isActive = c.folder === workspace.activeCollection?.folder
                if (q && !isActive && !hit(c.name)) return null
                return (
                  <div key={c.folder} className="tree-group">
                    {editing?.kind === 'collection' && editing.id === c.folder ? (
                      <RenameForm
                        value={c.name}
                        onCancel={() => setEditing(undefined)}
                        onSubmit={(v) => {
                          setEditing(undefined)
                          void act(workspace.renameCollection(c.folder, v))
                        }}
                      />
                    ) : (
                      <div className="tree-row-wrap">
                        <button
                          className={`tree-row tree-collection ${isActive ? 'current' : ''}`}
                          onClick={() => (isActive ? toggle(`col:${c.folder}`) : void workspace.openCollection(c.folder))}
                          aria-expanded={isActive && !isCollapsed(`col:${c.folder}`)}
                          title={t('studio.inFolder', { folder: c.folder === '.' ? (workspace.location ?? '.') : c.folder })}
                        >
                          <Chevron open={isActive && !isCollapsed(`col:${c.folder}`)} />
                          <Icon d={FOLDER_ICON} size={14} />
                          <span className="grow clamp-1">{c.name}</span>
                        </button>
                        <RowMenu actions={collectionActions(c.folder)} />
                      </div>
                    )}
                    {confirmStrip('removeCollection', c.folder, t('studio.removeCollectionConfirm', { name: c.name }), t('studio.remove'), () =>
                      workspace.removeCollection(c.folder, false),
                    )}
                    {confirmStrip('deleteCollection', c.folder, t('studio.deleteCollectionConfirm', { name: c.name, folder: c.folder }), t('studio.delete'), () =>
                      workspace.removeCollection(c.folder, true),
                    )}
                    {isActive && !isCollapsed(`col:${c.folder}`) && (
                      <div className="tree-nested">
                        {fileTree}
                        <button className="tree-row tree-add" onClick={() => files.current?.click()}>
                          <Icon d={PLUS_ICON} size={13} /> {t('studio.addToCollection')}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <>
                <div className="tree-root" title={studio.folder ?? studio.collectionTitle}>
                  <strong className="clamp-1">{studio.collectionTitle}</strong>
                  {studio.folder && <span className="muted small clamp-1">{studio.folder}</span>}
                </div>
                {fileTree}
              </>
            )}
          </nav>

          <div className="tree-section">
            <div className="tree-head">
              <button className="tree-toggle" onClick={() => toggle('contracts')} aria-expanded={!isCollapsed('contracts')}>
                <Chevron open={!isCollapsed('contracts')} />
                <span className="tree-label">{t('ws.tree.contracts')}</span>
                <span className="muted small">
                  {sources.filter((s) => s.status === 'loaded').length}/{sources.length}
                </span>
              </button>
              <span className="spacer" />
              <RowMenu
                inline
                label={t('sidebar.contractsMenu')}
                trigger={<Icon d={PLUS_ICON} size={14} />}
                actions={[
                  { label: t('sidebar.newOpenapi'), icon: OPENAPI_ICON, onSelect: () => onOpenContract(studio.createContract('openapi')) },
                  { label: t('sidebar.newAsyncapi'), icon: EVENTS_ICON, onSelect: () => onOpenContract(studio.createContract('asyncapi')) },
                  { label: t('sidebar.importContract'), icon: IMPORT_ICON, onSelect: () => contractFiles.current?.click() },
                ]}
              />
              <input
                ref={contractFiles}
                type="file"
                multiple
                accept=".yaml,.yml,.json"
                hidden
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])]
                  e.target.value = ''
                  void studio.addFiles(picked).then(() => picked[0] && onOpenContract(picked[0].name))
                }}
              />
            </div>
            {!isCollapsed('contracts') && (
              <ul className="tree-list">
                {sources.map((s) => {
                  const ok = s.status === 'loaded' && !s.missingRefs?.length
                  return (
                    <li
                      key={s.name}
                      className={s.fileName && s.fileName === activeContract ? 'active' : ''}
                      title={s.error ?? (s.missingRefs?.length ? t('load.missingRefs', { files: s.missingRefs.join(', ') }) : (s.fileName ?? s.url))}
                    >
                      <span className={ok ? 'ok' : 'err'}>{ok ? '✓' : '✕'}</span>
                      {s.fileName ? (
                        <button className="tree-contract grow clamp-1" onClick={() => onOpenContract(s.fileName!)} title={t('contract.open', { file: s.fileName })}>
                          {s.name} <span className="muted small">{s.type}</span>
                        </button>
                      ) : (
                        <span className="grow clamp-1">
                          {s.name} <span className="muted small">{s.type}</span>
                        </span>
                      )}
                      {s.status !== 'loaded' && (
                        <>
                          <button
                            className="link small"
                            onClick={() => {
                              setAttachTo(s.name)
                              attach.current?.click()
                            }}
                          >
                            {t('ws.tree.attach')}
                          </button>
                          {isRemote(s.url) && (
                            <button className="link small" onClick={() => studio.fetchRemote(s.name)}>
                              {t('ws.tree.fetch')}
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
                {unbound.map((f) => (
                  <li key={f.name} className={f.name === activeContract ? 'active' : ''} title={t('sidebar.unboundHint')}>
                    <span className="muted">○</span>
                    <button className="tree-contract grow clamp-1" onClick={() => onOpenContract(f.name)}>
                      {f.name.split('/').pop()} <span className="muted small">{f.kind === 'unknown' ? 'schemas' : f.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={attach}
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f && attachTo) void studio.attachFile(attachTo, f)
                e.target.value = ''
              }}
            />
          </div>

          <div className="tree-section">
            <div className="tree-head">
              <button className="tree-toggle" onClick={() => toggle('envs')} aria-expanded={!isCollapsed('envs')}>
                <Chevron open={!isCollapsed('envs')} />
                <span className="tree-label">{t('ws.tree.environments')}</span>
              </button>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => envActions.add(t('env.newName'))} title={t('ws.tree.addEnv')} aria-label={t('ws.tree.addEnv')}>
                <Icon d={PLUS_ICON} size={14} />
              </button>
            </div>
            {!isCollapsed('envs') && (
              <ul className="tree-list">
                {environments.map((e) => (
                  <li key={e.id} className={e.id === activeEnv.id ? 'active' : ''}>
                    <button className="tree-env" onClick={() => envActions.select(e.id)} title={t('ws.tree.useEnv')}>
                      <span className={`radio ${e.id === activeEnv.id ? 'on' : ''} ${e.color ? `c-${e.color}` : ''}`} aria-hidden="true" />
                      <span className="grow clamp-1">{e.name}</span>
                      {e.variables.length > 0 && (
                        <span className="muted small" title={t('vars.count', { vars: e.variables.filter((v) => !v.secret).length, secrets: e.variables.filter((v) => v.secret).length })}>
                          {t('vars.countShort', { n: e.variables.length })}
                        </span>
                      )}
                    </button>
                    {e.id === activeEnv.id && (
                      <button className={`link small ${selection.env ? 'active' : ''}`} onClick={onOpenEnv}>
                        {t('ws.tree.configure')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Selector de archivos compartido: cabecera sin workspace y "Agregar archivos a la colección". */}
      <input
        ref={files}
        type="file"
        multiple
        accept=".yaml,.yml,.json"
        hidden
        onChange={(e) => {
          void studio.addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </aside>
  )
}
