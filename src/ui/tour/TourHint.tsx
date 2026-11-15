// Aviso sobre el ejemplo abierto: ofrece recorrerlo con el tour guiado. Se puede cerrar y no vuelve
// a aparecer en este equipo.
import { useState } from 'react'
import { t } from '../../i18n'
import { Icon } from '../components/kit'

const KEY = 'tourHint.dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function TourHint({ onStart }: { onStart: () => void }) {
  const [hidden, setHidden] = useState(wasDismissed)
  if (hidden) return null
  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* sin almacenamiento: vuelve a aparecer la próxima vez */
    }
  }
  return (
    <div className="tour-hint" role="status">
      <Icon d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" size={16} />
      <span className="grow">
        <strong>{t('tourHint.title')}</strong> {t('tourHint.text')}
      </span>
      <button className="primary small" onClick={onStart}>
        {t('tour.start')}
      </button>
      <button className="icon-btn" onClick={dismiss} aria-label={t('common.close')} title={t('tourHint.dismiss')}>
        <Icon d="M6 6l12 12M18 6L6 18" size={14} />
      </button>
    </div>
  )
}
