// "Generar documentación" de una colección: un README a partir de sus Arazzo (journeys, inputs y
// pasos), sus contratos y sus ambientes. Es un punto de partida que el equipo después edita.
import type { Journey } from './collection'
import type { SourceState } from './loader'
import { humanizeId } from './format'
import { t } from '../i18n'

export interface CollectionDocsInput {
  name: string
  version?: string
  journeys: Journey[]
  sources: SourceState[]
  environments: { name: string; servers: Record<string, string> }[]
}

const code = (s: string) => `\`${s}\``

export function collectionDocsMarkdown(c: CollectionDocsInput): string {
  const files = [...new Set(c.journeys.map((j) => j.file))]
  const out: string[] = [`# ${c.name}`, '']
  if (c.version) out.push(`${t('docsGen.version')}: ${code(c.version)}`, '')
  out.push(t('docsGen.summary', { journeys: c.journeys.length, files: files.length, contracts: c.sources.length }), '')

  out.push(`## ${t('docsGen.journeys')}`, '')
  for (const j of c.journeys) {
    const wf = j.wa.workflow
    out.push(`### ${humanizeId(wf.workflowId)}`, '')
    if (wf.summary) out.push(wf.summary, '')
    if (wf.description && wf.description !== wf.summary) out.push(wf.description.trim(), '')
    out.push(`- **${t('docsGen.file')}:** ${code(j.file)} · workflowId ${code(wf.workflowId)}`)
    if (wf.dependsOn?.length) out.push(`- **dependsOn:** ${wf.dependsOn.map(code).join(', ')}`)
    const props = Object.keys(j.wa.inputsSchema?.properties ?? {})
    const required = new Set<string>(j.wa.inputsSchema?.required ?? [])
    if (props.length) out.push(`- **${t('docsGen.inputs')}:** ${props.map((p) => `${code(p)}${required.has(p) ? '*' : ''}`).join(', ')}`)
    const outputs = Object.keys(wf.outputs ?? {})
    if (outputs.length) out.push(`- **${t('docsGen.outputs')}:** ${outputs.map(code).join(', ')}`)
    out.push('', `**${t('docsGen.steps')}**`, '')
    j.wa.steps.forEach((rs, i) => {
      const target = rs.op ? `${rs.op.method.toUpperCase()} ${code(rs.op.path)}` : rs.kind === 'workflow' ? `workflow ${code(rs.step.workflowId ?? '')}` : code(rs.label)
      out.push(`${i + 1}. **${rs.step.stepId}** — ${target}${rs.step.description ? `: ${rs.step.description}` : ''}`)
    })
    out.push('')
  }

  if (c.sources.length) {
    out.push(`## ${t('docsGen.contracts')}`, '')
    for (const s of c.sources) out.push(`- **${s.name}** (${s.type}) — ${code(s.fileName ?? s.url)}`)
    out.push('')
  }
  if (c.environments.length) {
    out.push(`## ${t('docsGen.environments')}`, '')
    for (const e of c.environments) {
      const urls = Object.entries(e.servers).filter(([, url]) => url)
      out.push(`- **${e.name}**${urls.length ? `: ${urls.map(([n, url]) => `${n} → ${code(url)}`).join(', ')}` : ''}`)
    }
    out.push('', t('docsGen.secretsNote'), '')
  }
  out.push('---', '', `*${t('docsGen.generated')}*`, '')
  return out.join('\n')
}
