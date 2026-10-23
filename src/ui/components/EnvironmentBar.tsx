// Pestañas de ambientes (DEV, QA, UAT…) con crear, renombrar y eliminar.
import { useEffect, useRef, useState } from 'react'
import type { Environment } from '../../core/environments'
import { t } from '../../i18n'

export interface EnvActions {
  select: (id: string) => void
  add: (name: string) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name?: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      className="env-name-input"
      autoFocus
      value={value}
      aria-label={t('env.nameLabel')}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        if (e.key === 'Escape') onDone()
      }}
    />
  )
}

export function EnvironmentBar({ environments, activeId, actions }: { environments: Environment[]; activeId: string; actions: EnvActions }) {
  const [renaming, setRenaming] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const justAdded = useRef(false)
  const active = environments.find((e) => e.id === activeId) ?? environments[0]

  // Al crear un ambiente se abre su nombre para escribirlo de inmediato.
  useEffect(() => {
    if (!justAdded.current) return
    justAdded.current = false
    setRenaming(activeId)
  }, [activeId])

  return (
    <div className="env-bar">
      <div className="env-tabs" role="tablist" aria-label={t('report.environment')}>
        {environments.map((e) =>
          renaming === e.id ? (
            <NameInput
              key={e.id}
              initial={e.name}
              onDone={(name) => {
                if (name !== undefined) actions.rename(e.id, name)
                setRenaming(undefined)
              }}
            />
          ) : (
            <button
              key={e.id}
              role="tab"
              aria-selected={e.id === active.id}
              className={`env-tab ${e.id === active.id ? 'active' : ''}`}
              title={t('env.renameHint')}
              onClick={() => {
                actions.select(e.id)
                setConfirmDelete(false)
              }}
              onDoubleClick={() => setRenaming(e.id)}
            >
              {e.name}
            </button>
          ),
        )}
        <button
          className="env-add"
          onClick={() => {
            justAdded.current = true
            actions.add(t('env.newName'))
          }}
        >
          + {t('env.add')}
        </button>
      </div>
      <div className="env-actions">
        {confirmDelete ? (
          <>
            <span>{t('env.confirmDelete', { name: active.name })}</span>
            <button
              className="link small danger-link"
              onClick={() => {
                actions.remove(active.id)
                setConfirmDelete(false)
              }}
            >
              {t('env.delete')}
            </button>
            <button className="link small" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button className="link small" onClick={() => setRenaming(active.id)}>
              {t('env.rename')}
            </button>
            {environments.length > 1 && (
              <button className="link small muted-link" onClick={() => setConfirmDelete(true)}>
                {t('env.delete')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
