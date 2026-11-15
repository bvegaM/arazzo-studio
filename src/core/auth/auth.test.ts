import { describe, expect, it } from 'vitest'
import { hmac, md5, sha, toBase64, toHex } from './crypto'
import { digestAuthorization, parseDigestChallenge, signAkamai, signAwsV4, signOAuth1, signWsse, wsseHeader } from './sign'

describe('primitivas', () => {
  it('MD5 (vectores de RFC 1321)', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a')
  })
  it('SHA y HMAC', async () => {
    expect(toHex(await sha('SHA-256', 'abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(toHex(await hmac('SHA-256', 'key', 'The quick brown fox jumps over the lazy dog'))).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })
})

describe('AWS Signature v4', () => {
  it('el ejemplo de la documentación de AWS (IAM ListUsers)', async () => {
    const req = await signAwsV4(
      {
        method: 'GET',
        url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      },
      { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'iam' },
      new Date('2015-08-30T12:36:00Z'),
    )
    expect(req.headers['X-Amz-Date']).toBe('20150830T123600Z')
    expect(req.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })
  it('con session token y S3', async () => {
    const req = await signAwsV4({ method: 'PUT', url: 'https://b.s3.amazonaws.com/a b.txt', headers: {}, body: 'hola' }, { accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T', region: 'us-east-1', service: 's3' })
    expect(req.headers['X-Amz-Security-Token']).toBe('T')
    expect(req.headers['X-Amz-Content-Sha256']).toBe(toHex(await sha('SHA-256', 'hola')))
    expect(req.headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token')
  })
})

describe('OAuth 1.0', () => {
  it('el ejemplo de la documentación de Twitter (HMAC-SHA1)', async () => {
    const req = await signOAuth1(
      {
        method: 'POST',
        url: 'https://api.twitter.com/1/statuses/update.json?include_entities=true',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21',
      },
      {
        consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
        consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
        signatureMethod: 'HMAC-SHA1',
      },
      { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' },
    )
    expect(req.headers.Authorization).toContain('oauth_signature="tnnArxj06cWHq44gCs1OSKk%2FjLY%3D"')
    expect(req.headers.Authorization).toMatch(/^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"/)
  })
  it('PLAINTEXT y en la query', async () => {
    const req = await signOAuth1({ method: 'GET', url: 'https://x/a?b=1', headers: {} }, { consumerKey: 'k', consumerSecret: 's&', signatureMethod: 'PLAINTEXT', addTo: 'query' }, { nonce: 'n', timestamp: '1' })
    expect(new URL(req.url).searchParams.get('oauth_signature')).toBe('s%26&')
    expect(req.headers.Authorization).toBeUndefined()
  })
})

describe('Digest', () => {
  it('el ejemplo de RFC 2617 (Mufasa)', async () => {
    const c = parseDigestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')!
    expect(c).toMatchObject({ realm: 'testrealm@host.com', qop: 'auth,auth-int' })
    const value = await digestAuthorization(c, { username: 'Mufasa', password: 'Circle Of Life', method: 'GET', uri: '/dir/index.html' }, { cnonce: '0a4f113b', nc: '00000001' })
    expect(value).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(value).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
    expect(parseDigestChallenge('Basic realm="x"')).toBeUndefined()
  })
  it('SHA-256 (RFC 7616)', async () => {
    const c = parseDigestChallenge('Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"')!
    const value = await digestAuthorization(c, { username: 'Mufasa', password: 'Circle of Life', method: 'GET', uri: '/dir/index.html' }, { cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ', nc: '00000001' })
    expect(value).toContain('response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"')
  })
})

describe('WSSE y Akamai', () => {
  it('WSSE: digest de nonce + fecha + contraseña', async () => {
    const value = await wsseHeader('ash', 'pika', { nonce: 'abc', created: '2026-01-01T00:00:00Z' })
    const digest = toBase64(await sha('SHA-1', 'abc2026-01-01T00:00:00Zpika'))
    expect(value).toBe(`UsernameToken Username="ash", PasswordDigest="${digest}", Nonce="${btoa('abc')}", Created="2026-01-01T00:00:00Z"`)
    const req = await signWsse({ method: 'GET', url: 'https://x', headers: {} }, 'ash', 'pika')
    expect(req.headers.Authorization).toBe('WSSE profile="UsernameToken"')
  })
  it('Akamai EdgeGrid: firma del método, la ruta, los headers elegidos y el body', async () => {
    const opts = { clientToken: 'akab-client', accessToken: 'akab-access', clientSecret: 'secret', headersToSign: 'X-Test' }
    const fixed = { nonce: 'nonce-1', timestamp: '20140321T19:34:21+0000' }
    const req = await signAkamai({ method: 'POST', url: 'https://akab-host.luna.akamaiapis.net/a/b?c=1', headers: { 'X-Test': '  hola   mundo ' }, body: '{"x":1}' }, opts, fixed)
    const prefix = 'EG1-HMAC-SHA256 client_token=akab-client;access_token=akab-access;timestamp=20140321T19:34:21+0000;nonce=nonce-1;'
    const data = ['POST', 'https', 'akab-host.luna.akamaiapis.net', '/a/b?c=1', 'x-test:hola mundo', toBase64(await sha('SHA-256', '{"x":1}')), prefix].join('\t')
    const key = toBase64(await hmac('SHA-256', 'secret', fixed.timestamp))
    expect(req.headers.Authorization).toBe(`${prefix}signature=${toBase64(await hmac('SHA-256', key, data))}`)
  })
})
