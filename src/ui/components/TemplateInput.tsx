// Campo de texto que entiende {{variables}}: sugiere las del ambiente activo y los generadores al
// escribir "{{", y muestra debajo si cada una existe y qué valor tiene (como Postman o Bruno).
import { createContext, useContext, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import type { EnvVariable } from '../../core/environments'
import { dynamicExample, dynamicHelp, isGeneratorName, templateHelp } from '../../core/templates'
import { fakerReady, loadFaker } from '../../core/dynamicVars'
import { t } from '../../i18n'

export interface TemplateVars {
  variables: EnvVariable[]
  envName: string
  /** Crea una variable (o secreto) vacía en el ambiente activo. */
  onCreate?: (name: string, secret: boolean) => void
  /** Abre la configuración del ambiente activo. */
  onOpenEnv?: () => void
}

const TemplateVarsContext = createContext<TemplateVars | undefined>(undefined)
export const TemplateVarsProvider = TemplateVarsContext.Provider

interface Option {
  name: string
  insert: string
  detail: string
  kind: 'variable' | 'secret' | 'dynamic' | 'generator'
}

const TOKEN = /\{\{\s*(\$?[A-Za-z_][\w.-]*)(?::(\d+))?\s*\}\}/g
const PARTIAL = /\{\{\s*([$\w.-]*)$/
const MAX_SUGGESTIONS = 60

/** Texto corto para mostrar un valor en una sugerencia o en el estado. */
function preview(v: EnvVariable): string {
  if (v.secret) return v.value ? '••••••' : t('tplInput.empty')
  if (!v.value) return t('tplInput.empty')
  return v.value.length > 40 ? `${v.value.slice(0, 40)}…` : v.value
}

/** Variables dinámicas ($randomFirstName…) con un valor de ejemplo; se calculan una sola vez. */
let dynamicOptions: Option[] | undefined
function dynamics(): Option[] {
  if (dynamicOptions) return dynamicOptions
  const list = dynamicHelp().map((d): Option => {
    const name = d.token.replace(/^\{\{|\}\}$/g, '')
    const example = dynamicExample(name)
    return { name, insert: d.token, detail: example ? `${d.description} · ${t('tplInput.example', { value: example })}` : d.description, kind: 'dynamic' }
  })
  // Los ejemplos se fijan cuando faker ya cargó; antes se muestra solo la descripción.
  if (fakerReady()) dynamicOptions = list
  return list
}

function options(vars: EnvVariable[]): Option[] {
  const fromEnv = vars
    .filter((v) => v.name)
    .map((v): Option => ({ name: v.name, insert: `{{${v.name}}}`, detail: preview(v), kind: v.secret ? 'secret' : 'variable' }))
  const generators = templateHelp().map((g): Option => {
    const name = g.token.replace(/^\{\{|\}\}$/g, '')
    return { name, insert: g.token, detail: g.description, kind: 'generator' }
  })
  return [...fromEnv, ...dynamics(), ...generators.filter((g) => !fromEnv.some((v) => v.name === g.name.split(':')[0]))]
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}

export function TemplateInput({ value, onChange, onKeyDown, onBlur, className, ...rest }: Props) {
  const ctx = useContext(TemplateVarsContext)
  const input = useRef<HTMLInputElement>(null)
  // Lo que se está escribiendo después de "{{" (undefined = sin sugerencias abiertas).
  const [query, setQuery] = useState<{ text: string; start: number; end: number }>()
  const [active, setActive] = useState(0)
  const all = useMemo(() => options(ctx?.variables ?? []), [ctx?.variables])
  const matches = query ? all.filter((o) => o.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, MAX_SUGGESTIONS) : []

  const detect = (el: HTMLInputElement) => {
    void loadFaker()
    const caret = el.selectionStart ?? el.value.length
    const m = el.value.slice(0, caret).match(PARTIAL)
    if (!m) return setQuery(undefined)
    setQuery({ text: m[1], start: caret - m[0].length, end: caret })
    setActive(0)
  }

  const pick = (o: Option) => {
    if (!query) return
    // Si ya estaban los "}}" de cierre, no se duplican.
    const after = value.slice(query.end).replace(/^\s*\}\}/, '')
    const next = value.slice(0, query.start) + o.insert + after
    onChange(next)
    setQuery(undefined)
    const caret = query.start + o.insert.length
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(caret, caret)
    })
  }

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (query && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(matches[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuery(undefined)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="tpl-input">
      <input
        {...rest}
        ref={input}
        className={className}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={!!query && matches.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target)
        }}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') detect(e.currentTarget)
        }}
        onClick={(e) => detect(e.currentTarget)}
        onBlur={(e) => {
          // Deja tiempo para el clic en una sugerencia.
          setTimeout(() => setQuery(undefined), 120)
          onBlur?.(e)
        }}
      />
      {query && matches.length > 0 && (
        <ul className="tpl-suggest" role="listbox">
          {matches.map((o, i) => (
            <li key={o.insert} role="option" aria-selected={i === active}>
              <button
                type="button"
                ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(o)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={`tpl-kind k-${o.kind}`}>{t(`tplInput.kind.${o.kind}`)}</span>
                <code>{o.name}</code>
                <span className="tpl-detail">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <TemplateStatus value={value} />
    </div>
  )
}

/** Debajo del campo: cada {{nombre}} que usa, si existe y con qué valor. */
function TemplateStatus({ value }: { value: string }) {
  const ctx = useContext(TemplateVarsContext)
  const tokens = [...new Map([...value.matchAll(TOKEN)].map((m) => [m[1], m])).values()]
  if (!tokens.length) return null
  return (
    <div className="tpl-status">
      {tokens.map((m) => {
        const name = m[1]
        const variable = ctx?.variables.find((v) => v.name === name)
        if (variable && !m[2]) {
          return (
            <span key={name} className={`tpl-chip ${variable.value ? 'ok' : 'warn'}`} title={t('tplInput.fromEnv', { env: ctx?.envName ?? '' })}>
              {variable.value ? '✓' : '!'} <code>{name}</code> = {preview(variable)}
              {!variable.value && ctx?.onOpenEnv && (
                <button type="button" className="link small" onClick={ctx.onOpenEnv}>
                  {t('tplInput.fill')}
                </button>
              )}
            </span>
          )
        }
        if (isGeneratorName(name)) {
          return (
            <span key={name} className="tpl-chip gen">
              ⚡ <code>{name}</code> {t('tplInput.generated')}
            </span>
          )
        }
        return (
          <span key={name} className="tpl-chip err">
            ✕ <code>{name}</code> {t('tplInput.missing', { env: ctx?.envName ?? '' })}
            {ctx?.onCreate && (
              <>
                <button type="button" className="link small" onClick={() => ctx.onCreate!(name, false)}>
                  {t('tplInput.createVariable')}
                </button>
                <button type="button" className="link small" onClick={() => ctx.onCreate!(name, true)}>
                  {t('tplInput.createSecret')}
                </button>
              </>
            )}
          </span>
        )
      })}
    </div>
  )
}
