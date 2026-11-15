// Autorización de un request (o de la colección), con los mismos tipos que Bruno: AWS Sig v4, Basic,
// Bearer, Digest, NTLM, OAuth 1.0, OAuth 2.0, WSSE, API Key, Akamai EdgeGrid, heredar o ninguna.
import { useState, type ReactNode } from 'react'
import { AUTH_TYPES, type AuthType, type RequestAuth } from '../../core/requests'
import { tokenValid, type OAuth2Token } from '../../core/auth/oauth2'
import { webCallbackUrl } from '../../app/useRequests'
import { TemplateInput } from '../components/TemplateInput'
import { Icon, Segmented } from '../components/kit'
import { t } from '../../i18n'

export interface OAuth2Controls {
  token?: OAuth2Token
  onObtain: () => Promise<string | undefined>
  onClear: () => void
}

interface Props {
  auth: RequestAuth
  onChange: (a: RequestAuth) => void
  /** Requests: se puede heredar la de la colección (que se muestra). */
  inherited?: RequestAuth
  allowInherit?: boolean
  onOpenCollectionAuth?: () => void
  oauth2?: OAuth2Controls
  isDesktop: boolean
  /** Tipos que se ofrecen (por defecto, los de un request). */
  types?: AuthType[]
  /** Nombres propios de algunos tipos (p. ej. qué significa "heredar" en cada lugar). */
  labels?: Partial<Record<AuthType, string>>
  /** Lo que se muestra con `inherit` y con `contract` (en los journeys). */
  inheritBody?: ReactNode
  contractBody?: ReactNode
}

const EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'

/** Un campo de la autorización; los secretos se tapan y se pueden mostrar. */
function Field({ label, value, onChange, placeholder, secret, hint }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean; hint?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <label className="rq-field">
      <span>{label}</span>
      <span className="rq-field-input">
        <TemplateInput value={value ?? ''} placeholder={placeholder} onChange={onChange} spellCheck={false} type={secret && !shown && !(value ?? '').includes('{{') ? 'password' : 'text'} />
        {secret && (
          <button type="button" className="icon-btn rq-eye" onClick={() => setShown((s) => !s)} aria-label={t(shown ? 'request.auth.hide' : 'request.auth.show')} title={t(shown ? 'request.auth.hide' : 'request.auth.show')}>
            <Icon d={EYE} size={14} />
          </button>
        )}
      </span>
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="rq-field">
      <span>{label}</span>
      <Segmented options={options} value={value} onChange={onChange} />
    </label>
  )
}

const defaultLabel = (type: AuthType) => t(`request.auth.${type}`)

/** Estado del token de OAuth 2.0 y los botones para pedirlo o borrarlo. */
function OAuth2Token({ controls, grant }: { controls: OAuth2Controls; grant?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const tok = controls.token
  const valid = tokenValid(tok)
  const until = tok?.expiresAt ? new Date(tok.expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : undefined
  return (
    <div className="rq-token">
      <div className="rq-token-row">
        <span className={`rq-token-dot ${valid ? 'ok' : tok ? 'expired' : ''}`} />
        <span className="grow">
          {!tok ? t('request.oauth2.noToken') : valid ? (until ? t('request.oauth2.validUntil', { time: until }) : t('request.oauth2.valid')) : t('request.oauth2.expired')}
          {tok && <code className="rq-token-preview">{`${tok.accessToken.slice(0, 6)}••••`}</code>}
        </span>
        {tok && (
          <button className="small ghost" onClick={controls.onClear}>
            {t('request.oauth2.clear')}
          </button>
        )}
        <button
          className="small primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(await controls.onObtain())
            setBusy(false)
          }}
        >
          {busy ? t('request.oauth2.getting') : t('request.oauth2.get')}
        </button>
      </div>
      {grant !== 'authorization_code' && !tok && <small className="muted">{t('request.oauth2.auto')}</small>}
      {error && <div className="callout err small">{error}</div>}
      <small className="muted">{t('request.oauth2.memoryOnly')}</small>
    </div>
  )
}

export function AuthPanel({ auth, onChange, inherited, allowInherit, onOpenCollectionAuth, oauth2, isDesktop, types: offered, labels, inheritBody, contractBody }: Props) {
  const typeLabel = (type: AuthType) => labels?.[type] ?? defaultLabel(type)
  const set = (patch: Partial<RequestAuth>) => onChange({ ...auth, ...patch })
  const f = (label: string, key: keyof RequestAuth, opts: { placeholder?: string; secret?: boolean; hint?: string } = {}) => (
    <Field label={label} value={auth[key] as string | undefined} onChange={(v) => set({ [key]: v })} {...opts} />
  )
  const types = offered ?? AUTH_TYPES.filter((x) => allowInherit || x !== 'inherit')
  let body: ReactNode = null
  switch (auth.type) {
    case 'contract':
      body = contractBody
      break
    case 'inherit':
      body = inheritBody ?? (
        <div className="rq-inherit">
          <p>
            {inherited && inherited.type !== 'none' && inherited.type !== 'inherit'
              ? t('request.auth.inheritFrom', { type: typeLabel(inherited.type) })
              : t('request.auth.inheritNone')}
          </p>
          {onOpenCollectionAuth && (
            <button className="small" onClick={onOpenCollectionAuth}>
              {t('request.auth.configureCollection')}
            </button>
          )}
        </div>
      )
      break
    case 'none':
      body = <p className="muted small">{t('request.auth.noneHint')}</p>
      break
    case 'basic':
      body = (
        <div className="rq-grid">
          {f(t('request.auth.username'), 'username')}
          {f(t('request.auth.password'), 'password', { secret: true, placeholder: '{{password}}' })}
        </div>
      )
      break
    case 'bearer':
      body = (
        <div className="rq-grid">
          {f(t('request.auth.token'), 'token', { secret: true, placeholder: '{{token}}' })}
          {f(t('request.auth.prefix'), 'prefix', { placeholder: 'Bearer' })}
        </div>
      )
      break
    case 'digest':
      body = (
        <>
          <div className="rq-grid">
            {f(t('request.auth.username'), 'username')}
            {f(t('request.auth.password'), 'password', { secret: true, placeholder: '{{password}}' })}
          </div>
          <p className="muted small">{t('request.auth.digestHint')}</p>
        </>
      )
      break
    case 'ntlm':
      body = (
        <>
          {!isDesktop && <div className="callout warn small">{t('request.auth.ntlmDesktop')}</div>}
          <div className="rq-grid">
            {f(t('request.auth.username'), 'username')}
            {f(t('request.auth.password'), 'password', { secret: true, placeholder: '{{password}}' })}
            {f(t('request.auth.domain'), 'domain', { placeholder: 'CORP' })}
            {f(t('request.auth.workstation'), 'workstation')}
          </div>
        </>
      )
      break
    case 'wsse':
      body = (
        <div className="rq-grid">
          {f(t('request.auth.username'), 'username')}
          {f(t('request.auth.password'), 'password', { secret: true, placeholder: '{{password}}' })}
        </div>
      )
      break
    case 'apikey':
      body = (
        <div className="rq-grid">
          {f(t('request.auth.key'), 'key', { placeholder: 'X-API-Key' })}
          {f(t('request.auth.value'), 'value', { secret: true, placeholder: '{{apiKey}}' })}
          <Choice
            label={t('request.auth.in')}
            value={auth.in ?? 'header'}
            options={[
              { id: 'header', label: 'Header' },
              { id: 'query', label: 'Query' },
            ]}
            onChange={(v) => set({ in: v })}
          />
        </div>
      )
      break
    case 'awsv4':
      body = (
        <div className="rq-grid">
          {f('Access Key ID', 'accessKeyId', { placeholder: '{{awsAccessKeyId}}' })}
          {f('Secret Access Key', 'secretAccessKey', { secret: true, placeholder: '{{awsSecretAccessKey}}' })}
          {f('Session Token', 'sessionToken', { secret: true, hint: t('request.auth.optional') })}
          {f(t('request.auth.service'), 'service', { placeholder: 'execute-api' })}
          {f(t('request.auth.region'), 'region', { placeholder: 'us-east-1' })}
        </div>
      )
      break
    case 'oauth1':
      body = (
        <div className="rq-grid">
          {f('Consumer Key', 'consumerKey')}
          {f('Consumer Secret', 'consumerSecret', { secret: true })}
          {f('Access Token', 'token', { secret: true })}
          {f('Token Secret', 'tokenSecret', { secret: true })}
          <label className="rq-field">
            <span>{t('request.auth.signatureMethod')}</span>
            <select value={auth.signatureMethod ?? 'HMAC-SHA1'} onChange={(e) => set({ signatureMethod: e.target.value as RequestAuth['signatureMethod'] })}>
              {['HMAC-SHA1', 'HMAC-SHA256', 'PLAINTEXT'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {f('Realm', 'realm', { hint: t('request.auth.optional') })}
          <Choice
            label={t('request.auth.addTo')}
            value={auth.addTo ?? 'header'}
            options={[
              { id: 'header', label: 'Header' },
              { id: 'query', label: 'Query' },
            ]}
            onChange={(v) => set({ addTo: v })}
          />
        </div>
      )
      break
    case 'oauth2': {
      const grant = auth.grantType ?? 'client_credentials'
      body = (
        <>
          <label className="rq-field rq-wide">
            <span>{t('request.oauth2.grant')}</span>
            <select value={grant} onChange={(e) => set({ grantType: e.target.value as RequestAuth['grantType'] })}>
              {(['authorization_code', 'client_credentials', 'password'] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`request.oauth2.grant.${g}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="rq-grid">
            {grant === 'authorization_code' && f(t('request.oauth2.authUrl'), 'authorizationUrl', { placeholder: 'https://auth.example.com/authorize' })}
            {f(t('request.oauth2.tokenUrl'), 'accessTokenUrl', { placeholder: 'https://auth.example.com/oauth/token' })}
            {grant === 'authorization_code' &&
              f(t('request.oauth2.callbackUrl'), 'callbackUrl', {
                placeholder: isDesktop ? 'https://localhost/callback' : webCallbackUrl(),
                hint: isDesktop ? t('request.oauth2.callbackDesktop') : t('request.oauth2.callbackWeb', { url: webCallbackUrl() }),
              })}
            {f('Client ID', 'clientId')}
            {f('Client Secret', 'clientSecret', { secret: true, hint: grant === 'authorization_code' ? t('request.auth.optional') : undefined })}
            {grant === 'password' && f(t('request.auth.username'), 'username')}
            {grant === 'password' && f(t('request.auth.password'), 'password', { secret: true })}
            {f('Scope', 'scope', { placeholder: 'read write' })}
            {f('Audience', 'audience', { hint: t('request.auth.optional') })}
            <Choice
              label={t('request.oauth2.credentialsIn')}
              value={auth.credentialsIn ?? 'header'}
              options={[
                { id: 'header', label: 'Basic Auth header' },
                { id: 'body', label: 'Body' },
              ]}
              onChange={(v) => set({ credentialsIn: v })}
            />
            <Choice
              label={t('request.oauth2.tokenIn')}
              value={auth.tokenIn ?? 'header'}
              options={[
                { id: 'header', label: 'Header' },
                { id: 'query', label: 'Query' },
              ]}
              onChange={(v) => set({ tokenIn: v })}
            />
            {(auth.tokenIn ?? 'header') === 'header' && f(t('request.auth.prefix'), 'headerPrefix', { placeholder: 'Bearer' })}
            {grant === 'authorization_code' && (
              <label className="rq-field rq-check">
                <input type="checkbox" className="check" checked={auth.pkce ?? true} onChange={(e) => set({ pkce: e.target.checked })} /> PKCE (S256)
              </label>
            )}
          </div>
          {oauth2 && <OAuth2Token controls={oauth2} grant={grant} />}
        </>
      )
      break
    }
    case 'akamai':
      body = (
        <div className="rq-grid">
          {f('Client Token', 'clientToken', { secret: true })}
          {f('Client Secret', 'clientSecret', { secret: true })}
          {f('Access Token', 'accessToken', { secret: true })}
          {f(t('request.auth.headersToSign'), 'headersToSign', { placeholder: 'X-Custom-Header', hint: t('request.auth.optional') })}
          {f(t('request.auth.maxBody'), 'maxBodySize', { placeholder: '131072', hint: t('request.auth.optional') })}
        </div>
      )
      break
  }
  const secretsNote = !['none', 'inherit', 'contract'].includes(auth.type)
  return (
    <div className="rq-auth">
      <label className="rq-field rq-auth-type">
        <span>{t('request.auth.type')}</span>
        <select value={auth.type} onChange={(e) => onChange({ type: e.target.value as AuthType })}>
          {types.map((x) => (
            <option key={x} value={x}>
              {typeLabel(x)}
              {x === 'akamai' ? ' (Beta)' : ''}
              {(x === 'ntlm' && !isDesktop) ? ` · ${t('sidebar.desktopOnly')}` : ''}
            </option>
          ))}
        </select>
      </label>
      {body}
      {secretsNote && <p className="muted small">{t('request.auth.secretHint')}</p>}
    </div>
  )
}
