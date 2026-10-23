import { useMemo, useState } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Issue, ResolvedStep, WorkflowAnalysis } from '../core/analyze'
import { MethodBadge } from './common'
import { requirementsFromCriteria, statusesInCriteria } from '../core/criteria'
import type { Action } from '../core/types'
import { Pill } from './kit'

type StepNodeData = { rs: ResolvedStep; index: number; issues: Issue[] }

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { rs, index, issues } = data
  const errors = issues.filter((i) => i.level === 'error')
  return (
    <div className={`step-node ${errors.length ? 'has-error' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Top} id="goto-in" style={{ left: '14%' }} />
      <Handle type="source" position={Position.Right} id="out" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Right} id="in" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Left} id="act-out" style={{ top: '50%' }} />
      <div className="title">
        <span className="muted">{index + 1}.</span> {rs.step.stepId}
        {rs.mutating && <span className="badge b-warn" title="Modifica datos">modifica datos</span>}
      </div>
      {rs.op ? (
        <div className="path">
          <MethodBadge method={rs.op.method} /> {rs.op.path}
        </div>
      ) : (
        <div className="path">{rs.label}</div>
      )}
      <div className="meta">
        {rs.op ? `${rs.op.operationId ?? 'sin operationId'} · fuente ${rs.op.sourceName}` : rs.kind === 'workflow' ? 'Sub-workflow' : 'Operación no encontrada'}
      </div>
      {rs.step.successCriteria?.length ? (
        <div className="meta">
          Éxito: <code>{rs.step.successCriteria.map((c) => c.condition).join(' y ')}</code>
        </div>
      ) : null}
      {errors.length > 0 && <div className="meta" style={{ color: 'var(--err)' }}>{errors.length} error(es)</div>}
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  )
}

interface ActionRow {
  trigger: 'onFailure' | 'onSuccess' | 'sin-manejo'
  statuses: string
  detail: string
  name: string
  effect: string
  kind: 'end' | 'goto' | 'retry' | 'none'
}
type ActionsNodeData = { rows: ActionRow[] }

const ROW_H = 30
const ACTIONS_HEAD = 34

function ActionsNode({ data }: NodeProps<Node<ActionsNodeData>>) {
  return (
    <div className="actions-node">
      <Handle type="target" position={Position.Right} id="in" style={{ top: ACTIONS_HEAD / 2 }} />
      <div className="actions-head">Según la respuesta</div>
      {data.rows.map((r, i) => (
        <div className={`action-row ${r.trigger === 'sin-manejo' ? 'unhandled' : ''}`} key={i} style={{ height: ROW_H }}>
          {r.kind === 'goto' && <Handle type="source" position={Position.Left} id={`g${i}`} style={{ top: ACTIONS_HEAD + i * ROW_H + ROW_H / 2 }} />}
          <span className={`badge ${r.trigger === 'onSuccess' ? 'b-ok' : r.trigger === 'sin-manejo' ? 'b-skip' : 'b-err'}`}>{r.statuses}</span>
          {r.detail && <code className="detail">{r.detail}</code>}
          <span className="arrow">→</span>
          <span className="name" title={r.name}>{r.name}</span>
          <span className={`effect e-${r.kind}`}>{r.effect}</span>
        </div>
      ))}
    </div>
  )
}

type EndNodeData = { outputs: string[] }

function EndNode({ data }: NodeProps<Node<EndNodeData>>) {
  return (
    <div className="end-node">
      <Handle type="target" position={Position.Top} id="top" />
      <strong>✅ Fin del workflow</strong>
      {data.outputs.length > 0 && <div className="meta">Outputs: {data.outputs.join(', ')}</div>}
    </div>
  )
}

const nodeTypes = { step: StepNode, actions: ActionsNode, end: EndNode }

function actionRows(rs: ResolvedStep, wa: WorkflowAnalysis): ActionRow[] {
  const wf = wa.workflow
  const rows: ActionRow[] = []
  const groups: ['onFailure' | 'onSuccess', Action[]][] = [
    ['onSuccess', rs.step.onSuccess ?? wf.successActions ?? []],
    ['onFailure', rs.step.onFailure ?? wf.failureActions ?? []],
  ]
  for (const [trigger, actions] of groups) {
    for (const a of actions) {
      const statuses = statusesInCriteria(a.criteria)
      const detail = requirementsFromCriteria(a.criteria)
        .bodyValues.map((b) => String(b.value))
        .join(' ')
      const kind = (a.type ?? 'none') as ActionRow['kind']
      rows.push({
        trigger,
        statuses: statuses.length ? statuses.join(' | ') : trigger === 'onSuccess' ? 'éxito' : 'otro error',
        detail,
        name: a.name ?? a.type ?? '(sin nombre)',
        effect:
          a.type === 'end'
            ? trigger === 'onSuccess' ? 'fin ✓' : 'fin ✕'
            : a.type === 'goto'
              ? `ir a ${a.stepId ?? a.workflowId}`
              : a.type === 'retry'
                ? `reintenta${a.retryLimit ? ` ×${a.retryLimit}` : ''}`
                : '',
        kind,
      })
    }
  }
  const cov = wa.coverage.find((c) => c.stepId === rs.step.stepId)
  for (const r of cov?.rows ?? []) {
    if (r.kind === 'sin-manejo') {
      rows.push({ trigger: 'sin-manejo', statuses: r.status, detail: '', name: 'sin acción', effect: 'falla', kind: 'none' })
    }
  }
  return rows
}

function buildGraph(wa: WorkflowAnalysis, opts: { actions: boolean; data: boolean }): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let y = 0
  const STEP_H = 120
  wa.steps.forEach((rs, index) => {
    const rows = opts.actions ? actionRows(rs, wa) : []
    nodes.push({
      id: rs.step.stepId,
      type: 'step',
      position: { x: 0, y },
      data: { rs, index, issues: wa.issues.filter((i) => i.stepId === rs.step.stepId) },
    })
    if (rows.length) {
      const id = `actions-${rs.step.stepId}`
      nodes.push({ id, type: 'actions', position: { x: -470, y }, data: { rows } })
      edges.push({
        id: `act-${rs.step.stepId}`,
        source: rs.step.stepId,
        sourceHandle: 'act-out',
        target: id,
        targetHandle: 'in',
        type: 'smoothstep',
        style: { stroke: 'var(--err)' },
      })
      rows.forEach((r, i) => {
        if (r.kind !== 'goto') return
        const target = r.effect.replace(/^ir a /, '')
        if (!wa.steps.some((s) => s.step.stepId === target)) return
        edges.push({
          id: `goto-${rs.step.stepId}-${i}`,
          source: id,
          sourceHandle: `g${i}`,
          target,
          targetHandle: 'goto-in',
          type: 'smoothstep',
          pathOptions: { offset: 30, borderRadius: 12 },
          label: `${r.statuses} · ${r.name}`,
          animated: true,
          style: { stroke: 'var(--warn)', strokeWidth: 1.5 },
          labelStyle: { fill: 'var(--warn)', fontWeight: 600, fontSize: 12 },
          labelBgStyle: { fill: 'var(--surface)' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--warn)' },
        } as Edge)
      })
    }
    y += Math.max(STEP_H, rows.length ? ACTIONS_HEAD + rows.length * ROW_H + 10 : 0) + 70
  })
  for (let i = 0; i < wa.steps.length - 1; i++) {
    edges.push({
      id: `seq-${i}`,
      source: wa.steps[i].step.stepId,
      sourceHandle: 'bottom',
      target: wa.steps[i + 1].step.stepId,
      targetHandle: 'top',
      label: 'éxito',
      labelStyle: { fill: 'var(--ok)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--surface)' },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--ok)' },
    })
  }
  if (wa.steps.length) {
    nodes.push({ id: '__end', type: 'end', position: { x: 50, y }, data: { outputs: Object.keys(wa.workflow.outputs ?? {}) } })
    edges.push({
      id: 'seq-end',
      source: wa.steps[wa.steps.length - 1].step.stepId,
      sourceHandle: 'bottom',
      target: '__end',
      targetHandle: 'top',
      label: 'éxito',
      labelStyle: { fill: 'var(--ok)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--surface)' },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--ok)' },
    })
  }
  const indexOf = (id: string) => wa.steps.findIndex((s) => s.step.stepId === id)
  if (opts.data) wa.dataEdges.forEach((e, i) => {
    // Cada flecha de datos sale hacia la derecha; cuanto más lejos va, más se abre para no encimarse.
    const distance = Math.max(1, indexOf(e.toStep) - indexOf(e.fromStep))
    edges.push({
      id: `data-${i}`,
      source: e.fromStep,
      sourceHandle: 'out',
      target: e.toStep,
      targetHandle: 'in',
      type: 'smoothstep',
      pathOptions: { offset: 24 + distance * 34, borderRadius: 10 },
      label: e.output,
      animated: true,
      style: { stroke: 'var(--accent)', strokeDasharray: '5 4' },
      labelStyle: { fill: 'var(--accent)', fontWeight: 600, fontSize: 12 },
      labelBgStyle: { fill: 'var(--surface)' },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
    } as Edge)
  })
  return { nodes, edges }
}


export function WorkflowGraph({ wa }: { wa: WorkflowAnalysis }) {
  const [showActions, setShowActions] = useState(true)
  const [showData, setShowData] = useState(true)
  const graph = useMemo(() => buildGraph(wa, { actions: showActions, data: showData }), [wa, showActions, showData])
  const actionCount = wa.steps.reduce((n, s) => n + (s.step.onFailure?.length ?? 0) + (s.step.onSuccess?.length ?? 0), 0)
  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <span className="muted small">Mostrar:</span>
        <Pill active={showActions} onClick={() => setShowActions(!showActions)}>
          <span className="dot d-err" /> Acciones según la respuesta {actionCount > 0 && <span className="count">{actionCount}</span>}
        </Pill>
        <Pill active={showData} onClick={() => setShowData(!showData)}>
          <span className="dot d-accent" /> Flujo de datos {wa.dataEdges.length > 0 && <span className="count">{wa.dataEdges.length}</span>}
        </Pill>
        <span className="spacer" />
        <span className="legend small muted">
          <span className="dot d-ok" /> éxito <span className="dot d-warn" /> goto
        </span>
      </div>
      <div className="graph">
        <ReactFlow
          key={`${wa.workflow.workflowId}-${showActions}-${showData}`}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesConnectable={false}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
