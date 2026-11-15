/** Versión de package.json, la define vite.config.ts. */
declare const __APP_VERSION__: string

/** Swagger UI (bundle de swagger-ui-dist): se usa sin tipos. */
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  const SwaggerUI: any
  export default SwaggerUI
}
