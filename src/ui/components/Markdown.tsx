// Markdown sencillo (títulos, párrafos, listas, bloques de código, **negrita**, `código` y enlaces)
// convertido en elementos de React: nunca se interpreta HTML crudo.
import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={m.index}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const [, label, href] = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={m.index} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      )
    } else out.push(<em key={m.index}>{tok.slice(1, -1)}</em>)
    last = m.index! + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className = 'docs-md' }: { text?: string; className?: string }) {
  if (!text) return null
  const blocks: ReactNode[] = []
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const content = inline(heading[2])
      blocks.push(level === 1 ? <h2 key={blocks.length}>{content}</h2> : level === 2 ? <h3 key={blocks.length}>{content}</h3> : <h4 key={blocks.length}>{content}</h4>)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const lis = items.map((it, n) => <li key={n}>{inline(it)}</li>)
      blocks.push(ordered ? <ol key={blocks.length}>{lis}</ol> : <ul key={blocks.length}>{lis}</ul>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
  }
  return <div className={className}>{blocks}</div>
}
