#!/usr/bin/env node
// Release helper used by .github/workflows/auto-release.yml.
//
//   node scripts/release.mjs analyze [--labels "a,b"]
//     Reads the Conventional Commit subjects/bodies since the last v* tag and
//     prints `bump=<major|minor|patch|none>`, `current=X.Y.Z` and `next=X.Y.Z`.
//     A PR label `release:major|minor|patch|skip` overrides the analysis.
//
//   node scripts/release.mjs bump <X.Y.Z>
//     Writes the version into every place the app carries it: package.json,
//     package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and
//     src-tauri/tauri.conf.json.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };
// Types that never ship a change to users on their own.
const NO_RELEASE_TYPES = new Set(["docs", "ci", "test", "style", "chore", "build"]);

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lastTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*.*.*");
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = git("log", range, "--no-merges", "--format=%B%x00");
  return raw.split("\0").map((m) => m.trim()).filter(Boolean);
}

export function classify(message) {
  const [subject] = message.split("\n");
  if (/^chore\(release\)/.test(subject)) return "none";
  const m = subject.match(/^(\w+)(\([^)]*\))?(!)?:/);
  if (m?.[3] || /^BREAKING[ -]CHANGE:/m.test(message)) return "major";
  if (!m) return "patch";
  const type = m[1].toLowerCase();
  if (type === "feat") return "minor";
  if (NO_RELEASE_TYPES.has(type)) return "none";
  return "patch"; // fix, perf, refactor, revert, ...
}

function bumpFromLabels(labels) {
  for (const level of ["skip", "major", "minor", "patch"]) {
    if (labels.includes(`release:${level}`)) return level === "skip" ? "none" : level;
  }
  return null;
}

export function nextVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return current;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function replaceOnce(path, pattern, replacement) {
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) throw new Error(`version not found in ${path}`);
  writeFileSync(path, text.replace(pattern, replacement));
}

function analyze(args) {
  const labelsArg = args[args.indexOf("--labels") + 1];
  const labels = args.includes("--labels") && labelsArg ? labelsArg.split(",").map((l) => l.trim()) : [];
  const current = readJson("package.json").version;
  const tag = lastTag();

  let bump = bumpFromLabels(labels);
  if (!bump) {
    bump = "none";
    for (const message of commitsSince(tag)) {
      const level = classify(message);
      if (RANK[level] > RANK[bump]) bump = level;
    }
  }

  // The tag, not the files, is the source of truth for what was last shipped.
  const base = tag ? tag.replace(/^v/, "") : current;
  console.log(`bump=${bump}`);
  console.log(`current=${base}`);
  console.log(`next=${nextVersion(base, bump)}`);
}

function bump(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`invalid version: ${version}`);

  const pkg = readJson("package.json");
  pkg.version = version;
  writeJson("package.json", pkg);

  const lock = readJson("package-lock.json");
  lock.version = version;
  lock.packages[""].version = version;
  writeJson("package-lock.json", lock);

  const tauri = readJson("src-tauri/tauri.conf.json");
  tauri.version = version;
  writeJson("src-tauri/tauri.conf.json", tauri);

  replaceOnce("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
  replaceOnce(
    "src-tauri/Cargo.lock",
    /(\[\[package\]\]\nname = "satchel"\nversion = )"[^"]+"/,
    `$1"${version}"`,
  );
}

const [command, ...rest] = process.argv.slice(2);
if (command === "analyze") analyze(rest);
else if (command === "bump") bump(rest[0]);
else {
  console.error("usage: release.mjs analyze [--labels a,b] | bump <X.Y.Z>");
  process.exit(1);
}
