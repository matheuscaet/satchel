# Satchel

Satchel is an open-source, cross-platform desktop API client, built on [Tauri](https://tauri.app). It's a small, fast alternative to Postman-style tools: organize HTTP requests into collections, send them, and inspect the response — without a background Electron process or an account.

Satchel is a standalone tool first: build collections, folders, and requests directly in the app — no import required. Postman collections are a door in, not a dependency: drop in a [Collection Format v2.1](https://learning.postman.com/collection-format/getting-started/overview/) export and Satchel rebuilds it — folders, requests, headers, bodies, auth, and `{{variables}}` — as native Satchel collections you keep editing afterward. You can also paste a `curl` command (e.g. from a browser's "Copy as cURL") and Satchel parses it into a new request. See `src/postman.ts` and `src/curl.ts` for those two importers.

<img width="2384" height="1664" alt="image" src="https://github.com/user-attachments/assets/ce2f4a72-014f-43df-95ca-fe66fdb035aa" />


## Features

- Collections, folders, and requests — create and edit them directly, or import from Postman
- Environments (e.g. "Local" / "Production") plus a Postman-style **Globals** bucket that applies regardless of which environment is active. Precedence: environment → collection → globals
- `{{variable}}` substitution in URLs, headers, params, and bodies
- Params / Headers / Body (raw or `x-www-form-urlencoded`) / Auth (Bearer, Basic, API key) tabs, with a JSON "Beautify" button
- Paste a `curl` command to create and open a request from it — either from the sidebar, or directly into an open request's URL field to replace its method/headers/body/auth in place
- Save/open a workspace as a plain `.json` file on disk, with an in-memory `localStorage` cache so nothing's lost before you've picked a save location
- Six color themes (`src/themes.ts`), picked from the palette icon next to the app name and persisted across launches
- A VS Code–style status bar across the bottom: workspace file/save state, active environment, the open request, and collection/request counts
- VS Code–style raw JSON body editing: Tab indents instead of moving focus, real syntax coloring for keys/strings/numbers/booleans (`src/jsonTokens.ts`)

## Stack

- [Tauri 2](https://tauri.app) (Rust) for the native shell, outbound HTTP (`tauri-plugin-http`, which sends requests from the Rust side to avoid browser CORS restrictions — the whole point of an API client), file save/open (`tauri-plugin-dialog` + `tauri-plugin-fs`), and clipboard access (`tauri-plugin-clipboard-manager`)
- React + TypeScript for the UI
- No state library, no CSS framework — a handful of components and one stylesheet

## Getting started

Prerequisites:

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (via `rustup`)
- Tauri's platform prerequisites: see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) (Linux needs a few system packages; macOS/Windows just need their standard build tools)

```bash
npm install
npm run tauri dev
```

`npm run dev` alone runs just the Vite dev server in a regular browser tab — useful for UI work, but outbound requests are subject to normal browser CORS rules, and file save/open and clipboard-paste-curl need the Tauri plugins, so those fall back to browser APIs or a clear error. Use `npm run tauri dev` to exercise the real thing.

### Tests

```bash
npm test              # Vitest — Postman importer, curl parser, variable resolution, workspace I/O
cd src-tauri && cargo test
```

## Project layout

```
src/
  types.ts               Satchel's own request/collection/environment/workspace model
  postman.ts              Postman v2.1 → Satchel collection importer
  curl.ts                 curl command → Satchel request parser
  workspace.ts             workspace (de)serialization + validation for save/open
  fileStore.ts             Tauri dialog + fs wrappers for save/open
  clipboard.ts             clipboard read, Tauri-first with a browser fallback
  collectionTree.ts        tree ops: create/add/remove/rename/find nodes, resolve {{variables}}
  components/
    Sidebar.tsx            collection tree, import/paste-curl/save/open, environment picker
    RequestEditor.tsx       method/url bar, params/headers/body/auth tabs, send + response
    EnvironmentsModal.tsx   manage environments + Globals
    KvEditor.tsx            shared key/value list editor (headers, params, variables, ...)
src-tauri/                 Rust shell (Tauri config, plugin wiring)
```

## Status

Early but functional. Working: creating and editing collections/folders/requests, Postman import, curl paste, environments + globals, sending requests, viewing the response, save/open to a workspace file. Not yet built: request history, form-data bodies, GraphQL bodies, pre/post-request scripts.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md) — please don't file those as public issues.

## License

MIT
