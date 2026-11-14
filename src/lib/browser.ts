/* eslint-disable @typescript-eslint/no-explicit-any */
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

export type SaveResult = 'saved' | 'downloaded' | 'cancelled'

/** Guarda en un archivo elegido por el usuario (Chrome, Edge) o, si no se puede, lo descarga. */
export async function saveTextFile(text: string, name: string): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<any> }).showSaveFilePicker
  if (!picker) {
    download(text, name, 'application/yaml')
    return 'downloaded'
  }
  try {
    const handle = await picker({ suggestedName: name, types: [{ description: 'Arazzo', accept: { 'application/yaml': ['.yaml', '.yml'] } }] })
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
    return 'saved'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
    download(text, name, 'application/yaml')
    return 'downloaded'
  }
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
