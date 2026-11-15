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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
