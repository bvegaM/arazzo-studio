// Utilidades del navegador (descargas, archivos y portapapeles), sin lógica de la app.

export interface TextFile {
  name: string
  text: string
}

/** Descarga un texto como archivo. */
export function download(text: string, name: string, type: string) {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function readTextFiles(files: File[]): Promise<TextFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
}

/** Copia texto al portapapeles; usa un textarea temporal si la API no está disponible. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
