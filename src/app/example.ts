// Ejemplo incluido en el bundle (ver examples/pokemon): una Pokédex sobre la PokéAPI pública, sin
// credenciales y con CORS, para probar contra una API real desde el primer momento.
import pokemonArazzo from '../../examples/pokemon/pokemon.arazzo.yaml?raw'
import pokeapi from '../../examples/pokemon/pokeapi.openapi.yaml?raw'
import pokedexEvents from '../../examples/pokemon/pokedex-events.asyncapi.yaml?raw'
import type { LoadedFile } from '../core/loader'

export type ExampleId = 'pokemon'

export const EXAMPLES: Record<ExampleId, LoadedFile[]> = {
  pokemon: [
    { name: 'pokemon.arazzo.yaml', text: pokemonArazzo },
    { name: 'pokeapi.openapi.yaml', text: pokeapi },
    { name: 'pokedex-events.asyncapi.yaml', text: pokedexEvents },
  ],
}
