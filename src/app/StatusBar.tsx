// Barra inferior (como Bruno): preferencias, tema y privacidad a la izquierda; ambiente activo,
// buscador, herramientas de desarrollo y versión a la derecha.
import { useEffect, useState } from 'react'
import { LOCALES, t, type Locale } from '../i18n'
import { desktop } from '../lib/desktop'
import { THEMES, useTheme, type Theme } from '../lib/theme'
import { EnvDot, Icon, Segmented } from '../ui/components/kit'

const ICONS = {
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  system: 'M3 4h18v12H3zM8 20h8M12 16v4',
  light: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  devtools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z',
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD_KEY = isMac ? '⌘' : 'Ctrl+'

interface Props {
  locale: Locale
  onLocale: (l: Locale) => void
  /** Texto de privacidad según dónde corre la app. */
  privacy: string
  /** Ambiente activo (si hay una colección abierta). */
  env?: { name: string; color?: string }
  onOpenEnv?: () => void
  onSearch?: () => void
}

function Preferences({ onClose, locale, onLocale, theme, onTheme, privacy }: Pick<Props, 'locale' | 'onLocale' | 'privacy'> & { onClose: () => void; theme: Theme; onTheme: (t: Theme) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="welcome-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome-dialog prefs" role="dialog" aria-label={t('prefs.title')}>
        <div className="prefs-head">
          <h3>{t('prefs.title')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <Icon d="M6 6l12 12M18 6L6 18" size={14} />
          </button>
        </div>
        <div className="prefs-row">
          <span>{t('sidebar.language')}</span>
          <Segmented options={LOCALES.map((l) => ({ id: l.id, label: l.label }))} value={locale} onChange={onLocale} />
        </div>
        <div className="prefs-row">
          <span>{t('prefs.theme')}</span>
          <Segmented options={THEMES.map((id) => ({ id, label: t(`prefs.theme.${id}`) }))} value={theme} onChange={onTheme} />
        </div>
        <div className="prefs-section">
          <span>{t('prefs.privacy')}</span>
          <p className="muted small">{privacy}</p>
        </div>
        <div className="prefs-section">
          <span>{t('prefs.shortcuts')}</span>
          <dl className="prefs-keys">
            <dt>
              <kbd>{MOD_KEY}Enter</kbd>
            </dt>
            <dd>{t('prefs.key.run')}</dd>
            <dt>
              <kbd>{MOD_KEY}K</kbd>
            </dt>
            <dd>{t('prefs.key.search')}</dd>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>{t('prefs.key.close')}</dd>
          </dl>
        </div>
        <p className="muted small prefs-version">Arazzo Studio v{__APP_VERSION__}</p>
      </div>
    </div>
  )
}

export function StatusBar({ locale, onLocale, privacy, env, onOpenEnv, onSearch }: Props) {
  const [prefs, setPrefs] = useState(false)
  const [theme, setTheme] = useTheme()
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  return (
    <footer className="status-bar">
      <button className="status-btn" onClick={() => setPrefs(true)} title={t('prefs.title')} aria-label={t('prefs.title')}>
        <Icon d={ICONS.settings} size={14} />
      </button>
      <button
        className="status-btn"
        onClick={() => setTheme(nextTheme)}
        title={t('status.theme', { current: t(`prefs.theme.${theme}`), next: t(`prefs.theme.${nextTheme}`) })}
        aria-label={t('status.theme', { current: t(`prefs.theme.${theme}`), next: t(`prefs.theme.${nextTheme}`) })}
      >
        <Icon d={ICONS[theme]} size={14} />
      </button>
      <span className="status-item muted" title={privacy}>
        <Icon d={ICONS.lock} size={13} /> <span className="status-hide-sm">{t('status.local')}</span>
      </span>
      <span className="spacer" />
      {env && (
        <button className="status-btn status-text" onClick={onOpenEnv} title={t('ws.tree.configure')}>
          <EnvDot color={env.color} /> {env.name}
        </button>
      )}
      {onSearch && (
        <button className="status-btn status-text" onClick={onSearch} title={`${t('status.search')} (${MOD_KEY}K)`}>
          <Icon d={ICONS.search} size={13} /> {t('status.search')} <kbd className="status-hide-sm">{MOD_KEY}K</kbd>
        </button>
      )}
      {desktop && (
        <button className="status-btn status-text" onClick={() => void desktop?.appToggleDevTools()} title={t('status.devTools')}>
          <Icon d={ICONS.devtools} size={13} /> <span className="status-hide-sm">{t('status.devTools')}</span>
        </button>
      )}
      <span className="status-item muted status-version">v{__APP_VERSION__}</span>
      {prefs && <Preferences onClose={() => setPrefs(false)} locale={locale} onLocale={onLocale} theme={theme} onTheme={setTheme} privacy={privacy} />}
    </footer>
  )
}
