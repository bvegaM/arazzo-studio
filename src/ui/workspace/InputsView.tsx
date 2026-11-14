/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import type { WorkflowAnalysis } from '../../core/analyze'
import { invalidPaths, leavesFirst, missingInputs } from '../../core/schemaForm'
import { t } from '../../i18n'
import { SchemaField } from '../components/SchemaField'

interface Props {
  wa: WorkflowAnalysis
  values: Record<string, any>
  setInput: (workflowId: string, name: string, value: any) => void
}

/** Pestaña "Inputs": los valores con que parte cada caso del journey. */
export function InputsView({ wa, values, setInput }: Props) {
  const props = leavesFirst(Object.entries<any>(wa.inputsSchema.properties ?? {}))
  const required = props.filter(([n]) => wa.requiredInputs.includes(n))
  const optional = props.filter(([n]) => !wa.requiredInputs.includes(n))
  const [showOptional, setShowOptional] = useState(false)
  const missing = missingInputs(wa.inputsSchema, values)
  const invalid = invalidPaths(wa.inputsSchema, values)

  const field = ([name, schema]: [string, any]) => (
    <SchemaField
      key={`${wa.workflow.workflowId}-${name}`}
      name={name}
      schema={schema}
      required={wa.requiredInputs.includes(name)}
      value={values[name]}
      onChange={(v) => setInput(wa.workflow.workflowId, name, v)}
    />
  )

  return (
    <div className="ws-view">
      <div className="ws-view-head">
        <p className="muted">{t('ws.inputs.description')}</p>
        {missing.length ? (
          <span className="badge b-err">{t('params.missingRequired', { n: missing.length })}</span>
        ) : (
          <span className="badge b-ok">✓ {t('params.requiredComplete')}</span>
        )}
        {invalid.length > 0 && <span className="badge b-warn">{t('params.invalidN', { n: invalid.length })}</span>}
      </div>
      {props.length === 0 ? (
        <p className="muted">{t('params.noInputs')}</p>
      ) : (
        <>
          {required.length > 0 && (
            <>
              <div className="sub-head">{t('params.required', { n: required.length })}</div>
              <div className="field-grid">{required.map(field)}</div>
            </>
          )}
          {optional.length > 0 && (
            <>
              <button className="link toggle-more" onClick={() => setShowOptional(!showOptional)}>
                {showOptional ? t('params.hideOptional', { n: optional.length }) : t('params.showOptional', { n: optional.length })}
              </button>
              {showOptional && <div className="field-grid">{optional.map(field)}</div>}
            </>
          )}
        </>
      )}
    </div>
  )
}
