// Autorización de un journey, por cada API que llama. Arazzo no tiene un concepto de auth: esto es
// de Arazzo Studio y se aplica en cada paso de cada ejecución. Se puede configurar para todos los
// journeys (por API) o solo para este; gana lo más específico.
import { useState } from 'react'
import type { WorkflowAnalysis } from '../../core/analyze'
import { AUTH_TYPES, type AuthType, type RequestAuth } from '../../core/requests'
import { apiTokenKey, journeyApis, journeyTokenKey } from '../../core/flowAuth'
import type { SecurityScheme } from '../../core/openapi'
import { COLLECTION_TOKEN, type RequestsApi } from '../../app/useRequests'
import { AuthPanel } from '../requests/AuthPanel'
import { Icon, Segmented } from '../components/kit'
import { t } from '../../i18n'

interface Props {
  journey: string
  wa: WorkflowAnalysis
  api: RequestsApi
  isDesktop: boolean
  envName: string
  onOpenEnv: () => void
  onOpenCollectionAuth?: () => void
}

const OWN_TYPES = AUTH_TYPES.filter((x) => x !== 'inherit')
const LOCK = 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4'

const schemeLabel = (s: SecurityScheme) => `${s.type === 'apiKey' ? `API key (${s.in} ${s.paramName ?? ''})` : s.type === 'basic' ? 'Basic' : s.type === 'other' ? s.schemeName : s.type === 'bearer' ? 'Bearer' : s.type === 'oauth2' ? 'OAuth 2.0' : 'OpenID Connect'} · ${s.schemeName}`

function ApiCard({ journey, source, schemes, api, isDesktop, envName, onOpenEnv, onOpenCollectionAuth }: Omit<Props, 'wa'> & { source: string; schemes: SecurityScheme[] }) {
  const own = api.flowAuth.journeys[journey]?.[source] ?? { type: 'inherit' as AuthType }
  const shared = api.flowAuth.apis[source] ?? { type: 'contract' as AuthType }
  const resolved = api.resolveFlow(journey, source)
  // Se abre en el nivel que está decidiendo hoy.
  const [scope, setScope] = useState<'journey' | 'api'>(own.type !== 'inherit' ? 'journey' : 'api')
  const label = (a: RequestAuth) => (a.type === 'contract' ? t('flowAuth.fromContract') : a.type === 'inherit' ? t('flowAuth.fromCollection') : t(`request.auth.${a.type}`))
  const effectiveLabel = resolved.auth ? (resolved.origin === 'collection' ? `${t('flowAuth.fromCollection')}: ${t(`request.auth.${resolved.auth.type}`)}` : t(`request.auth.${resolved.auth.type}`)) : t('flowAuth.fromContract')
  const tokenKey = scope === 'journey' ? journeyTokenKey(journey, source) : shared.type === 'inherit' ? COLLECTION_TOKEN : apiTokenKey(source)
  // El token se pide para la autorización que realmente se usa (la del nivel que gana).
  const editingEffective = (scope === 'journey') === (resolved.origin === 'journey')
  const contractBody = (
    <div className="rq-inherit">
      <p>
        {schemes.length ? t('flowAuth.contractUses', { schemes: schemes.map(schemeLabel).join(', '), env: envName }) : t('flowAuth.contractNone')}
      </p>
      {schemes.length > 0 && (
        <button className="small" onClick={onOpenEnv}>
          {t('flowAuth.openEnv')}
        </button>
      )}
    </div>
  )
  return (
    <section className="fa-card" data-api={source}>
      <div className="fa-head">
        <span className="fa-icon">
          <Icon d={LOCK} size={15} />
        </span>
        <div className="grow">
          <strong>{source}</strong>
          <span className="muted small">
            {t('flowAuth.effective')}: <b>{effectiveLabel}</b> · {t(`flowAuth.origin.${resolved.origin}`)}
          </span>
        </div>
        <Segmented
          options={[
            { id: 'journey', label: t('flowAuth.scope.journey') },
            { id: 'api', label: t('flowAuth.scope.api') },
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      {scope === 'journey' ? (
        <AuthPanel
          auth={own}
          onChange={(a) => api.setJourneyAuth(journey, source, a)}
          types={['inherit', ...OWN_TYPES]}
          labels={{ inherit: t('flowAuth.sameAsApi'), contract: t('flowAuth.fromContract') }}
          inheritBody={<div className="rq-inherit"><p>{t('flowAuth.inheritApi', { source, auth: label(shared) })}</p><button className="small" onClick={() => setScope('api')}>{t('flowAuth.editApi')}</button></div>}
          contractBody={contractBody}
          isDesktop={isDesktop}
          oauth2={editingEffective ? { token: api.tokens[tokenKey], onObtain: () => api.obtainFlowToken(journey, source), onClear: () => api.clearToken(tokenKey) } : undefined}
        />
      ) : (
        <AuthPanel
          auth={shared}
          onChange={(a) => api.setApiAuth(source, a)}
          types={['contract', 'inherit', ...OWN_TYPES.filter((x) => x !== 'contract')]}
          labels={{ inherit: t('request.auth.inherit'), contract: t('flowAuth.fromContract') }}
          inherited={api.collectionAuth}
          onOpenCollectionAuth={onOpenCollectionAuth}
          contractBody={contractBody}
          isDesktop={isDesktop}
          oauth2={editingEffective ? { token: api.tokens[tokenKey], onObtain: () => api.obtainFlowToken(journey, source), onClear: () => api.clearToken(tokenKey) } : undefined}
        />
      )}
      {scope === 'api' && <p className="muted small">{t('flowAuth.apiHint')}</p>}
    </section>
  )
}

export function FlowAuthView(p: Props) {
  const apis = journeyApis(p.wa)
  return (
    <div className="flow-auth">
      <p className="muted">{t('flowAuth.lead')}</p>
      {apis.length === 0 ? <p className="muted small">{t('flowAuth.noApis')}</p> : apis.map((a) => <ApiCard key={a.source} {...p} source={a.source} schemes={a.schemes} />)}
    </div>
  )
}
