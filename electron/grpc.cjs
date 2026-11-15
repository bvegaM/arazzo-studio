// gRPC desde el proceso principal (el navegador no puede abrir conexiones gRPC). Lee los .proto de
// la colección, describe sus servicios y llama a cualquier método: unario, streaming del servidor,
// del cliente o bidireccional (en estos dos últimos, envía el mensaje y cierra el envío).
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LOAD_OPTIONS = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
const MAX_PROTO_FILES = 200
const DEADLINE_MS = 30_000
const MAX_STREAM_MESSAGES = 500

/** Ruta relativa segura (sin salir de la carpeta temporal). */
function safeRelative(rel) {
  const clean = path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^\/+/, '')
  if (!clean || clean.startsWith('..') || !clean.endsWith('.proto')) throw new Error(`Ruta de .proto inválida: ${rel}`)
  return clean
}

/** Escribe los .proto en una carpeta temporal propia (por contenido) y carga el de entrada. */
function load(files, entry) {
  const entries = Object.entries(files ?? {})
  if (!entries.length || entries.length > MAX_PROTO_FILES) throw new Error('No hay archivos .proto para cargar.')
  const hash = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16)
  const root = path.join(os.tmpdir(), 'arazzo-studio-grpc', hash)
  for (const [rel, text] of entries) {
    const target = path.join(root, safeRelative(rel))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, String(text))
  }
  const main = path.join(root, safeRelative(entry))
  const includeDirs = [root, path.dirname(main)]
  // Un import como "common/types.proto" de un archivo que se importó suelto (sin su carpeta): se
  // deja una copia en esa ruta para que se resuelva igual.
  const byName = new Map(entries.map(([rel, text]) => [path.posix.basename(safeRelative(rel)), text]))
  for (const [, text] of entries) {
    for (const m of String(text).matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"/gm)) {
      const wanted = m[1]
      if (wanted.startsWith('google/protobuf/')) continue
      if (includeDirs.some((dir) => fs.existsSync(path.join(dir, wanted)))) continue
      const copy = byName.get(path.posix.basename(wanted))
      if (copy === undefined) continue
      const target = path.join(root, safeRelative(wanted))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, String(copy))
    }
  }
  return protoLoader.loadSync(main, { ...LOAD_OPTIONS, includeDirs })
}

const isService = (def) => def && typeof def === 'object' && !def.format && Object.values(def).some((m) => m && m.path && m.requestSerialize)
const findType = (pkg, name) => pkg[String(name).replace(/^\./, '')]

const SCALARS = {
  TYPE_STRING: '',
  TYPE_BYTES: '',
  TYPE_BOOL: false,
  TYPE_DOUBLE: 0,
  TYPE_FLOAT: 0,
  TYPE_INT32: 0,
  TYPE_UINT32: 0,
  TYPE_SINT32: 0,
  TYPE_FIXED32: 0,
  TYPE_SFIXED32: 0,
  TYPE_INT64: '0',
  TYPE_UINT64: '0',
  TYPE_SINT64: '0',
  TYPE_FIXED64: '0',
  TYPE_SFIXED64: '0',
}

/** Un mensaje de ejemplo con todos sus campos (para empezar a escribir el request). */
function sample(pkg, descriptor, depth = 0) {
  const out = {}
  for (const f of descriptor?.type?.field ?? []) {
    let value
    if (f.type === 'TYPE_MESSAGE') {
      const nested = findType(pkg, f.typeName)
      value = depth < 4 && nested ? sample(pkg, nested, depth + 1) : {}
    } else if (f.type === 'TYPE_ENUM') {
      value = findType(pkg, f.typeName)?.type?.value?.[0]?.name ?? 0
    } else value = SCALARS[f.type] ?? null
    out[f.name] = f.label === 'LABEL_REPEATED' ? [value] : value
  }
  return out
}

/** Servicios y métodos de un .proto, con un mensaje de ejemplo por método. */
function describe({ files, entry }) {
  const pkg = load(files, entry)
  const services = []
  for (const [name, def] of Object.entries(pkg)) {
    if (!isService(def)) continue
    services.push({
      name,
      methods: Object.entries(def).map(([method, m]) => ({
        name: method,
        requestStream: !!m.requestStream,
        responseStream: !!m.responseStream,
        requestType: m.requestType?.type?.name,
        responseType: m.responseType?.type?.name,
        sample: sample(pkg, m.requestType),
      })),
    })
  }
  return services
}

const STATUS_NAMES = Object.fromEntries(Object.entries(grpc.status).map(([k, v]) => [v, k]))
const metadataObject = (md) => (md ? Object.fromEntries(Object.entries(md.getMap()).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString('base64') : String(v)])) : {})

const calls = new Map()

/** Llama a un método. Resuelve siempre (los errores vienen en `error` o en el status). */
function invoke(req) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  return new Promise((resolve) => {
    let client
    try {
      const pkg = load(req.files, req.entry)
      const service = pkg[req.service]
      if (!isService(service)) throw new Error(`No existe el servicio ${req.service} en el .proto.`)
      const method = service[req.rpc]
      if (!method) throw new Error(`No existe el método ${req.rpc} en ${req.service}.`)
      let message
      try {
        message = req.message?.trim() ? JSON.parse(req.message) : {}
      } catch (e) {
        throw new Error(`El mensaje no es JSON válido: ${e.message}`)
      }
      const address = String(req.url).replace(/^grpcs?:\/\//, '').replace(/\/+$/, '')
      const creds = req.tls || /^grpcs:\/\//.test(req.url) ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
      client = new grpc.Client(address, creds)
      const metadata = new grpc.Metadata()
      for (const [k, v] of Object.entries(req.metadata ?? {})) if (k) metadata.add(k.toLowerCase(), String(v))
      const options = { deadline: Date.now() + (req.timeoutMs ?? DEADLINE_MS) }
      const messages = []
      let headers = {}
      let settled = false
      const finish = (status) => {
        if (settled) return
        settled = true
        calls.delete(req.id)
        client.close()
        resolve({
          ok: true,
          code: status?.code ?? 0,
          codeName: STATUS_NAMES[status?.code ?? 0] ?? String(status?.code),
          details: status?.details ?? '',
          messages,
          headers,
          trailers: metadataObject(status?.metadata),
          durationMs: elapsed(),
        })
      }
      const ser = method.requestSerialize
      const des = method.responseDeserialize
      let call
      if (!method.requestStream && !method.responseStream) {
        call = client.makeUnaryRequest(method.path, ser, des, message, metadata, options, (err, res) => {
          if (res !== undefined) messages.push(res)
          if (err) finish({ code: err.code, details: err.details, metadata: err.metadata })
        })
      } else if (!method.requestStream) {
        call = client.makeServerStreamRequest(method.path, ser, des, message, metadata, options)
      } else if (!method.responseStream) {
        call = client.makeClientStreamRequest(method.path, ser, des, metadata, options, (err, res) => {
          if (res !== undefined) messages.push(res)
          if (err) finish({ code: err.code, details: err.details, metadata: err.metadata })
        })
        call.write(message)
        call.end()
      } else {
        call = client.makeBidiStreamRequest(method.path, ser, des, metadata, options)
        call.write(message)
        call.end()
      }
      calls.set(req.id, call)
      call.on('metadata', (md) => (headers = metadataObject(md)))
      call.on('data', (d) => messages.length < MAX_STREAM_MESSAGES && messages.push(d))
      call.on('status', (status) => finish(status))
      call.on('error', (err) => finish({ code: err.code, details: err.details ?? err.message, metadata: err.metadata }))
    } catch (e) {
      client?.close()
      resolve({ ok: false, error: e.message ?? String(e), durationMs: elapsed() })
    }
  })
}

function cancel(id) {
  calls.get(id)?.cancel()
}

module.exports = { describe, invoke, cancel }
