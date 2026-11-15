// Editor de código chico (CodeMirror) para bodies JSON, consultas GraphQL y mensajes. Sigue el tema
// de la app y se puede usar en lectura (para la respuesta).
import { useEffect, useLayoutEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting } from '@codemirror/language'
import { keymap } from '@codemirror/view'
import { editorTheme, highlight } from '../components/editorTheme'

interface Props {
  value: string
  onChange?: (value: string) => void
  language?: 'json' | 'text'
  readOnly?: boolean
  /** ⌘/Ctrl + Enter dentro del editor. */
  onSubmit?: () => void
  minHeight?: number
  placeholder?: string
  ariaLabel?: string
}

export default function CodeField({ value, onChange, language = 'text', readOnly, onSubmit, minHeight = 140, ariaLabel }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onSubmit })
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit }
  })

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                latest.current.onSubmit?.()
                return !!latest.current.onSubmit
              },
            },
          ]),
          basicSetup,
          ...(language === 'json' ? [json()] : []),
          syntaxHighlighting(highlight),
          editorTheme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? '' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // El editor se crea una vez por lenguaje; el texto se sincroniza abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Si el valor cambia desde afuera (otro request, una respuesta nueva), se reemplaza el texto.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className="code-field" ref={host} style={{ minHeight }} />
}
