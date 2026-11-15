// Los pasos del tour guiado sobre la Pokédex. Cada paso prepara la pantalla con los mismos clics que
// haría una persona (abrir un journey, una pestaña, ejecutar…), así el tour recorre la app real.
import type { MutableRefObject } from 'react'
import { t } from '../i18n'
import { EXAMPLES } from './example'
import type { Studio } from './useStudio'
import type { WorkspaceState } from './useWorkspace'
import type { TourStep } from '../ui/tour/Tour'
import { getUiMode } from '../lib/uiMode'

export interface TourContext {
  /** Lo más reciente de la app (el tour corre a lo largo de muchos renders). */
  latest: MutableRefObject<{ studio: Studio; workspace: WorkspaceState }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Espera a que se cumpla una condición (o a que pase el tiempo). */
async function until(check: () => boolean, timeout = 8000): Promise<boolean> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return true
    await sleep(80)
  }
  return false
}

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)

/** Primer elemento que coincide y contiene el texto (si se indica). */
function find(selector: string, text?: string): HTMLElement | null {
  if (!text) return $(selector)
  return [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.includes(text)) ?? null
}

async function click(selector: string, text?: string, timeout = 6000): Promise<void> {
  await until(() => !!find(selector, text), timeout)
  find(selector, text)?.click()
  await sleep(120)
}

async function waitFor(selector: string, timeout = 8000): Promise<void> {
  await until(() => !!$(selector), timeout)
}

/** Escribe en un input controlado por React. */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const isOpen = (selector: string) => !!$(selector)

/** Cierra lo que haya quedado abierto de un paso anterior (Dev Tools, buscador). */
async function tidy() {
  const palette = $('.palette input') as HTMLInputElement | null
  if (palette) palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  if (isOpen('.dev-panel:not([hidden])')) await click('[data-tour="devtools"]')
  await sleep(60)
}

async function openJourney(workflowId: string, tab?: string) {
  await tidy()
  await click(`[data-journey="${workflowId}"]`)
  if (tab) await click(`[data-tab="${tab}"]`)
}

async function runActiveJourney(waitSelector: string) {
  await click('.ws-run')
  // Si pide confirmar porque modifica datos (no es el caso de la PokéAPI), se confirma.
  await sleep(200)
  const confirm = find('.ws-strip.warn button.primary')
  confirm?.click()
  await waitFor(waitSelector, 20000)
  await until(() => !$('.run-progress'), 20000)
}

export function buildTourSteps(ctx: TourContext): TourStep[] {
  const live = () => ctx.latest.current
  // En la interfaz simple no hay Dev Tools: ese paso no se muestra.
  const simple = getUiMode() === 'simple'
  const steps: TourStep[] = [
    {
      id: 'intro',
      title: t('tour.intro.title'),
      body: t('tour.intro.body'),
      before: async () => {
        const { workspace } = live()
        if (workspace.isOpen) await workspace.closeWorkspace()
        await until(() => !live().workspace.isOpen)
        await live().workspace.createWorkspace(t('tour.workspaceName'), { kind: 'browser' }, 'pokedex-tour')
        await until(() => live().workspace.isOpen)
        await live().workspace.createCollection('Pokédex')
        await until(() => live().workspace.activeCollection?.name === 'Pokédex')
        await sleep(150)
        await live().studio.addFiles(EXAMPLES.pokemon.map((f) => new File([f.text], f.name)))
        await waitFor('[data-journey="pokemonCard"]')
      },
    },
    { id: 'workspace', target: '.app-ws', title: t('tour.workspace.title'), body: t('tour.workspace.body') },
    {
      id: 'home',
      target: '.home',
      title: t('tour.home.title'),
      body: t('tour.home.body'),
      before: async () => {
        await click('.app-home')
        await waitFor('.home')
      },
    },
    {
      id: 'tree',
      target: '.ws-sidebar nav.tree',
      title: t('tour.tree.title'),
      body: t('tour.tree.body'),
      before: async () => {
        await openJourney('pokemonCard', 'overview')
      },
    },
    {
      id: 'diagram',
      target: '.ws-center-body',
      title: t('tour.diagram.title'),
      body: t('tour.diagram.body'),
      before: async () => {
        await openJourney('pokemonCard', 'overview')
        await waitFor('.react-flow__node')
      },
    },
    { id: 'inputs', target: '.ws-center-body', title: t('tour.inputs.title'), body: t('tour.inputs.body'), before: () => openJourney('pokemonCard', 'inputs') },
    {
      id: 'environment',
      target: '.ws-center',
      title: t('tour.environment.title'),
      body: t('tour.environment.body'),
      before: async () => {
        await tidy()
        await click('.tree-list li.active .link')
        await waitFor('.ws-env-title')
      },
    },
    { id: 'cases', target: '.ws-center-body', title: t('tour.cases.title'), body: t('tour.cases.body'), before: () => openJourney('pokemonCard', 'cases') },
    {
      id: 'run',
      target: '.ws-results',
      title: t('tour.run.title'),
      body: t('tour.run.body'),
      before: async () => {
        await openJourney('pokemonCard', 'cases')
        await runActiveJourney('.ws-results .step-result')
      },
    },
    {
      id: 'step',
      target: '.step-view',
      title: t('tour.step.title'),
      body: t('tour.step.body'),
      before: async () => {
        await openJourney('pokemonCard')
        // Por id y no por texto: en la interfaz simple el árbol muestra "Get pokemon".
        await click('.tree-step[data-step="getPokemon"]')
        await waitFor('.step-view')
      },
    },
    {
      id: 'yaml',
      target: '.ws-center-body',
      title: t('tour.yaml.title'),
      body: t('tour.yaml.body'),
      before: async () => {
        await openJourney('pokemonCard', 'yaml')
        await waitFor('.cm-editor')
      },
    },
    {
      id: 'contract',
      target: '.contract-editor',
      title: t('tour.contract.title'),
      body: t('tour.contract.body'),
      before: async () => {
        await tidy()
        await click('.tree-contract', 'pokeapi')
        await waitFor('.contract-editor')
      },
    },
    {
      id: 'dependsOn',
      target: '.prelude',
      title: t('tour.dependsOn.title'),
      body: t('tour.dependsOn.body'),
      before: async () => {
        await openJourney('battleMatchup', 'cases')
        await runActiveJourney('.prelude')
      },
    },
    {
      id: 'events',
      target: '.ws-center-body',
      title: t('tour.events.title'),
      body: t('tour.events.body'),
      before: async () => {
        await openJourney('registerSighting', 'overview')
        await waitFor('.react-flow__node')
      },
    },
    {
      id: 'devtools',
      target: '.dev-panel',
      title: t('tour.devtools.title'),
      body: t('tour.devtools.body'),
      before: async () => {
        await tidy()
        await click('[data-tour="devtools"]')
        await click('.dev-tabs button', 'Network')
      },
    },
    {
      id: 'search',
      target: '.palette',
      title: t('tour.search.title'),
      body: t('tour.search.body'),
      before: async () => {
        await tidy()
        await click('[data-tour="search"]')
        await waitFor('.palette input')
        type($('.palette input') as HTMLInputElement, 'weak')
      },
    },
    {
      id: 'collection',
      target: '.collection-overview',
      title: t('tour.collection.title'),
      body: t('tour.collection.body'),
      before: async () => {
        await tidy()
        await click('.app-home')
        await click('.home-collection-main', 'Pokédex')
        await waitFor('.collection-overview')
      },
    },
    {
      id: 'prefs',
      target: '.status-bar',
      title: t('tour.prefs.title'),
      body: t('tour.prefs.body'),
      before: tidy,
    },
  ]
  return simple ? steps.filter((s) => s.id !== 'devtools') : steps
}
