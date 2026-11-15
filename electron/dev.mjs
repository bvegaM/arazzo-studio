// Desarrollo de la app de escritorio: levanta Vite y abre Electron apuntando a él.
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const electron = require('electron')

const server = await createServer()
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error('Vite no informó una URL local.')

// Dentro de VS Code (y otras apps Electron) esta variable hace que Electron arranque como Node.
const env = { ...process.env, ARAZZO_DEV_URL: url }
delete env.ELECTRON_RUN_AS_NODE

let app
let restarting = false
function start() {
  app = spawn(electron, ['.'], { stdio: 'inherit', env })
  app.on('exit', async (code) => {
    if (restarting) {
      restarting = false
      start()
      return
    }
    await server.close()
    process.exit(code ?? 0)
  })
}
start()

// Vite recarga la interfaz, pero el proceso principal y el preload solo se leen al arrancar:
// si cambian, se reinicia Electron (el workspace abierto se vuelve a abrir solo).
let timer
watch(path.dirname(fileURLToPath(import.meta.url)), (_event, file) => {
  if (file !== 'main.mjs' && file !== 'preload.cjs') return
  clearTimeout(timer)
  timer = setTimeout(() => {
    console.log(`\n[desktop:dev] ${file} cambió: reiniciando Electron…`)
    restarting = true
    app.kill()
  }, 200)
})
