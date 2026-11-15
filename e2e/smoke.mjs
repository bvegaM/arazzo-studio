// Prueba de interfaz de punta a punta (sin red): levanta Vite, abre la app en Chrome y recorre lo
// principal. Uso: npm run test:e2e  (CHROME_PATH=/ruta/a/chrome si no está en el lugar de siempre).
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const examples = path.join(root, 'examples')
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!CHROME) {
  console.error('No encontré Chrome. Indica su ruta con CHROME_PATH=…')
  process.exit(1)
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } })
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const pageErrors = []
/** Una pestaña en un navegador limpio (sin sesiones ni workspaces de antes). */
async function freshPage() {
  const p = await (await browser.newContext({ locale: 'es-CL', viewport: { width: 1440, height: 900 } })).newPage()
  p.on('pageerror', (e) => pageErrors.push(String(e)))
  await p.goto(url)
  return p
}
let page = await freshPage()

const results = []
async function check(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, ok: false })
    // Captura de la pantalla en el momento del fallo, para ver qué pasó.
    const shot = path.join(os.tmpdir(), `arazzo-e2e-${results.length}.png`)
    await page.screenshot({ path: shot }).catch(() => {})
    console.log(`  ✕ ${name}\n    ${String(e.message ?? e).split('\n')[0]}\n    captura: ${shot}`)
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

console.log(`Arazzo Studio · prueba de interfaz en ${url}`)

await check('la bienvenida carga la Pokédex y la ejecuta en simulación', async () => {
  await page.locator('.welcome-dialog').waitFor()
  await page.locator('.wd-card', { hasText: /ejemplo/i }).click()
  await page.locator('.tree-step').first().waitFor()
  const journeys = await page.locator('.tree-journey .tree-main').count()
  expect(journeys === 4, `se esperaban 4 journeys y hay ${journeys}`)
  await page.locator('.ws-runbar .segmented').getByRole('button', { name: 'Simulación' }).click()
  await page.locator('.ws-run').click()
  await page.locator('.ws-results .step-result').first().waitFor({ timeout: 15000 })
  const summary = await page.locator('.ws-results').innerText()
  expect(/casos ejecutados/.test(summary), 'no aparece el resumen de la ejecución')
})

await check('⌘K busca un paso y lo abre', async () => {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.locator('.palette input').fill('weak')
  expect((await page.locator('.palette-list button').count()) > 0, 'el buscador no encontró nada')
  await page.keyboard.press('Escape')
})

await check('crea un workspace en el navegador con una colección', async () => {
  page = await freshPage()
  await page.locator('.welcome-dialog').waitFor()
  await page.locator('.wd-featured').click()
  await page.locator('.wd-form input').first().fill('E2E')
  const browserOption = page.locator('.wd-choice-item', { hasText: 'En este navegador' })
  if (await browserOption.count()) await browserOption.click()
  await page.getByRole('button', { name: 'Crear workspace' }).click()
  await page.locator('.home').waitFor()
  await page.locator('.home-action', { hasText: 'Nueva colección' }).click()
  await page.locator('.home-new input').fill('Pokédex')
  await page.locator('.home-new').getByRole('button', { name: 'Crear' }).click()
  // Como una persona: espera a que la colección esté abierta y usa "Importar".
  await page.locator('.tree-collection.current', { hasText: 'Pokédex' }).waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.home-action', { hasText: 'Importar' }).click()])
  await chooser.setFiles(['pokemon.arazzo.yaml', 'pokeapi.openapi.yaml', 'pokedex-events.asyncapi.yaml'].map((f) => path.join(examples, 'pokemon', f)))
  await page.locator('.tree-step').first().waitFor()
  const journeys = await page.locator('.tree-journey .tree-main').allInnerTexts()
  expect(journeys.length === 4, `se esperaban 4 journeys y hay ${journeys.length}`)
})

await check('el contrato se abre con Swagger UI', async () => {
  await page.locator('.tree-contract', { hasText: 'pokeapi' }).first().click()
  await page.locator('.swagger-ui .opblock').first().waitFor({ timeout: 20000 })
  expect((await page.locator('.swagger-ui .opblock').count()) >= 6, 'faltan operaciones en Swagger UI')
})

await check('el modo simple oculta Dev Tools', async () => {
  expect(await page.locator('.status-btn', { hasText: 'Dev Tools' }).isVisible(), 'Dev Tools no aparece en modo completo')
  await page.getByRole('button', { name: 'Preferencias' }).click()
  await page.locator('.prefs').getByRole('button', { name: 'Simple' }).click()
  await page.keyboard.press('Escape')
  expect(!(await page.locator('.status-btn', { hasText: 'Dev Tools' }).count()), 'Dev Tools sigue visible en modo simple')
  await page.getByRole('button', { name: 'Preferencias' }).click()
  await page.locator('.prefs').getByRole('button', { name: 'Completa' }).click()
  await page.keyboard.press('Escape')
})

await check('el tour guiado arranca y avanza', async () => {
  page = await freshPage()
  await page.locator('.welcome-dialog').waitFor()
  await page.locator('.wd-card', { hasText: 'Tour' }).click()
  await page.locator('.tour-card').waitFor()
  await page.locator('[data-journey="pokemonCard"]').waitFor({ timeout: 15000 })
  for (let n = 2; n <= 4; n++) {
    await page.locator('.tour-card button.primary').click()
    await page.locator('.tour-progress', { hasText: `Paso ${n} de` }).waitFor()
  }
  await page.locator('.tour-spot').waitFor({ timeout: 15000 })
  await page.locator('.tour-card .link', { hasText: 'Salir' }).click()
  expect(!(await page.locator('.tour-card').count()), 'el tour no se cerró')
})

await check('sin errores de JavaScript', async () => {
  expect(!pageErrors.length, pageErrors.join(' | '))
})

await browser.close()
await server.close()
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} de ${results.length} fallaron.` : `\nTodo bien (${results.length} pruebas).`)
process.exit(failed ? 1 : 0)
