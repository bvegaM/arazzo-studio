// Resumen de una colección (como el Overview de una colección en Bruno): dónde está, su versión,
// ambientes, journeys, contratos, cómo compartirla y su documentación (README.md en su carpeta).
import { useState } from 'react'
import { collectionDocsMarkdown } from '../../core/collectionDocs'
import type { Journey } from '../../core/collection'
import type { SourceState } from '../../core/loader'
import { humanizeId } from '../../core/format'
import type { Verdict } from '../../core/testcases'
import { t } from '../../i18n'
import { desktop } from '../../lib/desktop'
import type { WorkspaceState } from '../../app/useWorkspace'
import { EnvDot, Icon } from '../components/kit'
import { DocsPanel } from './DocsPanel'

const ICONS = {
  collection: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  env: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  journey: 'M4 6h16M4 12h10M4 18h7',
  contract: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  book: 'M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z',
}

interface Props {
  workspace: WorkspaceState
  journeys: Journey[]
  sources: SourceState[]
  environments: { id: string; name: string; color?: string; servers: Record<string, string> }[]
  casesCount: number
  /** Veredictos de la última ejecución de cada caso (de esta sesión). */
  verdicts: Verdict[]
  onOpenEnv: () => void
  onOpenJourney: (key: string) => void
  onOpenContract: (file: string) => void
  onOpenTerminal?: (cwd?: string) => void
}

function Card({ icon, tone, title, children }: { icon: string; tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className="co-card">
      <span className={`co-icon tone-${tone}`}>
        <Icon d={icon} size={18} />
      </span>
      <div className="co-card-body">
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  )
}

export function CollectionOverview(p: Props) {
  const ws = p.workspace
  const col = ws.activeCollection
  const [versionDraft, setVersionDraft] = useState<string>()
  const [copied, setCopied] = useState(false)
  if (!col) return null
  const path = ws.kind === 'browser' ? undefined : ws.folderPath(col.folder) ?? (col.folder === '.' ? ws.location : `${ws.location}/${col.folder}`)
  const files = [...new Set(p.journeys.map((j) => j.file))]
  const passed = p.verdicts.filter((v) => v === 'passed').length
  const failed = p.verdicts.filter((v) => v === 'failed').length
  const inconclusive = p.verdicts.filter((v) => v === 'inconclusive').length
  const revealLabel = t(desktop?.platform === 'darwin' ? 'studio.reveal' : 'studio.revealOther')
  const generate = () =>
    collectionDocsMarkdown({ name: col.name, version: col.collectionVersion, journeys: p.journeys, sources: p.sources, environments: p.environments })

  return (
    <div className="home collection-overview">
      <div className="home-main">
        <h2 className="co-title">
          <Icon d={ICONS.collection} size={20} /> {col.name}
        </h2>

        <Card icon={ICONS.folder} tone="blue" title={t('collection.location')}>
          <span className="muted co-path" title={path ?? t('studio.where.browser')}>
            {path ?? t('studio.where.browser')}
          </span>
          <span className="co-links">
            {ws.reveal && (
              <button className="link" onClick={() => ws.reveal!(col.folder)}>
                {revealLabel}
              </button>
            )}
            {p.onOpenTerminal && ws.folderPath(col.folder) && (
              <button className="link" onClick={() => p.onOpenTerminal!(ws.folderPath(col.folder))}>
                {t('sidebar.openTerminal')}
              </button>
            )}
          </span>
        </Card>

        <Card icon={ICONS.tag} tone="amber" title={t('collection.version')}>
          {versionDraft !== undefined ? (
            <form
              className="co-version-form"
              onSubmit={async (e) => {
                e.preventDefault()
                await ws.setCollectionVersion(col.folder, versionDraft)
                setVersionDraft(undefined)
              }}
            >
              <input autoFocus value={versionDraft} placeholder="1.0.0" onChange={(e) => setVersionDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setVersionDraft(undefined)} />
              <button className="small primary" type="submit">
                {t('home.saveDocs')}
              </button>
            </form>
          ) : (
            <span>
              {col.collectionVersion ? <code>{col.collectionVersion}</code> : <em className="muted">{t('collection.noVersion')}</em>}{' '}
              <button className="link" onClick={() => setVersionDraft(col.collectionVersion ?? '')}>
                {t('collection.change')}
              </button>
            </span>
          )}
        </Card>

        <Card icon={ICONS.env} tone="green" title={t('home.environments')}>
          <span className="co-envs">
            {p.environments.map((e) => (
              <span key={e.id} className="co-env">
                <EnvDot color={e.color} /> {e.name}
              </span>
            ))}
          </span>
          <button className="link" onClick={p.onOpenEnv}>
            {t('collection.environments', { n: p.environments.length })}
          </button>
        </Card>

        <Card icon={ICONS.journey} tone="violet" title={t('home.journeys')}>
          <span className="muted">{t('collection.journeysSummary', { journeys: p.journeys.length, files: files.length, cases: p.casesCount })}</span>
          {p.verdicts.length > 0 && (
            <span className="co-verdicts">
              <span className="ok">✓ {passed}</span>
              {failed > 0 && <span className="err">✕ {failed}</span>}
              {inconclusive > 0 && <span className="warn">? {inconclusive}</span>}
              <span className="muted small">{t('collection.lastRun')}</span>
            </span>
          )}
          <span className="co-links">
            {p.journeys.slice(0, 6).map((j) => (
              <button key={j.key} className="link" onClick={() => p.onOpenJourney(j.key)}>
                {humanizeId(j.workflowId)}
              </button>
            ))}
          </span>
        </Card>

        <Card icon={ICONS.contract} tone="pink" title={t('home.contracts')}>
          <span className="muted">{t('collection.contractsSummary', { loaded: p.sources.filter((s) => s.status === 'loaded').length, total: p.sources.length })}</span>
          <span className="co-links">
            {p.sources
              .filter((s) => s.fileName)
              .map((s) => (
                <button key={s.name} className="link" onClick={() => p.onOpenContract(s.fileName!)}>
                  {s.name} <span className="muted small">{s.type}</span>
                </button>
              ))}
          </span>
        </Card>

        <Card icon={ICONS.share} tone="blue" title={t('collection.share')}>
          <span className="muted">{t('collection.shareHint')}</span>
          {path && (
            <span className="co-links">
              <button
                className="link"
                onClick={async () => {
                  await navigator.clipboard.writeText(path)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? `✓ ${t('dev.net.copied')}` : t('collection.copyPath')}
              </button>
            </span>
          )}
        </Card>
      </div>
      <DocsPanel
        docs={ws.collectionDocs}
        onSave={ws.saveCollectionDocs}
        template={generate}
        hint={t('collection.docsHint')}
        generate={{ label: t('collection.generateDocs'), run: generate }}
        ideas={<p className="muted small">{t('collection.docsIdeas')}</p>}
      />
    </div>
  )
}
