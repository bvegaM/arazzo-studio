// Desarrollo de la app de escritorio: levanta Vite y abre Electron apuntando a él.
import { spawn } from 'node:child_process'
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

const app = spawn(electron, ['.'], { stdio: 'inherit', env })
app.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
