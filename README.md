<div align="center">

<img src="public/favicon.svg" width="72" height="72" alt="Arazzo Studio">

# Arazzo Studio

**Test your API journeys without writing tests.**

Load an [Arazzo](https://spec.openapis.org/arazzo/latest.html) workflow and the OpenAPI and AsyncAPI contracts behind it. Arazzo Studio draws the journey, generates the test cases, runs them against your API or in simulation, and explains every result in plain words. Organize everything in a workspace of folders like Bruno, edit contracts like in Swagger Editor, and use it in the browser or as a desktop app, with no account and nothing that leaves your machine.

[![Arazzo](https://img.shields.io/badge/Arazzo-1.0%20%7C%201.1-6BA543)](https://spec.openapis.org/arazzo/latest.html)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.x-6BA543?logo=openapiinitiative&logoColor=white)](https://spec.openapis.org/oas/latest.html)
[![AsyncAPI](https://img.shields.io/badge/AsyncAPI-2.x%20%7C%203.x-6BA543)](https://www.asyncapi.com/docs/reference/specification/latest)
[![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20ES-93C83D)](#languages)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
<br>
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![React Flow](https://img.shields.io/badge/React_Flow-12-FF0072?logo=react&logoColor=white)](https://reactflow.dev)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D30707)](https://codemirror.net)
[![Vitest](https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)

**English** · [Español](README.es.md)

<br>

<img src="docs/screenshots/journey.png" alt="A workspace with two collections, a journey as an interactive flow diagram and its steps in the sidebar" width="100%">

</div>

<br>

## Contents

- [Why Arazzo Studio](#why-arazzo-studio)
- [Who it is for](#who-it-is-for)
- [Features](#features)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Privacy and security](#privacy-and-security)
- [Specification support](#specification-support)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Languages](#languages)
- [For contributors](#for-contributors)
- [License](#license)

## Why Arazzo Studio

Most integrations are not one API call but a **journey**: enroll a member, add card benefits, transfer miles. Each API is usually documented and tested on its own, so nobody can easily check that the whole journey works, and only engineers can try it.

[Arazzo](https://spec.openapis.org/arazzo/latest.html), the OpenAPI Initiative's workflow specification, describes those journeys on top of your existing contracts. Arazzo Studio turns that description into something anyone on the team can run:

- 🧭 **See the journey.** Every workflow becomes a diagram with its steps, the actions each response triggers and the data that moves between steps.
- 🧪 **Get the test cases for free.** Happy path, missing or invalid inputs, calls without credentials and one scenario per `onSuccess` / `onFailure` action, derived from the contracts.
- 🎛️ **Try your own data.** Add cases with different parameters, reuse them as YAML and repeat them with generators like `{{email}}` or `{{uuid}}`.
- 🔍 **Understand failures at a glance.** Instead of a raw JSON dump, you read *"`status` is `INACTIVE` but `ACTIVE` was expected"*, with the field highlighted in the response.
- ✍️ **Fix the workflow where you test it.** A built-in editor validates the Arazzo as you type and suggests operations, steps and outputs from the contracts.
- 📁 **Work like in Bruno.** A workspace is a folder: each collection is a subfolder with its Arazzo files, contracts, environments and cases as plain files you can keep in git. Every change is saved automatically.
- 📜 **Edit contracts like in Swagger Editor.** YAML next to the official Swagger UI, with live errors and a warning when a change breaks a journey. Try any operation on its own with your environment.
- 🔒 **Stay local.** No backend and no account. Secrets and credentials are encrypted on your computer and never written to the workspace files.
- 🖥️ **Browser or desktop.** The desktop app sends requests without CORS restrictions and adds an integrated terminal.

## Who it is for

- **API product and partner teams** who sell or document journeys made of several APIs, and need to show they work end to end.
- **Product managers and business roles** who need to try a journey with their own data, without a CLI, a paid tool or test code.
- **QA and integration engineers** who want generated negative cases, clear verdicts, a shareable report and Dev Tools with every request.
- **API designers** writing Arazzo files, who want live validation against the real contracts.

Arazzo Studio is built for **exploring, debugging and demonstrating** journeys by hand. It is not a CI runner: for pipelines, a command-line runner such as [Redocly Respect](https://redocly.com/docs/respect) is a better fit, and both can share the same Arazzo files.

## Features

### A workspace of folders, like Bruno

Create a workspace where you choose (the desktop app suggests `Documents/Arazzo Studio`) and add collections: one per partner or topic. Each collection keeps its Arazzo files, contracts, environments and test cases as plain files, so the whole workspace can live in git and be shared with the team. Every change is saved automatically.

The **Home** tab shows the collections with their folders, quick actions and the workspace documentation, a `README.md` you write and preview right there.

<img src="docs/screenshots/home.png" alt="Workspace home with collection counts, quick actions, the collections and their folders, and the workspace documentation" width="100%">

```
partner-journeys/
  studio.yaml              workspace name and collections
  README.md                workspace documentation
  miles-transfer/          a collection
    collection.yaml
    miles-transfer.arazzo.yaml, members.yaml, …
    environments/*.yaml    base URLs, variables and color (secret names only)
    scenarios/<arazzo>     base inputs and custom cases of each Arazzo
```

### Journeys, cases and results side by side

Pick a journey on the left: its diagram, inputs and generated cases are in the middle and the results on the right. Cases cover the happy path, missing or invalid inputs, calls without credentials and one scenario per `onSuccess` / `onFailure` action. Run them against the real API or in simulation, add your own data cases and read every verdict in plain words.

<img src="docs/screenshots/results.png" alt="The generated test cases of a journey and the results of running them, with each step's status and timing" width="100%">

### Environments with variables and secrets

Local, integration, production… each environment has its base URLs, credentials, variables and secrets, plus a color tag. Type `{{` in any field to pick a variable or a generator. Secrets are masked everywhere and stored encrypted on this computer, never in the workspace files.

<img src="docs/screenshots/environment.png" alt="An environment with base URLs, credentials, variables and secrets" width="100%">

### Contracts like in Swagger Editor

Open any OpenAPI contract to edit its YAML next to the official **Swagger UI**, updated as you type. Errors appear on top with their line, and a banner warns when a change breaks a journey that uses the contract. **Try it out** goes through Arazzo Studio: the environment's server comes first, credentials are already authorized, secrets are masked in the cURL and every call shows up in Dev Tools. Any operation can also be tried on its own from a journey step. Create new OpenAPI or AsyncAPI contracts from the sidebar.

<img src="docs/screenshots/contract.png" alt="A contract with its YAML on the left and Swagger UI on the right" width="100%">

### Edit the Arazzo with live validation

The **YAML** tab of a journey validates the Arazzo as you type. Every problem is underlined on the exact value it refers to, and autocompletion offers operation ids from the loaded contracts (HTTP and AsyncAPI), channels, `$steps.<step>.outputs.<name>`, `$inputs`, `dependsOn` and `goto` targets.

<img src="docs/screenshots/editor.png" alt="The Arazzo editor with live validation next to the results" width="100%">

### Dev Tools: Console, Network, Performance and Terminal

Like Bruno, the status bar opens a panel with the **Console** (every run, case and step, and app events), **Network** (every request and message with headers, body and *Copy as cURL*, secrets masked), **Performance** (CPU, memory and time per step) and, in the desktop app, a **Terminal** with several sessions that opens in the workspace or collection folder. The **Simple** interface (Preferences) hides all of it for people who only test journeys.

<img src="docs/screenshots/devtools.png" alt="Dev Tools with the Network tab: every request of a run and the detail of one of them" width="100%">

### Event-driven steps (AsyncAPI)

Journeys often mix REST calls with events. Steps that `send` or `receive` an AsyncAPI message appear in the diagram and the results like any other step: the message sent, the message received (matched by `correlationId`), its contract check and the outputs taken from `$message`. Generated scenarios cover the message that triggers each action and the case where no message arrives before the `timeout`.

> [!NOTE]
> Arazzo Studio does not connect to brokers such as Kafka, AMQP or MQTT yet, so messaging steps are **always simulated** from the AsyncAPI examples and schemas. The app says so before running and marks those steps as simulated, also when the rest of the journey runs against the real API.

### And also

| Feature | What it does |
|---|---|
| 🔎 **Search everywhere** | ⌘K / Ctrl+K jumps to any journey, step, environment, contract or collection. The sidebar search filters the tree as you type. |
| 🗺️ **Interactive diagram** | Drag the steps around; their actions move with them, and **Reset layout** brings back the automatic one. |
| 📋 **Copy as cURL** | Reproduce any request from your terminal. Secrets become `<secret>`. |
| 🛟 **Connection help** | If the API does not answer, a guided panel explains what to check (URL, https/http, CORS) and gives you the exact CORS headers to add. |
| 🎲 **Generators** | Postman-style dynamic variables powered by [Faker](https://fakerjs.dev) (`{{$randomFirstName}}`, `{{$randomEmail}}`, `{{$guid}}`… 47 in total) plus `{{cpf}}`, `{{rut}}` and `{{number:8}}`. |
| 📄 **Reports** | A self-contained HTML report or a JSON export of every run. |
| 🌙 **Themes** | Light, dark or the system's, from the status bar or Preferences. |
| 💾 **Without a workspace** | Open files or a folder for a quick try; your session is saved on this device without credentials. |

<details>
<summary><strong>Dark mode preview</strong></summary>
<br>
<img src="docs/screenshots/journey-dark.png" alt="A journey in dark mode" width="100%">
</details>

## Quick start

Requirements: **Node.js 20.19+ or 22.12+** (required by Vite 8).

```bash
npm install
npm run dev          # http://localhost:5173
```

The build is a static site (`npm run build` → `dist/`), so it can be served from any static host or an internal server. The people who use it only need a browser.

### Desktop app

The same app, packaged with Electron. Workspaces live in real folders on disk (with **Show in Finder**), secrets are encrypted with the operating system's keychain, requests are sent from the app itself, so **CORS does not apply**, and Dev Tools adds a **Terminal**.

```bash
npm run desktop:dev      # run the desktop app against the dev server
npm run desktop:build    # build the installer for your OS into release/
```

> [!NOTE]
> Installers are **not signed** yet. On macOS, open the app the first time with right click → **Open**; on Windows, choose **More info → Run anyway**.

### Try the built-in examples

The examples are one click away on the welcome screen. The Pokédex runs against the public [PokéAPI](https://pokeapi.co) right away; for the others, start the bundled mock to run them against a real API instead of the simulation:

```bash
npm run mock         # example APIs at http://localhost:4010
npm run mock:bug     # same APIs, with contract violations on purpose
```

| Example | What it shows | How to run it |
|---|---|---|
| **Pokédex** | Two journeys against the public PokéAPI: each step uses the previous step's outputs, JSONPath criteria and a 404 end action. | Nothing to set up: no credentials and CORS allowed. |
| **Collection** | The credit cards and miles examples in one collection: two Arazzo files, three journeys, shared environments. | As each example. |
| **Credit cards** | A four-step onboarding over one OpenAPI contract: generated cases, response scenarios, contract violations. | Any token as the credential and `4321` as `last4Digits`. |
| **Miles transfer** | An Arazzo 1.1 journey: an OpenAPI contract split with external `$ref`s, AsyncAPI `send` / `receive` steps, `correlationId`, `timeout` and `dependsOn`. | Any token as the credential. The messaging steps are simulated. |

The example files live in [examples/](examples/).

## How it works

```mermaid
flowchart LR
    A[Arazzo + OpenAPI + AsyncAPI] --> B[Analyze<br/>resolve steps and $refs, coverage, validation]
    B <--> E[Editor<br/>live validation, autocompletion]
    B --> C[Default values<br/>inputs, environment, credentials]
    C --> D[Test cases<br/>generated + your own]
    D --> R{Run}
    R -->|real API| F[fetch]
    R -->|simulation| G[examples from the contracts]
    R -->|messaging steps| G
    F --> H[Results + report]
    G --> H
```

1. **Contracts.** Each step is resolved to its OpenAPI operation or AsyncAPI channel. A coverage table shows which documented responses the Arazzo handles, and validation flags missing operations, required parameters that are never sent, broken references and steps that depend on steps that run later.
2. **Default values.** The values every case starts from, plus the environment (base URLs and credentials taken from the `securitySchemes`).
3. **Test cases.** General cases run against the real API or in simulation. Response and message scenarios are simulated from the contract examples (or the schema when there are none) and check that the right action fires. HTTP scenarios can be switched to the real API by giving them the data that triggers that response.
4. **Results.** Every case ends with a verdict (passed, failed or inconclusive) and a reason in plain words.

> [!IMPORTANT]
> In the **browser version**, requests are sent from the browser, so the API under test must allow **CORS** from the app's origin (for example `http://localhost:5173`) and list the headers your workflows send in `Access-Control-Allow-Headers`. When a request is blocked, the app shows a guided panel with the exact headers to add. The **desktop app** sends requests from the app itself, so CORS does not apply.

## Privacy and security

- Everything runs **on your machine**, in the browser or the desktop app. There is no backend and no account.
- **Secrets and credentials are never written to the workspace files**: environment files only keep the names of the secrets. Their values are stored **encrypted on this computer**, with the operating system's keychain in the desktop app (Electron `safeStorage`) and with WebCrypto in the browser.
- Tokens, passwords and API keys are **masked** in results, reports, exports, Dev Tools, the Swagger UI cURL and *Copy as cURL*.
- The desktop app only reads and writes inside folders you chose, and its interface has no direct access to Node or the file system. The integrated terminal opens your own shell, only in a workspace folder or your home folder.
- Without a workspace, the saved session (IndexedDB) leaves out credentials and any input whose name looks sensitive (`token`, `password`, `secret`…).

## Specification support

Arazzo **1.0.x** and **1.1.x** documents are supported, with OpenAPI **3.x** and AsyncAPI **2.x** and **3.x** contracts.

| Feature | Status |
|---|---|
| `operationId` (plain and `$sourceDescriptions.x.opId`) | ✅ Supported |
| `operationPath` | ✅ Supported |
| Steps with `workflowId` (sub-workflows) | ✅ Supported |
| Path, query and header parameters | ✅ Supported |
| `in: querystring` parameters (1.1) | ✅ Supported |
| Cookie parameters | ❌ Not supported (browser restriction) |
| `requestBody` with `payload` and `replacements` | ✅ Supported (`targetSelectorType` JSON Pointer and JSONPath) |
| `successCriteria`: simple, regex and JSONPath | ✅ Supported (JSONPath with jsonpath-plus syntax) |
| `successCriteria` and selectors: XPath | ❌ Not supported |
| `onSuccess` / `onFailure`: `end`, `goto`, `retry` | ✅ Supported |
| `parameters` on success and failure actions (1.1) | ✅ Supported for `goto` and `retry` with `workflowId` |
| Selector Object in outputs, parameters and payloads (1.1) | ✅ Supported (JSONPath and JSON Pointer) |
| `components` (parameters, successActions, failureActions, inputs) | ✅ Supported |
| AsyncAPI sources (1.1): `channelPath`, `action`, `correlationId`, `$message` | ✅ Supported, always simulated |
| Step `timeout` (1.1) | ✅ Supported |
| Step `dependsOn` (1.1) | ✅ Checked in the analysis and before each step; steps run in document order |
| Workflow `dependsOn` | ⚠️ Not run automatically |
| External `$ref` in OpenAPI, AsyncAPI and Arazzo files | ✅ Supported between loaded files (and fetched next to a contract downloaded from its URL) |

## Known limitations

- **Messaging steps are simulated.** Arazzo Studio does not connect to brokers yet.
- **CORS (browser version only).** The API under test has to allow the app's origin. Browsers cannot send cookies or the `Host` header, and only read the response headers the API exposes. The desktop app has none of these restrictions.
- **Unsigned desktop installers.** macOS and Windows show a warning the first time the app is opened.
- **Tested on macOS.** The Windows and Linux builds have not been tried on those systems yet; on Linux the terminal needs to build its native module when installing.
- **Swagger UI for OpenAPI only.** AsyncAPI contracts and schema files use Arazzo Studio's own preview.
- **XPath** in criteria and selectors is not supported.
- **`retry` with `stepId`** and **workflow-level `dependsOn`** are not run automatically.
- **Not a CI runner.** Runs are started by a person in the browser.
- **No hosted version yet.** Run it locally, use the desktop app or serve the static build yourself.

## Roadmap

Planned next steps, in no fixed order:

- **Online demo** with the built-in examples, so the app can be tried without installing anything.
- **Real messaging in the desktop app:** connect `send` / `receive` steps to Kafka, AMQP or MQTT instead of simulating them.
- **Signed desktop installers** with automatic updates.
- **AI-assisted editing** (opt-in, with your own API key): describe a change in plain words and review it as a diff before applying it.
- **Richer diagram:** `dependsOn` arrows and timeouts on the steps.
- **Editable simulations:** adjust the simulated response or message of a scenario to try business cases without touching YAML.
- **Generate a first Arazzo from the contracts** (or with AI), so teams without Arazzo files can start in minutes.
- **Add a tried operation as a step** of the Arazzo.

Ideas and feedback are welcome in the [issues](https://github.com/bvegaM/arazzo-studio/issues).

## Languages

The interface is available in **English** and **Spanish**. The initial language follows the browser and can be changed in **Preferences** (status bar). Engine messages and the HTML report are translated too. Scenario files keep the same keys in both languages, so they stay compatible.

## For contributors

### Project structure

```
src/
  app/          app composition: workspace layout, state (useStudio, useWorkspace),
                sidebar, top bar, status bar, home
  core/         UI-independent engine (no React, no DOM): loader and $ref bundling,
                OpenAPI and AsyncAPI resolution, analysis, runner, criteria,
                simulator, test cases, contract lint, workspace format, report…
  i18n/         translations (en, es), t() and the useLocale hook
  lib/          browser and desktop utilities (storage, workspace files, secrets,
                desktop bridge, Dev Tools log, theme)
  ui/
    components/ reusable pieces (flow diagram, Arazzo and contract editors,
                Swagger UI preview, schema form, menus…)
    workspace/  the views of a workspace (journey, cases, results, environments,
                Dev Tools, terminal, home…)
electron/       desktop app: main process (HTTP without CORS, files, secrets, terminal),
                preload bridge, dev launcher
examples/       credit cards, miles transfer and Pokédex examples, and the mock API
e2e/            end-to-end smoke test of the UI
docs/           screenshots
```

`core` never imports from `ui`, `app` or `lib`, so the engine can be reused outside the browser. HTTP calls go through an `HttpExecutor` (`fetch` in the browser, the Electron main process on desktop, or the contract-based simulator) and messaging steps through a `MessageExecutor` (today, the simulator). The flow diagram (React Flow) and the editor (CodeMirror) are loaded on demand to keep the initial bundle small.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm test` | Run the unit tests (engine, criteria, analysis, editor helpers, contracts, workspace format) |
| `npm run test:e2e` | Open the app in the installed Chrome and walk through the main flows (`CHROME_PATH` to override) |
| `npm run typecheck` | Type-check the app, the config and the tests |
| `npm run lint` | Lint with oxlint |
| `npm run mock` / `npm run mock:bug` | Start the example APIs (correct / with contract errors) |
| `npm run desktop:dev` | Run the desktop app against the dev server |
| `npm run desktop:build` | Build the desktop installer for the current OS into `release/` |

### Adding a text

Add its key to `src/i18n/locales/es/` and the translation to `src/i18n/locales/en/`. TypeScript reports any missing key.

## License

[MIT](LICENSE) © bvegam

<sub>Arazzo and OpenAPI are specifications of the <a href="https://www.openapis.org">OpenAPI Initiative</a>, and AsyncAPI of the <a href="https://www.asyncapi.com">AsyncAPI Initiative</a>. This project is not affiliated with or endorsed by either.</sub>
