import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { getLocale } from './i18n'
import { applyTheme, savedTheme } from './lib/theme'
import { captureErrors } from './lib/devlog'

document.documentElement.lang = getLocale()

// El tema elegido se aplica antes de pintar, para no ver un destello del otro.
applyTheme(savedTheme())
captureErrors()

// Vuelta de una autorización OAuth 2.0 abierta en otra ventana (versión web): se le pasa la URL
// (con el código) a la app que la abrió y esta ventana se cierra.
const oauthReturn = window.location.pathname.endsWith('/oauth2/callback') && window.opener
if (oauthReturn) {
  window.opener.postMessage({ type: 'arazzo-oauth2', url: window.location.href }, window.location.origin)
  window.close()
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
