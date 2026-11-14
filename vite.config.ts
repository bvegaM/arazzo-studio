import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: la app de escritorio carga dist/ desde el disco y la web puede vivir en una subcarpeta.
  base: './',
  plugins: [react()],
})
