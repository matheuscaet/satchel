import { beforeEach, describe, expect, it, vi } from "vitest";

const vault = new Map<string, string>();
let failReads = false;
const writes: [string, string | null][] = [];

vi.mock("./vault", () => ({
  readSecret: async (account: string) => {
    if (failReads) throw new Error("the keychain is locked");
    return vault.get(account) ?? null;
  },
  writeSecret: async (account: string, value: string | null) => {
    writes.push([account, value]);
    if (value === null) vault.delete(account);
    else vault.set(account, value);
  },
}));

const { loadSecretValues, saveSecretValues } = await import("./secretStore");
const { emptySecretValues } = await import("./values");

const values = (token: string) => ({ ...emptySecretValues(), globals: { token } });
let n = 0;
const fresh = () => `workspace/test-${++n}`;

beforeEach(() => {
  failReads = false;
  writes.length = 0;
});

describe("secretStore", () => {
  it("writes only when the values change, and removes the entry when none are left", async () => {
    const account = fresh();
    await saveSecretValues(account, values("a"));
    await saveSecretValues(account, values("a"));
    expect(writes).toEqual([[account, JSON.stringify(values("a"))]]);
    expect(await loadSecretValues(account)).toEqual(values("a"));

    await saveSecretValues(account, emptySecretValues());
    expect(writes[writes.length - 1]).toEqual([account, null]);
    expect(vault.has(account)).toBe(false);
  });

  it("never overwrites values it couldn't read", async () => {
    const account = fresh();
    vault.set(account, JSON.stringify(values("real")));
    failReads = true;
    await expect(loadSecretValues(account)).rejects.toThrow("locked");
    await saveSecretValues(account, emptySecretValues());
    await saveSecretValues(account, values("blank-ish"));
    expect(writes).toEqual([]);
    expect(vault.get(account)).toContain("real");
  });

  it("treats a malformed stored value as none", async () => {
    const account = fresh();
    vault.set(account, "not json");
    expect(await loadSecretValues(account)).toBeNull();
  });
});
