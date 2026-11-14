// Ejemplos incluidos en el bundle (ver examples/).
import cardsArazzo from '../../examples/credit-cards/card-onboarding.arazzo.yaml?raw'
import cardsOpenapi from '../../examples/credit-cards/credit-cards.yaml?raw'
import milesArazzo from '../../examples/miles-transfer/miles-transfer.arazzo.yaml?raw'
import milesMembers from '../../examples/miles-transfer/members.yaml?raw'
import milesSchemas from '../../examples/miles-transfer/member-schemas.yaml?raw'
import milesEvents from '../../examples/miles-transfer/miles-events.asyncapi.yaml?raw'
import type { LoadedFile } from '../core/loader'

export type ExampleId = 'cards' | 'miles'

export const EXAMPLES: Record<ExampleId, LoadedFile[]> = {
  cards: [
    { name: 'card-onboarding.arazzo.yaml', text: cardsArazzo },
    { name: 'credit-cards.yaml', text: cardsOpenapi },
  ],
  // Arazzo 1.1 con un OpenAPI que usa $ref externos y un AsyncAPI.
  miles: [
    { name: 'miles-transfer.arazzo.yaml', text: milesArazzo },
    { name: 'members.yaml', text: milesMembers },
    { name: 'member-schemas.yaml', text: milesSchemas },
    { name: 'miles-events.asyncapi.yaml', text: milesEvents },
  ],
}
