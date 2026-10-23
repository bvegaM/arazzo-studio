/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IssueLevel } from '../../core/analyze'
import type { StepStatus } from '../../core/runner'
import { VERDICT_LABEL, type Verdict } from '../../core/testcases'

export function MethodBadge({ method }: { method: string }) {
  const m = method.toLowerCase()
  return <span className={`method m-${m}`}>{m.toUpperCase()}</span>
}

const STATUS: Record<StepStatus, { cls: string; text: string }> = {
  success: { cls: 'b-ok', text: '✅ Exitoso' },
  warning: { cls: 'b-warn', text: '⚠️ Exitoso con advertencias' },
  failed: { cls: 'b-err', text: '❌ Falló' },
  skipped: { cls: 'b-skip', text: '⏭️ No ejecutado' },
}

export function StatusBadge({ status }: { status: StepStatus }) {
  return <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].text}</span>
}

const VERDICT_CLS: Record<Verdict, string> = { passed: 'b-ok', failed: 'b-err', inconclusive: 'b-warn' }
const VERDICT_ICON: Record<Verdict, string> = { passed: '✅', failed: '❌', inconclusive: '❔' }

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`badge ${VERDICT_CLS[verdict]}`}>
      {VERDICT_ICON[verdict]} {VERDICT_LABEL[verdict]}
    </span>
  )
}

const ISSUE: Record<IssueLevel, { cls: string; text: string }> = {
  error: { cls: 'b-err', text: 'Error' },
  warning: { cls: 'b-warn', text: 'Advertencia' },
  info: { cls: 'b-info', text: 'Info' },
}

export function IssueBadge({ level }: { level: IssueLevel }) {
  return <span className={`badge ${ISSUE[level].cls}`}>{ISSUE[level].text}</span>
}

export function Json({ value }: { value: any }) {
  if (value === undefined) return <pre className="muted">(vacío)</pre>
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <pre>{text}</pre>
}
