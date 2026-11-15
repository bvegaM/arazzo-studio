// Proceso principal de la app de escritorio: la ventana, las peticiones HTTP (sin CORS, desde Node)
// y el acceso a archivos. La interfaz es la misma app web; habla con este proceso por preload.cjs.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { chmodSync, existsSync } from 'node:fs'
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// En desarrollo, la interfaz la sirve Vite (ver electron/dev.mjs).
const devUrl = process.env.ARAZZO_DEV_URL

const MAX_FILES = 300
const MAX_FILE_BYTES = 5 * 1024 * 1024
const CONTRACT_FILE = /\.(ya?ml|json)$/i

// Solo se puede escribir en archivos que el usuario abrió o eligió en un diálogo.
const writable = new Set()
// Peticiones en curso, para poder cancelarlas.
const pending = new Map()

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Arazzo Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1216' : '#f5f6f8',
    // En macOS los semáforos de la ventana van dentro de la barra superior de la app (como Bruno).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 15 } } : {}),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // Los enlaces externos se abren en el navegador del sistema, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(here, '..', 'dist', 'index.html'))
}

/** Archivos YAML/JSON de una carpeta (y sus subcarpetas), sin carpetas ocultas ni node_modules. */
async function collect(dir, out = [], depth = 0) {
  if (depth > 6) return out
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await collect(full, out, depth + 1)
    else if (CONTRACT_FILE.test(entry.name) && (await stat(full)).size <= MAX_FILE_BYTES) {
      out.push({ path: full, text: await readFile(full, 'utf8') })
    }
  }
  return out
}

ipcMain.handle('http:request', async (_event, req) => {
  const controller = new AbortController()
  pending.set(req.id, controller)
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
      redirect: 'follow',
    })
    const bodyText = await res.text()
    const headers = {}
    res.headers.forEach((value, key) => (headers[key.toLowerCase()] = value))
    return { ok: true, status: res.status, statusText: res.statusText, headers, bodyText, durationMs: elapsed() }
  } catch (e) {
    // fetch de Node envuelve el error real (DNS, conexión rechazada, TLS…) en `cause`.
    const cause = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(e)
    return { ok: false, aborted: controller.signal.aborted, error: String(cause), durationMs: elapsed() }
  } finally {
    pending.delete(req.id)
  }
})

ipcMain.on('http:abort', (_event, id) => pending.get(id)?.abort())

ipcMain.handle('fs:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  const root = picked.filePaths[0]
  if (picked.canceled || !root) return undefined
  const files = await collect(root)
  for (const f of files) writable.add(f.path)
  return {
    root,
    truncated: files.length >= MAX_FILES,
    files: files.map((f) => ({ name: path.relative(root, f.path), path: f.path, text: f.text })),
  }
})

ipcMain.handle('fs:writeFile', async (_event, { path: target, text }) => {
  if (!writable.has(target)) throw new Error('Este archivo no se abrió desde la app.')
  await writeFile(target, text, 'utf8')
  return target
})

ipcMain.handle('fs:saveAs', async (event, { suggestedName, text }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const picked = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName,
    filters: [{ name: 'Arazzo', extensions: ['yaml', 'yml', 'json'] }],
  })
  if (picked.canceled || !picked.filePath) return undefined
  writable.add(picked.filePath)
  await writeFile(picked.filePath, text, 'utf8')
  return picked.filePath
})

// --- Workspaces: solo se lee y escribe dentro de carpetas que el usuario eligió en un diálogo ---

const configFile = () => path.join(app.getPath('userData'), 'workspaces.json')
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json')
const workspaceRoots = new Set()

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function allowRoot(root) {
  workspaceRoots.add(path.resolve(root))
  await writeFile(configFile(), JSON.stringify({ roots: [...workspaceRoots] }, null, 2))
}

/** Ruta absoluta dentro del workspace; rechaza rutas que salgan de él (../, rutas absolutas). */
function inside(root, rel) {
  const base = path.resolve(root)
  if (!workspaceRoots.has(base)) throw new Error('Workspace no autorizado.')
  const full = path.resolve(base, rel || '.')
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Ruta fuera del workspace.')
  return full
}

ipcMain.handle('ws:pickFolder', async (event, mode) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const picked = await dialog.showOpenDialog(win, {
    title: mode === 'create' ? 'Carpeta del nuevo workspace' : 'Abrir workspace',
    buttonLabel: mode === 'create' ? 'Crear aquí' : 'Abrir',
    properties: ['openDirectory', 'createDirectory'],
  })
  const root = picked.filePaths[0]
  if (picked.canceled || !root) return undefined
  await allowRoot(root)
  return root
})

ipcMain.handle('ws:list', async (_event, { root, path: rel }) => {
  try {
    const entries = await readdir(inside(root, rel), { withFileTypes: true })
    return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }))
  } catch {
    return []
  }
})

ipcMain.handle('ws:read', async (_event, { root, path: rel }) => {
  try {
    const full = inside(root, rel)
    if ((await stat(full)).size > MAX_FILE_BYTES) return undefined
    return await readFile(full, 'utf8')
  } catch {
    return undefined
  }
})

ipcMain.handle('ws:write', async (_event, { root, path: rel, text }) => {
  const full = inside(root, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, text, 'utf8')
})

ipcMain.handle('ws:remove', async (_event, { root, path: rel }) => {
  const full = inside(root, rel)
  if (full === path.resolve(root)) throw new Error('No se puede borrar el workspace.')
  await rm(full, { force: true })
})

/** Borra una carpeta del workspace con todo su contenido (p. ej. una colección). */
ipcMain.handle('ws:removeDir', async (_event, { root, path: rel }) => {
  const full = inside(root, rel)
  if (full === path.resolve(root)) throw new Error('No se puede borrar el workspace.')
  await rm(full, { recursive: true, force: true })
})

/** Dónde se proponen los workspaces nuevos: Documentos/Arazzo Studio. */
ipcMain.handle('ws:defaultLocation', () => path.join(app.getPath('documents'), 'Arazzo Studio'))

/** Elige la carpeta donde se creará un workspace (no se autoriza hasta crearlo). */
ipcMain.handle('ws:pickLocation', async (event, current) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const picked = await dialog.showOpenDialog(win, {
    title: 'Ubicación del workspace',
    buttonLabel: 'Elegir',
    defaultPath: current || undefined,
    properties: ['openDirectory', 'createDirectory'],
  })
  return picked.canceled ? undefined : picked.filePaths[0]
})

/** Crea la carpeta del workspace dentro de la ubicación elegida y la autoriza. */
ipcMain.handle('ws:createAt', async (_event, { parent, folder }) => {
  const name = String(folder).replace(/[\\/:*?"<>|]/g, '').trim()
  if (!name || name === '.' || name === '..') throw new Error('Nombre de carpeta no válido.')
  const root = path.join(path.resolve(parent), name)
  await mkdir(root, { recursive: true })
  await allowRoot(root)
  return root
})

/**
 * Elimina un workspace: su carpeta va a la papelera (se puede recuperar). Solo carpetas
 * autorizadas que tengan studio.yaml, para no borrar nunca otra cosa.
 */
ipcMain.handle('ws:trash', async (_event, root) => {
  const base = path.resolve(root)
  if (!workspaceRoots.has(base)) throw new Error('Workspace no autorizado.')
  await access(path.join(base, 'studio.yaml'))
  await shell.trashItem(base)
  workspaceRoots.delete(base)
  await writeFile(configFile(), JSON.stringify({ roots: [...workspaceRoots] }, null, 2))
})

/** Muestra una carpeta o archivo del workspace en Finder / el explorador. */
ipcMain.handle('ws:reveal', async (_event, { root, path: rel }) => {
  shell.showItemInFolder(inside(root, rel))
})

// Secretos: cifrados con el llavero del sistema (safeStorage); si no está disponible, no se guardan.
ipcMain.handle('secret:get', async (_event, key) => {
  const all = await readJson(secretsFile(), {})
  if (!all[key] || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(all[key], 'base64'))
  } catch {
    return undefined
  }
})

ipcMain.handle('secret:set', async (_event, { key, value }) => {
  if (!safeStorage.isEncryptionAvailable()) return
  const all = await readJson(secretsFile(), {})
  all[key] = safeStorage.encryptString(value).toString('base64')
  await writeFile(secretsFile(), JSON.stringify(all), { mode: 0o600 })
})

ipcMain.handle('secret:remove', async (_event, key) => {
  const all = await readJson(secretsFile(), {})
  delete all[key]
  await writeFile(secretsFile(), JSON.stringify(all), { mode: 0o600 })
})

/** Borra todos los secretos cuya clave empieza con `prefix` (p. ej. los de un workspace). */
ipcMain.handle('secret:removePrefix', async (_event, prefix) => {
  if (!prefix) return
  const all = await readJson(secretsFile(), {})
  for (const key of Object.keys(all)) if (key.startsWith(prefix)) delete all[key]
  await writeFile(secretsFile(), JSON.stringify(all), { mode: 0o600 })
})

/** Tema elegido en la app: también lo usan la ventana y los diálogos del sistema. */
ipcMain.handle('app:setTheme', (_event, theme) => {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
})

/** Recursos de la app (todos sus procesos): CPU, memoria, tiempo encendida y PID del principal. */
ipcMain.handle('app:metrics', () => {
  const metrics = app.getAppMetrics()
  return {
    cpu: metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
    memory: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) * 1024,
    uptime: process.uptime(),
    pid: process.pid,
    processes: metrics.map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu.percentCPUUsage, memory: m.memory.workingSetSize * 1024 })),
  }
})

/** Herramientas de desarrollo de la ventana (para inspeccionar peticiones y errores). */
ipcMain.handle('app:toggleDevTools', (event) => {
  event.sender.toggleDevTools()
})

// --- Terminal integrada (node-pty): la shell del sistema, en la carpeta del workspace ---

const require = createRequire(import.meta.url)
const terminals = new Map()
let pty

/** Carga node-pty solo al abrir la primera terminal (si falla, la app sigue funcionando). */
function loadPty() {
  if (pty) return pty
  const mod = require('node-pty')
  // node-pty 1.1.0 trae su spawn-helper sin permiso de ejecución (ver scripts/fix-node-pty.mjs).
  try {
    const dir = path.dirname(require.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked')
    const helper = path.join(dir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  } catch {
    /* sin permisos para corregirlo: si falla, se informa al abrir la terminal */
  }
  pty = mod
  return pty
}

function defaultShell() {
  if (process.platform === 'win32') return { file: process.env.COMSPEC?.toLowerCase().includes('powershell') ? process.env.COMSPEC : 'powershell.exe', args: [] }
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

/** Abre una terminal. Solo en un workspace autorizado o, si no, en la carpeta personal. */
ipcMain.handle('term:create', (event, { cols, rows, cwd }) => {
  const dir = cwd && workspaceRoots.has(path.resolve(cwd)) ? path.resolve(cwd) : os.homedir()
  const { file, args } = defaultShell()
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ArazzoStudio' }
  delete env.ELECTRON_RUN_AS_NODE
  const term = loadPty().spawn(file, args, { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd: dir, env })
  const id = String(term.pid)
  const sender = event.sender
  terminals.set(id, term)
  term.onData((data) => !sender.isDestroyed() && sender.send('term:data', { id, data }))
  term.onExit(({ exitCode }) => {
    terminals.delete(id)
    if (!sender.isDestroyed()) sender.send('term:exit', { id, exitCode })
  })
  // Si se cierra la ventana, su terminal también.
  sender.once('destroyed', () => {
    if (terminals.has(id)) term.kill()
  })
  return { id, cwd: dir, shell: path.basename(file) }
})

ipcMain.on('term:write', (_event, { id, data }) => terminals.get(id)?.write(data))
ipcMain.on('term:resize', (_event, { id, cols, rows }) => {
  try {
    terminals.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 1))
  } catch {
    /* la terminal ya terminó */
  }
})
ipcMain.handle('term:kill', (_event, id) => {
  terminals.get(id)?.kill()
  terminals.delete(id)
})

app.on('before-quit', () => {
  for (const term of terminals.values()) term.kill()
  terminals.clear()
})

app.whenReady().then(async () => {
  // Las carpetas de workspace elegidas antes siguen autorizadas.
  for (const root of (await readJson(configFile(), {})).roots ?? []) workspaceRoots.add(root)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
