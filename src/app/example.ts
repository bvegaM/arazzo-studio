// Ejemplo de tarjetas incluido en el bundle (ver examples/credit-cards).
import exampleArazzo from '../../examples/credit-cards/card-onboarding.arazzo.yaml?raw'
import exampleOpenapi from '../../examples/credit-cards/credit-cards.yaml?raw'
import type { LoadedFile } from '../core/loader'

export const EXAMPLE_FILES: LoadedFile[] = [
  { name: 'card-onboarding.arazzo.yaml', text: exampleArazzo },
  { name: 'credit-cards.yaml', text: exampleOpenapi },
]
