// Variables dinámicas con los mismos nombres que Postman (y Bruno): {{$randomFirstName}}, {{$guid}}…
// Los valores los genera faker, en el idioma de la interfaz; cada aparición produce uno nuevo.
// faker pesa bastante: se carga aparte con loadFaker() antes de ejecutar o de sugerir valores.
import type { Faker } from '@faker-js/faker'
import { getLocale } from '../i18n'

let locales: { es: Faker; en: Faker } | undefined
let loading: Promise<void> | undefined

/** Carga faker (una sola vez). Hasta que termina, {{$…}} queda sin resolver. */
export function loadFaker(): Promise<void> {
  loading ??= import('./fakerLocales').then((m) => {
    locales = { es: m.fakerES_MX, en: m.fakerEN }
  })
  return loading
}

export function fakerReady(): boolean {
  return !!locales
}

/** faker en español latinoamericano o en inglés, según el idioma de la interfaz. */
function faker(): Faker | undefined {
  return locales && (getLocale() === 'es' ? locales.es : locales.en)
}

const iso = (d: Date) => d.toISOString()

/** Generadores por nombre (sin el "$"), como los documenta Postman. */
const GENERATORS: Record<string, (f: Faker) => string> = {
  guid: (f) => f.string.uuid(),
  randomUUID: (f) => f.string.uuid(),
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  isoTimestamp: () => new Date().toISOString(),
  randomAlphaNumeric: (f) => f.string.alphanumeric(1),
  randomBoolean: (f) => String(f.datatype.boolean()),
  randomInt: (f) => String(f.number.int({ min: 0, max: 1000 })),
  randomColor: (f) => f.color.human(),
  randomHexColor: (f) => f.color.rgb(),
  randomAbbreviation: (f) => f.hacker.abbreviation(),
  randomIP: (f) => f.internet.ipv4(),
  randomIPV6: (f) => f.internet.ipv6(),
  randomMACAddress: (f) => f.internet.mac(),
  randomPassword: (f) => f.internet.password({ length: 15 }),
  randomLocale: (f) => f.location.language().alpha2,
  randomUserAgent: (f) => f.internet.userAgent(),
  randomProtocol: (f) => f.internet.protocol(),
  randomSemver: (f) => f.system.semver(),
  randomFirstName: (f) => f.person.firstName(),
  randomLastName: (f) => f.person.lastName(),
  randomFullName: (f) => f.person.fullName(),
  randomNamePrefix: (f) => f.person.prefix(),
  randomJobTitle: (f) => f.person.jobTitle(),
  randomPhoneNumber: (f) => f.phone.number(),
  randomCity: (f) => f.location.city(),
  randomStreetName: (f) => f.location.street(),
  randomStreetAddress: (f) => f.location.streetAddress(),
  randomCountry: (f) => f.location.country(),
  randomCountryCode: (f) => f.location.countryCode(),
  randomLatitude: (f) => String(f.location.latitude()),
  randomLongitude: (f) => String(f.location.longitude()),
  randomBankAccount: (f) => f.finance.accountNumber(),
  randomCurrencyCode: (f) => f.finance.currencyCode(),
  randomPrice: (f) => f.commerce.price(),
  randomCreditCardMask: (f) => f.string.numeric(4),
  randomCompanyName: (f) => f.company.name(),
  randomDomainName: (f) => f.internet.domainName(),
  randomEmail: (f) => f.internet.email(),
  randomExampleEmail: (f) => f.internet.exampleEmail(),
  randomUserName: (f) => f.internet.username(),
  randomUrl: (f) => f.internet.url(),
  randomWord: (f) => f.lorem.word(),
  randomWords: (f) => f.lorem.words(),
  randomLoremSentence: (f) => f.lorem.sentence(),
  randomDatePast: (f) => iso(f.date.past()),
  randomDateFuture: (f) => iso(f.date.future()),
  randomDateRecent: (f) => iso(f.date.recent()),
}

/** Nombres de las variables dinámicas, con "$" ($randomFirstName…), en el orden en que se sugieren. */
export const DYNAMIC_NAMES = Object.keys(GENERATORS).map((n) => `$${n}`)

export function isDynamicName(name: string): boolean {
  return name.startsWith('$') && Object.hasOwn(GENERATORS, name.slice(1))
}

/** Valor nuevo para {{$nombre}}, o undefined si no es una variable dinámica conocida. */
export function generateDynamic(name: string): string | undefined {
  const f = faker()
  return f && isDynamicName(name) ? GENERATORS[name.slice(1)](f) : undefined
}
