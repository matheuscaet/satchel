# Satchel

Satchel is an open-source, cross-platform desktop API client, built on [Tauri](https://tauri.app). It's a small, fast alternative to Postman-style tools: organize HTTP requests into collections, send them, and inspect the response — without a background Electron process or an account.

Satchel is a standalone tool first: build collections, folders, and requests directly in the app — no import required. Postman collections are a door in, not a dependency: drop in a [Collection Format v2.1](https://learning.postman.com/collection-format/getting-started/overview/) export and Satchel rebuilds it — folders, requests, headers, bodies, auth, and `{{variables}}` — as native Satchel collections you keep editing afterward. You can also paste a `curl` command (e.g. from a browser's "Copy as cURL") and Satchel parses it into a new request. See `src/postman.ts` and `src/curl.ts` for those two importers.

<img width="2384" height="1664" alt="image" src="https://github.com/user-attachments/assets/ce2f4a72-014f-43df-95ca-fe66fdb035aa" />


## Features

- Collections, folders, and requests — create and edit them directly, or import from Postman
- Request tabs, a `⌘K` / `Ctrl+K` command palette (jump to any request, switch environment, run a command), and keyboard shortcuts for the whole send loop (`⌘↵` send, `⌘E` next environment, `⌘1…9` pick one, `⌘N` new request)
- Methods GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, and **QUERY** (the IETF draft: safe and idempotent like GET, with a body)
- Environments (e.g. "Local" / "Production") plus a Postman-style **Globals** bucket that applies regardless of which environment is active. Precedence: environment → collection → globals. An **Environments & globals** matrix edits every variable in every scope in one table; environments can be created (empty or as a copy), renamed, colored, duplicated and deleted
- `{{variable}}` substitution in URLs, headers, params, auth and bodies. Hovering a variable shows where its value comes from (and which scopes it shadows); a variable the active environment can't resolve is flagged before sending
- Query params kept in sync with the URL both ways, and `/:name` **path parameters** with their own values
- Params / Headers (with the auto-added ones shown) / Body (JSON, **form data** with text and file fields, `x-www-form-urlencoded`) / Auth (Bearer, Basic, API key) / Rate Limit tabs
- Response body as **Pretty**, **Tree**, **Table** (lists of records as a sortable grid with a row inspector, CSV copy) or **Raw**, with search over keys, values or a path like `data[0].name`, and a button to open it in its own window that follows new responses
- **Rate Limit** burst tests: N requests per second for T seconds, charted by latency with `X-RateLimit-Remaining` and the first 429 marked
- Postman import with a preview: folders, requests, variables, form-data, path variables, collection auth, environment files, and warnings for anything that doesn't carry over (scripts, files on another machine, undefined variables). Drop the export on the window, or pick it from the `+` menu
- Paste a `curl` command anywhere (or into an open request's URL field to replace it in place) to get a request from it
- Workspaces are folders — one file per request — that a team shares through any git repository, with the git basics (status, commit, pull, push) one click away. See [Sharing a workspace with git](#sharing-a-workspace-with-git)
- Until you pick a folder, everything is kept in the app; older single-file `.json` workspaces still open and convert to a folder
- Dark and light themes

## Sharing a workspace with git

A workspace is a folder, usually a git repository (or a folder inside your API's own repository):

```
satchel.json                         format marker, order of collections and environments, globals
collections/<name>/collection.json   a collection: variables, order of its entries
collections/<name>/<folder>/folder.json
collections/<name>/…/<request>.request.json   one request per file
environments/<name>.json             one environment per file
.satchel/                            your personal state; ignored by git on its own
```

- **Open or create one** with `⌘O` / `Ctrl+O` (or "Save as workspace folder…" to move what you have into one). Satchel only ever touches the files above; everything else in the folder is left alone.
- **Secrets stay local, in your system keychain.** Mark a variable secret (the lock in *Environments & globals*) and its values go to the macOS Keychain, the Windows Credential Manager or the Secret Service (GNOME Keyring, KWallet) on Linux; the shared files keep an empty value, and `.satchel/local.json` only names the keychain entry. Without a keychain, they go to a file in Satchel's data folder that only you can read. The active environment is personal too, so switching environments never shows up in `git status`.
- **You decide when to sync.** Satchel saves to the folder as you edit, like any editor; it never commits, pulls or pushes on its own. The branch chip in the header opens *Source control*: the changed files by request name, a commit box (only the files you select are committed, even when the workspace is inside a bigger repository), and Pull / Push / Fetch. It runs your system `git`, so your SSH keys and credential manager apply, and it works with any host.
- **Changes from outside reload.** A `git pull` or branch switch in a terminal reloads the workspace. A file with merge conflict markers is listed under "files need attention" and left untouched until you resolve it.

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
npm test              # Vitest — importers, URL/variable logic, response search/tree/table models, workspace I/O
cd src-tauri && cargo test
```

## Project layout

```
src/
  types.ts                 Satchel's own request/collection/environment/workspace model
  url.ts                   URL ↔ query-param sync, :path params, legacy request normalization
  variables.ts             {{variable}} resolution with provenance (environment → collection → globals)
  requestBuilder.ts        a SatchelRequest + variables → URL, headers, body
  http/                    sending (incl. multipart form data) and the rate-limit burst runner
  postman.ts               Postman v2.1 → Satchel collection importer (+ analysis for the import preview)
  curl.ts                  curl command → Satchel request parser
  workspace.ts             workspace (de)serialization + validation for save/open
  fileStore.ts             Tauri dialog + fs wrappers for save/open
  state/                   workspace (persisted), session (tabs, responses, bursts), UI and theme contexts
  components/ui/           shadcn/ui primitives
  components/common/       small shared pieces (method label, segmented control, modal parts…)
  features/                one folder per area: shell, sidebar, tabs, palette, request, variables,
                           response (+ viewer, popout window), burst, environments, import, onboarding
samples/                   a Postman collection + environment against public APIs, for trying things out
src-tauri/                 Rust shell (Tauri config, plugin wiring)
```

## Status

Early but functional. Working: creating and editing collections/folders/requests, Postman import, curl paste, environments + globals, sending requests (including form data and QUERY), viewing and searching the response, rate-limit bursts, save/open to a workspace file. Not yet built: request history, native GraphQL bodies, pre/post-request scripts.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md) — please don't file those as public issues.

## License

MIT
