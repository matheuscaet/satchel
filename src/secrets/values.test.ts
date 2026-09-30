import { describe, expect, it } from "vitest";
import type { Workspace } from "@/types";
import { hasSecretValues, parseSecretValues, secretValuesOf, withoutSecretValues, withSecretValues } from "./values";

const token = { key: "token", value: "s3cr3t", enabled: true, secret: true };
const host = { key: "host", value: "api.test", enabled: true };
const workspace = (): Workspace => ({
  globals: [token, host],
  collections: [
    { id: "c", name: "C", variables: [{ ...token, value: "col" }], items: [] },
    { id: "d", name: "D", variables: [host], items: [] },
  ],
  environments: [{ id: "e", name: "E", variables: [host, { ...token, value: "" }] }],
  activeEnvironmentId: "e",
});

describe("secret values", () => {
  it("collects non-empty secret values by scope", () => {
    expect(secretValuesOf(workspace())).toEqual({ globals: { token: "s3cr3t" }, collections: { c: { token: "col" } }, environments: {} });
  });

  it("blanks them for storage and fills them back", () => {
    const w = workspace();
    const blank = withoutSecretValues(w);
    expect(JSON.stringify(blank)).not.toContain("s3cr3t");
    expect(JSON.stringify(blank)).not.toContain('"col"');
    expect(blank.globals[1]).toBe(host);
    expect(withSecretValues(blank, secretValuesOf(w))).toEqual(w);
  });

  it("fills only secret variables, and keeps untouched scopes", () => {
    const w = workspace();
    const filled = withSecretValues(w, { globals: { host: "evil" }, collections: {}, environments: { e: { token: "env" } } });
    expect(filled.globals).toBe(w.globals);
    expect(filled.collections[1]).toBe(w.collections[1]);
    expect(filled.environments[0].variables[1].value).toBe("env");
  });

  it("parses leniently and tells when there are any", () => {
    expect(parseSecretValues({ globals: { a: 1, b: "ok" }, collections: "nope" })).toEqual({ globals: { b: "ok" }, collections: {}, environments: {} });
    expect(hasSecretValues(parseSecretValues(null))).toBe(false);
    expect(hasSecretValues(secretValuesOf(workspace()))).toBe(true);
  });
});
