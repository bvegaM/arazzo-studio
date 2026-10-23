// Utilidades del navegador (descargas y lectura de archivos), sin lógica de la app.

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
