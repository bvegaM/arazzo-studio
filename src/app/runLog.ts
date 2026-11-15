// Lo que una ejecución deja en el panel de desarrollo: una línea de consola por paso y caso,
// y una entrada de red por cada petición HTTP o mensaje. Los pasos llegan con los secretos tapados.
import type { StepResult, WorkflowRunResult } from '../core/runner'
import { byteSize, log, logNetwork, type LogLevel } from '../lib/devlog'
import { t } from '../i18n'

export interface RunContext {
  journey: string
  caseName: string
  simulated: boolean
}

// Un paso que falla es un aviso: en los casos negativos es lo esperado. El error lo marca el caso.
const LEVEL: Record<string, LogLevel> = { failed: 'warn', warning: 'warn' }
const isMessaging = (method?: string) => /^(send|receive)$/i.test(method ?? '')

/** Registra un paso terminado (y los de su sub-workflow, si llamó a otro). */
export function logStep(step: StepResult, ctx: RunContext) {
  const level = LEVEL[step.status] ?? 'info'
  // Los pasos de mensajería traen también una "petición" (SEND/RECEIVE): se registran como mensaje.
  if (step.request && !isMessaging(step.request.method)) {
    const res = step.response
    logNetwork({
      kind: 'http',
      method: step.request.method.toUpperCase(),
      url: step.request.url,
      status: res?.status,
      statusText: res?.statusText,
      durationMs: res?.durationMs,
      size: byteSize(res?.body),
      failed: !res || step.status === 'failed',
      simulated: ctx.simulated || !!step.simulated,
      journey: ctx.journey,
      step: step.stepId,
      caseName: ctx.caseName,
      request: { headers: step.request.headers, body: step.request.body },
      response: res ? { headers: res.headers, body: res.body } : undefined,
    })
  }
  if (step.message) {
    const m = step.message
    logNetwork({
      kind: 'message',
      method: m.action.toUpperCase(),
      url: m.channel,
      durationMs: m.durationMs,
      size: byteSize(m.payload),
      failed: step.status === 'failed',
      simulated: ctx.simulated || !!step.simulated,
      journey: ctx.journey,
      step: step.stepId,
      caseName: ctx.caseName,
      request: { headers: m.headers, body: m.action === 'send' ? m.payload : undefined },
      response: m.action === 'receive' ? { headers: m.headers, body: m.payload } : undefined,
    })
  } else if (step.request && isMessaging(step.request.method)) {
    // No hubo mensaje (p. ej. no llegó a tiempo): una sola fila, fallida.
    logNetwork({
      kind: 'message',
      method: step.request.method.toUpperCase(),
      url: step.request.url,
      failed: true,
      simulated: ctx.simulated || !!step.simulated,
      journey: ctx.journey,
      step: step.stepId,
      caseName: ctx.caseName,
      request: { headers: step.request.headers, body: step.request.body },
    })
  }
  const what = step.response
    ? `${step.request?.method.toUpperCase()} ${step.response.status} · ${Math.round(step.response.durationMs)} ms`
    : step.message
      ? `${step.message.action.toUpperCase()} ${step.message.channel} · ${Math.round(step.message.durationMs)} ms`
      : t(`devlog.status.${step.status}` as 'devlog.status.success')
  const reason = step.reason?.message
  log(level, `${step.stepId} — ${what}`, { source: 'run', detail: [reason, ...step.contractIssues, ...step.unresolved].filter(Boolean).join('\n') || undefined })
  for (const sub of step.subRun?.steps ?? []) logStep(sub, ctx)
}

export function logCaseStart(ctx: RunContext) {
  log('info', t('devlog.caseStart', { name: ctx.caseName, journey: ctx.journey, mode: t(ctx.simulated ? 'common.simulated' : 'common.realApi') }), { source: 'run' })
}

export function logCaseEnd(ctx: RunContext, verdict: string, explanation: string, result: WorkflowRunResult) {
  const level: LogLevel = verdict === 'passed' ? 'info' : verdict === 'failed' ? 'error' : 'warn'
  log(level, t('devlog.caseEnd', { name: ctx.caseName, verdict: t(`verdict.${verdict}` as 'verdict.passed'), ms: Math.round(result.durationMs) }), {
    source: 'run',
    detail: explanation,
  })
}
