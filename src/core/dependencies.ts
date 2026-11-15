// dependsOn entre workflows: el orden en que hay que ejecutarlos. Lo usan el análisis y el runner.
import type { Project } from './loader'
import { t } from '../i18n'

/**
 * Workflows de los que depende `workflowId` (también los indirectos), en el orden en que hay que
 * ejecutarlos. Error si alguno no existe, si es de otro documento Arazzo o si hay un ciclo.
 */
export function workflowDependencies(project: Pick<Project, 'arazzo'>, workflowId: string): { order: string[]; error?: string } {
  const byId = new Map(project.arazzo.workflows.map((w) => [w.workflowId, w]))
  const order: string[] = []
  const done = new Set<string>()
  const visiting: string[] = []
  const visit = (id: string): string | undefined => {
    if (done.has(id)) return undefined
    if (visiting.includes(id)) return t('run.depsCycle', { cycle: [...visiting.slice(visiting.indexOf(id)), id].join(' → ') })
    const wf = byId.get(id)
    if (!wf) return t('run.depsMissing', { workflow: id })
    visiting.push(id)
    for (const dep of wf.dependsOn ?? []) {
      if (dep.startsWith('$')) return t('run.depsExternal', { dep })
      const error = visit(dep)
      if (error) return error
    }
    visiting.pop()
    done.add(id)
    if (id !== workflowId) order.push(id)
    return undefined
  }
  const error = visit(workflowId)
  return error ? { order: [], error } : { order }
}

