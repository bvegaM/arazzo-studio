// node-pty 1.1.0 publica su spawn-helper (macOS) sin permiso de ejecución y la terminal falla con
// "posix_spawnp failed". Esto se lo devuelve después de cada npm install.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const prebuilds = path.join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
