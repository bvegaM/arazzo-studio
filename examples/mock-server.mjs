// Mock de la Credit Cards API para probar Arazzo Studio en local.
//   npm run mock              → se comporta según el contrato
//   MOCK_BUG=1 npm run mock   → introduce errores de contrato para ver las advertencias
import http from 'node:http'

const PORT = Number(process.env.PORT ?? 4010)
const BUG = process.env.MOCK_BUG === '1' || process.argv.includes('--bug')
const CARD_LAST4 = '4321'

const applications = new Map()
const cards = new Map([['CARD-1000', { cardId: 'CARD-1000', status: 'ACTIVE', productCode: 'LATAM_PASS_VISA', creditLimit: 2000 }]])
let seq = 1

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Channel,X-Country',
  'Access-Control-Expose-Headers': 'X-Request-Id',
}

function send(res, status, body) {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'X-Request-Id': `req-${Date.now()}` })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const error = (res, status, code, message) => send(res, status, { code, message })

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined)
      } catch {
        resolve(Symbol.for('invalid'))
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  console.log(`${req.method} ${path}`)

  if (!/^Bearer\s+\S+/i.test(req.headers.authorization ?? '')) return error(res, 401, 'UNAUTHORIZED', 'Token ausente o inválido')
  if (!req.headers['x-channel'] || !req.headers['x-country']) return error(res, 400, 'MISSING_HEADERS', 'X-Channel y X-Country son obligatorios')

  let m
  if (req.method === 'POST' && path === '/card-applications') {
    const body = await readBody(req)
    if (!body || typeof body !== 'object') return error(res, 400, 'INVALID_BODY', 'Body JSON requerido')
    if (!body.customerId) return error(res, 400, 'MISSING_FIELD', 'customerId es obligatorio')
    if (typeof body.requestedLimit !== 'number') return error(res, 400, 'INVALID_FIELD', 'requestedLimit debe ser numérico')
    if (!['LATAM_PASS_VISA', 'LATAM_PASS_MASTERCARD'].includes(body.productCode)) {
      return error(res, 422, 'INVALID_PRODUCT', `Producto no soportado: ${body.productCode}`)
    }
    const applicationId = `APP-${seq++}`
    applications.set(applicationId, { ...body, applicationId, status: 'PENDING' })
    return send(res, 201, { applicationId, status: 'PENDING' })
  }
  if (req.method === 'POST' && (m = path.match(/^\/card-applications\/([^/]+)\/approval$/))) {
    const app = applications.get(decodeURIComponent(m[1]))
    if (!app) return error(res, 404, 'NOT_FOUND', `Solicitud ${m[1]} no existe`)
    const cardId = `CARD-${1000 + seq++}`
    app.status = 'APPROVED'
    cards.set(cardId, { cardId, status: 'INACTIVE', productCode: app.productCode, creditLimit: app.requestedLimit })
    return send(res, 200, { applicationId: app.applicationId, status: 'APPROVED', cardId })
  }
  if (req.method === 'POST' && (m = path.match(/^\/cards\/([^/]+)\/activation$/))) {
    const card = cards.get(decodeURIComponent(m[1]))
    if (!card) return error(res, 404, 'NOT_FOUND', `Tarjeta ${m[1]} no existe`)
    const body = await readBody(req)
    if (!body?.last4Digits) return error(res, 400, 'MISSING_FIELD', 'last4Digits es obligatorio')
    if (!/^[0-9]{4}$/.test(body.last4Digits)) return error(res, 400, 'INVALID_FIELD', 'last4Digits debe tener 4 dígitos')
    if (body.last4Digits !== CARD_LAST4) return error(res, 422, 'DIGITS_MISMATCH', 'Los dígitos no coinciden con la tarjeta')
    card.status = 'ACTIVE'
    const out = { cardId: card.cardId, status: 'ACTIVE', activatedAt: new Date().toISOString() }
    if (BUG) delete out.activatedAt
    return send(res, 200, out)
  }
  if (req.method === 'GET' && (m = path.match(/^\/cards\/([^/]+)$/))) {
    const card = cards.get(decodeURIComponent(m[1]))
    if (!card) return error(res, 404, 'NOT_FOUND', `Tarjeta ${m[1]} no existe`)
    return send(res, 200, BUG ? { ...card, creditLimit: String(card.creditLimit) } : card)
  }
  return error(res, 404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${path}`)
})

server.listen(PORT, () => {
  console.log(`Mock Credit Cards API en http://localhost:${PORT}${BUG ? ' (con errores de contrato)' : ''}`)
  console.log(`Los últimos 4 dígitos válidos para activar son ${CARD_LAST4}. Cualquier token Bearer sirve.`)
})
