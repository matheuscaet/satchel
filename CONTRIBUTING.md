# Contributing to Satchel

Thanks for taking a look! This project is small and young, so the process is intentionally lightweight.

## Getting set up

See the [README](README.md#getting-started) for prerequisites and how to run the app locally.

## Making a change

1. Fork the repo and create a branch off `main`.
2. Make your change. Keep pull requests focused - a bug fix and an unrelated refactor should be two PRs, not one.
3. Before opening a PR, run locally:

   ```sh
   cd src-tauri
   cargo fmt
   cargo clippy --all-targets -- -D warnings
   cargo test

   cd ..
   npm test        # unit tests for the Postman importer, curl parser, workspace I/O
   npm run build   # runs tsc, so this also type-checks the frontend
   ```

4. Open a pull request against `main`. CI runs the same checks above automatically, and at least one review is required before merging - both are enforced by branch protection, not just convention.

## What needs a test, and what doesn't

`src/postman.ts`, `src/curl.ts`, `src/workspace.ts`, and `src/folderFormat/` all parse untrusted input - a Postman export someone else made, a curl command copied from a browser, a workspace file someone hand-edited, a workspace folder a teammate pushed (possibly mid-merge). If you touch one of these, add a test case in the matching `*.test.ts` file, especially for a malformed-input path. UI-only changes (layout, styling, a new button) don't need one.

## Reporting bugs / requesting features

Open an issue using the appropriate template. For security-sensitive reports, please don't open a public issue - see [SECURITY.md](SECURITY.md) instead.

## Code style

- Rust: formatted with `cargo fmt`, linted with `cargo clippy -D warnings`. No `unwrap()`/`expect()` outside tests unless the panic is genuinely a programmer error, not a runtime condition.
- TypeScript/React: no new state-management or component library without discussion first - the app intentionally has minimal dependencies.
- Comments explain *why*, not *what* - if a comment just restates the code, delete it.
