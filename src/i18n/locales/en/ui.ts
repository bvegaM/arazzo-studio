import type { ui as es } from '../es/ui'

export const ui: Record<keyof typeof es, string> = {
  'brand.sub': 'Workflow testing',
  'sidebar.privacy': 'Everything runs in your browser. Nothing is sent to a server of ours.',
  'sidebar.language': 'Language',
  'nav.load': 'Load',
  'nav.files': '{n} file(s)',
  'nav.noFiles': 'No files',
  'nav.contracts': 'Contracts',
  'nav.errors': '{n} error(s)',
  'nav.workflows': '{n} workflow(s)',
  'nav.defaults': 'Default values',
  'nav.missing': '{n} missing',
  'nav.complete': 'Complete',
  'nav.cases': 'Cases',
  'nav.ready': '{n} ready to run',
  'nav.results': 'Results',
  'nav.running': '{done}/{total} running…',
  'nav.passed': '{passed}/{total} passed',

  'kit.stepOf': 'Step {step} of {total}',
  'kit.more': 'Show more',
  'kit.less': 'Show less',
  'common.empty': '(empty)',
  'issue.error': 'Error',
  'issue.warning': 'Warning',
  'issue.info': 'Info',
}
