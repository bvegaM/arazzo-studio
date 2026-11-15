// Aplica al request ya armado las autorizaciones que firman (AWS, OAuth 1.0, WSSE, Akamai). Basic,
// Bearer y API key se ponen al armarlo; Digest, NTLM y OAuth 2.0 necesitan hablar con el servidor
// y los resuelve quien envía (ver useRequests).
import type { HttpRequest } from '../http'
import type { RequestAuth } from '../requests'
import type { OAuth2Config } from './oauth2'
import { signAkamai, signAwsV4, signOAuth1, signWsse } from './sign'

export const needsServer = (a: RequestAuth) => a.type === 'digest' || a.type === 'ntlm' || a.type === 'oauth2'

export async function signRequest(req: HttpRequest, a: RequestAuth): Promise<HttpRequest> {
  switch (a.type) {
    case 'awsv4':
      return signAwsV4(req, {
        accessKeyId: a.accessKeyId ?? '',
        secretAccessKey: a.secretAccessKey ?? '',
        sessionToken: a.sessionToken || undefined,
        region: a.region || 'us-east-1',
        service: a.service || 'execute-api',
      })
    case 'oauth1':
      return signOAuth1(req, {
        consumerKey: a.consumerKey ?? '',
        consumerSecret: a.consumerSecret ?? '',
        token: a.token || undefined,
        tokenSecret: a.tokenSecret || undefined,
        signatureMethod: a.signatureMethod ?? 'HMAC-SHA1',
        realm: a.realm || undefined,
        addTo: a.addTo ?? 'header',
      })
    case 'wsse':
      return signWsse(req, a.username ?? '', a.password ?? '')
    case 'akamai':
      return signAkamai(req, {
        clientToken: a.clientToken ?? '',
        accessToken: a.accessToken ?? '',
        clientSecret: a.clientSecret ?? '',
        headersToSign: a.headersToSign,
        maxBodySize: a.maxBodySize ? Number(a.maxBodySize) : undefined,
      })
    default:
      return req
  }
}

/** La configuración de OAuth 2.0 de una autorización. */
export function oauth2Config(a: RequestAuth): OAuth2Config {
  return {
    grantType: a.grantType ?? 'client_credentials',
    accessTokenUrl: a.accessTokenUrl ?? '',
    authorizationUrl: a.authorizationUrl,
    callbackUrl: a.callbackUrl,
    clientId: a.clientId ?? '',
    clientSecret: a.clientSecret || undefined,
    scope: a.scope || undefined,
    audience: a.audience || undefined,
    username: a.username,
    password: a.password,
    pkce: a.pkce ?? true,
    credentialsIn: a.credentialsIn ?? 'header',
    tokenIn: a.tokenIn ?? 'header',
    headerPrefix: a.headerPrefix ?? 'Bearer',
  }
}
