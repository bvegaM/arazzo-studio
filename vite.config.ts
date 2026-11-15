import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: la app de escritorio carga dist/ desde el disco y la web puede vivir en una subcarpeta.
  base: './',
  plugins: [react()],
  // Versión de la app para la barra inferior.
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
})
