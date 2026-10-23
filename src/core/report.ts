/* eslint-disable @typescript-eslint/no-explicit-any */
// Reporte HTML autocontenido: se abre en cualquier navegador y se puede imprimir a PDF.
import { reasonLabel, type StepResult, type StepStatus } from './runner'
import { dataSummary, originLabel, verdictLabel, type CaseRun, type Verdict } from './testcases'
import { humanizeId } from './format'
import { getLocale, t } from '../i18n'

export type ReportCase = Omit<CaseRun, 'state'>

export interface ReportParams {
  arazzoTitle: string
  arazzoFile?: string
  generatedAt: Date
  /** Nombre del ambiente contra el que se corrió (DEV, QA…). */
  environment?: string
  servers: Record<string, string>
  cases: ReportCase[]
}

const SENSITIVE = /token|secret|password|authorization|credential|api[-_]?key|client_secret/i

function maskValue(v: any): any {
  if (typeof v !== 'string') return '••••'
  return v.length <= 6 ? '••••' : `${v.slice(0, 2)}••••${v.slice(-2)}`
}

/** Oculta valores de claves sensibles (tokens, credenciales) en cualquier estructura. */
export function maskDeep(value: any): any {
  if (Array.isArray(value)) return value.map(maskDeep)
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) && v !== null && typeof v !== 'object' ? maskValue(v) : maskDeep(v)
    return out
  }
  return value
}

/** Quita las claves sensibles (tokens, credenciales) en cualquier estructura, para no guardarlas. */
export function omitSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitSensitive) as T
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) if (!SENSITIVE.test(k)) out[k] = omitSensitive(v)
    return out
  }
  return value
}

function esc(v: any): string {
  const s = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2)
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const VERDICT_CLASS: Record<Verdict, string> = { passed: 'ok', failed: 'err', inconclusive: 'warn' }
const STEP_CLASS: Record<string, string> = { success: 'ok', warning: 'warn', failed: 'err', skipped: 'skip' }

function verdictBadge(v?: Verdict): string {
  return v ? `<span class="badge ${VERDICT_CLASS[v]}">${verdictLabel(v)}</span>` : `<span class="badge skip">${t('report.notRun')}</span>`
}

function headers(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${SENSITIVE.test(k) && !v.includes('••') ? maskValue(v) : v}`)
    .join('\n')
}

function stepHtml(s: StepResult, i: number): string {
  const parts: string[] = []
  if (s.request) {
    parts.push(`<div class="io"><div><h5>${t('report.request')}</h5><pre>${esc(`${s.request.method} ${s.request.url}\n${headers(s.request.headers)}`)}</pre>${
      s.request.body !== undefined ? `<pre>${esc(maskDeep(s.request.body))}</pre>` : ''
    }</div>`)
    parts.push(
      s.response
        ? `<div><h5>${t('report.response')}</h5><pre>${esc(`HTTP ${s.response.status} ${s.response.statusText}\n${headers(s.response.headers)}`)}</pre><pre>${esc(maskDeep(s.response.body))}</pre></div></div>`
        : `<div><h5>${t('report.response')}</h5><p class="muted">${t('report.noResponse')}</p></div></div>`,
    )
  }
  if (s.criteria.length) {
    parts.push(
      `<h5>${t('report.criteria')}</h5><table><tr><th>${t('report.condition')}</th><th>${t('report.result')}</th><th>${t('report.detail')}</th></tr>${s.criteria
        .map(
          (c) =>
            `<tr><td><code>${esc(c.context ? `${c.context} ~ ${c.condition}` : c.condition)}</code></td><td>${
              c.passed ? `<span class="badge ok">${t('crit.badge.passed')}</span>` : `<span class="badge err">${t('crit.badge.failed')}</span>`
            }</td><td>${esc(c.detail)}</td></tr>`,
        )
        .join('')}</table>`,
    )
  }
  if (s.response) {
    parts.push(
      `<h5>${t('report.contract')}</h5>${
        s.contractIssues.length
          ? `<ul>${s.contractIssues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
          : `<p><span class="badge ok">${t('report.contractOk')}</span></p>`
      }`,
    )
  }
  if (Object.keys(s.outputs).length) {
    parts.push(
      `<h5>Outputs</h5><table>${Object.entries(maskDeep(s.outputs))
        .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><code>${esc(JSON.stringify(v))}</code></td></tr>`)
        .join('')}</table>`,
    )
  }
  const notes = [
    s.reason ? `<div class="note ${s.reason.category === 'contrato' || s.reason.category === 'output' ? 'warn' : s.status === 'skipped' ? 'skip' : 'err'}"><strong>${esc(reasonLabel(s.reason.category))}:</strong> ${esc(s.reason.message)}</div>` : '',
    s.action || s.actionName ? `<div class="note action">↪ ${esc(s.action ?? t('report.action', { action: s.actionName ?? '', type: s.actionType ?? '' }))}</div>` : '',
  ].join('')
  const head = `<span class="num">${i + 1}</span><span class="badge ${STEP_CLASS[s.status]}">${t(`step.${s.status as StepStatus}`)}</span> <strong>${esc(s.stepId)}</strong> <code class="muted">${esc(s.label)}</code>${
    s.simulated ? ` <span class="badge sim">${t('common.simulated')}</span>` : ''
  }<span class="grow"></span>${s.response ? `<span class="muted">HTTP ${s.response.status} · ${s.response.durationMs} ms</span>` : ''}`
  if (s.status === 'skipped') return `<div class="step skipped"><div class="step-head">${head}</div>${notes}</div>`
  return `<details class="step st-${STEP_CLASS[s.status]}"${s.status === 'failed' ? ' open' : ''}><summary class="step-head">${head}</summary>${notes}<div class="step-body">${parts.join('')}</div></details>`
}

export function buildHtmlReport(p: ReportParams): string {
  const runs = p.cases
  const count = (v: Verdict) => runs.filter((r) => r.verdict === v).length
  const totalMs = runs.reduce((n, r) => n + (r.result?.durationMs ?? 0), 0)
  const locale = getLocale()
  const date = p.generatedAt.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })
  const workflows = [...new Set(runs.map((r) => r.tc.workflowId))]

  const summaryRows = runs
    .map(
      (r, i) => `<tr class="v-${r.verdict ? VERDICT_CLASS[r.verdict] : 'skip'}">
<td class="muted">${i + 1}</td>
<td><a href="#caso-${i + 1}">${esc(r.tc.title)}</a><div class="muted small" title="${esc(r.tc.workflowId)}">${esc(humanizeId(r.tc.workflowId))}</div></td>
<td class="small">${esc(originLabel(r.tc.origin))}</td>
<td class="small">${r.simulated ? t('common.simulated') : t('common.realApi')}</td>
<td class="small"><code>${esc(dataSummary(r.tc))}</code></td>
<td>${verdictBadge(r.verdict)}</td>
</tr>`,
    )
    .join('')

  const details = runs
    .map((r, i) => {
      const inputs = r.inputsUsed ? maskDeep(r.inputsUsed) : undefined
      return `<section class="case" id="caso-${i + 1}">
<div class="case-head"><span class="muted">#${i + 1}</span><h3>${esc(r.tc.title)}</h3>${verdictBadge(r.verdict)}</div>
<div class="kv">
<span>Workflow</span><span>${esc(humanizeId(r.tc.workflowId))} <code>${esc(r.tc.workflowId)}</code></span>
<span>${t('report.type')}</span><span>${esc(originLabel(r.tc.origin))} · ${r.simulated ? t('report.simulatedLong') : t('report.realLong')}</span>
<span>${t('report.expected')}</span><span>${esc(r.tc.expectation.text)}</span>
<span>${t('report.result')}</span><span>${esc(r.explanation ?? '—')}</span>
<span>${t('report.params')}</span><span><code>${esc(dataSummary(r.tc))}</code></span>
</div>
${
  inputs
    ? `<details class="inputs"><summary>${t('report.sentValues', { n: Object.keys(inputs).length })}</summary><table>${Object.entries(inputs)
        .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><code>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</code></td></tr>`)
        .join('')}</table></details>`
    : ''
}
<div class="steps">${r.steps.map(stepHtml).join('') || `<p class="muted">${t('report.noSteps')}</p>`}</div>
</section>`
    })
    .join('')

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('report.title')} · ${esc(p.arazzoTitle)}</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--surface2:#f1f3f6;--border:#e1e5ea;--text:#171b21;--muted:#5f6873;--accent:#3f7a24;--accentSoft:#eef6e7;--ok:#0e7a5a;--okSoft:#e2f4ee;--sim:#6d4fc2;--simSoft:#f1ecfb;--warn:#9a6100;--warnSoft:#fdf2de;--err:#b42318;--errSoft:#fdeae8;--skip:#59636e;--skipSoft:#edf0f3;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 24px 60px}
h1{font-size:24px;margin:4px 0}h2{font-size:17px;margin:32px 0 12px}h3{font-size:16px;margin:0}h5{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 6px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
pre{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;margin:0 0 6px;max-height:320px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--border);vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:var(--surface2)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.muted{color:var(--muted)}.small{font-size:12px}.grow{flex:1}
.eyebrow{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--muted);font-size:13px;margin-top:6px}
.toolbar{display:flex;gap:8px;margin-top:14px}.toolbar button{font:inherit;border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:6px 12px;cursor:pointer}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px}.card .n{font-size:26px;font-weight:700}.card .l{font-size:12px;color:var(--muted)}
.n.ok{color:var(--ok)}.n.err{color:var(--err)}.n.warn{color:var(--warn)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.badge{display:inline-block;border-radius:99px;padding:1px 9px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge.ok{background:var(--okSoft);color:var(--ok)}.badge.err{background:var(--errSoft);color:var(--err)}.badge.warn{background:var(--warnSoft);color:var(--warn)}.badge.skip{background:var(--skipSoft);color:var(--skip)}.badge.accent{background:var(--accentSoft);color:var(--accent)}.badge.sim{background:var(--simSoft);color:var(--sim)}
tr.v-err td:first-child{box-shadow:inset 3px 0 var(--err)}tr.v-warn td:first-child{box-shadow:inset 3px 0 var(--warn)}tr.v-ok td:first-child{box-shadow:inset 3px 0 var(--ok)}
.case{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:14px;break-inside:avoid-page}
.case-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.kv{display:grid;grid-template-columns:110px 1fr;gap:5px 12px;font-size:13px}.kv>span:nth-child(odd){color:var(--muted);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding-top:2px}
details.inputs{margin-top:10px}details.inputs summary{cursor:pointer;color:var(--accent);font-size:13px;font-weight:600}
.steps{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.step{border:1px solid var(--border);border-left:3px solid var(--border);border-radius:10px;overflow:hidden}
.step.st-ok{border-left-color:var(--ok)}.step.st-warn{border-left-color:var(--warn)}.step.st-err{border-left-color:var(--err)}.step.skipped{opacity:.75;border-left-color:var(--skip)}
.step-head{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;flex-wrap:wrap;list-style:none}.step-head::-webkit-details-marker{display:none}
.num{width:20px;height:20px;border-radius:50%;background:var(--surface2);display:inline-grid;place-items:center;font-size:11px;font-weight:700;color:var(--muted)}
.step-body{padding:0 12px 12px}.io{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.note{margin:0 12px 8px;padding:6px 10px;border-radius:8px;font-size:13px}.note.err{background:var(--errSoft);color:var(--err)}.note.warn{background:var(--warnSoft);color:var(--warn)}.note.skip{background:var(--skipSoft);color:var(--skip)}.note.action{color:var(--muted);padding:0 2px}
footer{margin-top:30px;font-size:12px;color:var(--muted)}
@media print{body{background:#fff}.toolbar{display:none}main{padding:0}.case,.panel,.card{border-color:#ccc}pre{max-height:none}}
</style>
</head>
<body>
<main>
<div class="eyebrow">${t('report.eyebrow')}</div>
<h1>${esc(p.arazzoTitle)}</h1>
<div class="meta"><span>${esc(date)}</span>${p.arazzoFile ? `<span>${esc(p.arazzoFile)}</span>` : ''}<span>${t('report.workflows', { n: workflows.length })}</span><span>${t('report.cases', { n: runs.length })}</span><span>${t('report.duration', { s: (totalMs / 1000).toFixed(1) })}</span></div>
<div class="toolbar"><button onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">${t('report.expandAll')}</button><button onclick="document.querySelectorAll('details').forEach(d=>d.open=false)">${t('report.collapseAll')}</button><button onclick="window.print()">${t('report.print')}</button></div>
<div class="cards">
<div class="card"><div class="n ok">${count('passed')}</div><div class="l">${t('report.passed')}</div></div>
<div class="card"><div class="n ${count('failed') ? 'err' : ''}">${count('failed')}</div><div class="l">${t('report.failed')}</div></div>
<div class="card"><div class="n ${count('inconclusive') ? 'warn' : ''}">${count('inconclusive')}</div><div class="l">${t('report.inconclusive')}</div></div>
<div class="card"><div class="n">${runs.filter((r) => r.simulated).length}</div><div class="l">${t('report.simulated')}</div></div>
</div>
<h2>${t('report.environment')}${p.environment ? `: ${esc(p.environment)}` : ''}</h2>
<div class="panel"><table><tr><th>${t('report.source')}</th><th>${t('report.baseUrl')}</th></tr>${Object.entries(p.servers)
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td><code>${esc(v || '—')}</code></td></tr>`)
    .join('')}</table></div>
<h2>${t('report.summary')}</h2>
<div class="panel"><table><tr><th>#</th><th>${t('report.case')}</th><th>${t('report.type')}</th><th>${t('report.execution')}</th><th>${t('report.params')}</th><th>${t('report.result')}</th></tr>${summaryRows}</table></div>
<h2>${t('report.details')}</h2>
${details}
<footer>${t('report.footer')}</footer>
</main>
<script>window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true))</script>
</body>
</html>`
}

/** Reporte en JSON, con credenciales ocultas. */
export function buildJsonReport(p: ReportParams & { info?: unknown }): string {
  const report = {
    generadoEl: p.generatedAt.toISOString(),
    arazzo: p.info,
    ambiente: p.servers,
    ambienteNombre: p.environment,
    casos: p.cases.map((r) => ({
      id: r.tc.id,
      titulo: r.tc.title,
      origen: r.tc.origin,
      simulado: r.simulated,
      parametros: r.inputsUsed ? maskDeep(r.inputsUsed) : undefined,
      esperado: r.tc.expectation.text,
      resultado: r.verdict,
      explicacion: r.explanation,
      pasos: maskDeep(r.steps),
      outputs: maskDeep(r.result?.outputs),
    })),
  }
  return JSON.stringify(report, null, 2)
}

/** Nombre de archivo del reporte: reporte-<titulo>-<fecha>.<ext> */
export function reportFileName(title: string, date: Date, ext: string): string {
  const stamp = date.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const slug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${t('report.filePrefix')}-${slug}-${stamp}.${ext}`
}
