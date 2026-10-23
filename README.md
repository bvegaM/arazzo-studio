# Arazzo Studio

Interfaz para ejecutar y probar workflows de [Arazzo](https://spec.openapis.org/arazzo/latest.html) contra APIs reales. Todo corre en el navegador: los contratos, las credenciales y las respuestas no salen de tu máquina.

## Flujo

1. **Cargar**: subes el Arazzo y los OpenAPI que referencia (`sourceDescriptions`). Si falta un contrato, la pantalla lo indica.
2. **Contratos**: cada paso se resuelve a su operación del OpenAPI. Incluye una tabla de cobertura: qué respuestas documentadas en el contrato maneja el Arazzo y cuáles no. Ves el grafo del workflow, con flechas que muestran qué output alimenta a qué paso, y la validación (operaciones inexistentes, parámetros obligatorios que no se envían, referencias rotas).
3. **Valores por defecto**: formulario generado desde el schema de `inputs`, credenciales detectadas desde los `securitySchemes` y URL base por contrato. Estos valores se usan en todos los casos.
4. **Casos de prueba**:
   - Casos generales: camino feliz, inputs obligatorios faltantes, tipos y enums inválidos, y ejecución sin credenciales. Se ejecutan contra la API real o en simulación.
   - Escenarios por respuesta: uno por cada acción `onFailure`/`onSuccess` con criterios. Se simulan siempre (con los ejemplos del contrato, o su schema si no hay ejemplos) y verifican que, ante esa respuesta, se active la acción correcta.
   - Parámetros por caso: todos los casos parten de los **valores por defecto** del paso 3 y en cada caso puedes cambiar u omitir cualquier valor. Los escenarios por respuesta se pueden pasar a "API real" dándoles los datos que provocan esa respuesta, y puedes crear casos nuevos con datos propios y una expectativa (status, `code` del body y/o acción del Arazzo). Solo se ejecutan los casos que se pueden cumplir con sus datos.
   - Generadores para que los casos se puedan repetir: `{{email}}`, `{{cpf}}`, `{{rut}}`, `{{uuid}}`, `{{numero:8}}`, `{{fecha}}`, `{{timestamp}}`.
   - **Importar / exportar escenarios** en YAML (bases por workflow + datos de cada caso) para versionarlos junto al Arazzo.
5. **Resultados**: entrada y salida de cada petición, criterios evaluados (esperado contra obtenido), validación de la respuesta contra el contrato, outputs capturados, los valores con que corrió cada caso y una razón clara cuando algo falla. **Descargar reporte** genera un HTML autocontenido (se puede imprimir a PDF) con tokens y credenciales ocultos; también hay exportación en JSON.

## Uso local

```bash
npm install
npm run dev          # http://localhost:5173
```

### Probar con el ejemplo incluido

```bash
npm run mock         # API de tarjetas en http://localhost:4010
npm run mock:bug     # misma API, pero con errores de contrato a propósito
```

En la app, pulsa **Cargar ejemplo de tarjetas**, usa cualquier token como credencial y `4321` como `last4Digits`.

### Tests

```bash
npm test             # core: expresiones, criterios, análisis y ejecución contra el mock
```

## Requisito importante: CORS

Las peticiones salen del navegador, así que la API probada debe permitir CORS desde el origen de la app (por ejemplo `http://localhost:5173`) e incluir en `Access-Control-Allow-Headers` los headers que envían los workflows. Cuando el navegador bloquea una petición por CORS no da más detalle; la app lo reporta como "Red o CORS".

Otras limitaciones del navegador: no se pueden enviar cookies ni el header `Host`, y solo se leen los headers de respuesta que la API exponga.

## Soporte de Arazzo

| Elemento | Estado |
|---|---|
| `operationId` (simple y `$sourceDescriptions.x.opId`) | Soportado |
| `operationPath` | Soportado |
| Pasos con `workflowId` (sub-workflows) | Soportado |
| Parámetros path, query y header | Soportado |
| Parámetros cookie | No soportado (restricción del navegador) |
| `requestBody` con `payload` y `replacements` | Soportado |
| `successCriteria` simple, regex y JSONPath | Soportado (JSONPath con sintaxis de jsonpath-plus) |
| `successCriteria` XPath | No soportado |
| `onSuccess` / `onFailure`: end, goto, retry | Soportado |
| `components` (parameters, successActions, failureActions, inputs) | Soportado |
| `dependsOn` | No se ejecuta automáticamente |
| `$ref` externos en los OpenAPI | No soportado; solo referencias locales `#/...` |

## Estructura

```
src/core   motor independiente de la UI (carga, análisis, expresiones, criterios, runner, casos, contrato)
src/ui     pantallas en React
examples   contrato, Arazzo y mock de ejemplo
```

La ejecución HTTP está detrás de `HttpExecutor` (`src/core/http.ts`). Hay dos implementaciones: `fetch` (API real) y el simulador (`src/core/simulator.ts`).
