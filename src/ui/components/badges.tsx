/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IssueLevel } from '../../core/analyze'
import type { StepStatus } from '../../core/runner'
import { verdictLabel, type Verdict } from '../../core/testcases'
import { t } from '../../i18n'

export function MethodBadge({ method }: { method: string }) {
  const m = method.toLowerCase()
  return <span className={`method m-${m}`}>{m.toUpperCase()}</span>
}

const STATUS: Record<StepStatus, { cls: string; icon: string }> = {
  success: { cls: 'b-ok', icon: '✅' },
  warning: { cls: 'b-warn', icon: '⚠️' },
  failed: { cls: 'b-err', icon: '❌' },
  skipped: { cls: 'b-skip', icon: '⏭️' },
}

export function StatusBadge({ status }: { status: StepStatus }) {
  return <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].icon} {t(`step.${status}`)}</span>
}

const VERDICT_CLS: Record<Verdict, string> = { passed: 'b-ok', failed: 'b-err', inconclusive: 'b-warn' }
const VERDICT_ICON: Record<Verdict, string> = { passed: '✅', failed: '❌', inconclusive: '❔' }

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`badge ${VERDICT_CLS[verdict]}`}>
      {VERDICT_ICON[verdict]} {verdictLabel(verdict)}
    </span>
  )
}

const ISSUE_CLS: Record<IssueLevel, string> = { error: 'b-err', warning: 'b-warn', info: 'b-info' }

export function IssueBadge({ level }: { level: IssueLevel }) {
  return <span className={`badge ${ISSUE_CLS[level]}`}>{t(`issue.${level}`)}</span>
}

export function Json({ value }: { value: any }) {
  if (value === undefined) return <pre className="muted">{t('common.empty')}</pre>
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <pre>{text}</pre>
}
