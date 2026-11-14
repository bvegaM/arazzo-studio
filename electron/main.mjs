// Proceso principal de la app de escritorio: la ventana, las peticiones HTTP (sin CORS, desde Node)
// y el acceso a archivos. La interfaz es la misma app web; habla con este proceso por preload.cjs.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
