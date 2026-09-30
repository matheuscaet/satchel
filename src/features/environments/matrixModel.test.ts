import { describe, expect, it } from "vitest";
import type { Workspace } from "@/types";
import {
  columnWidth,
  displayValue,
  hasAnyValue,
  matrixColumns,
  matrixVariableNames,
  SECRET_MASK,
  secretVariableNames,
  valueIn,
  VARIABLE_NAME,
} from "./matrixModel";

const kv = (key: string, value: string) => ({ key, value, enabled: true });

const ws: Workspace = {
  globals: [kv("timeout", "30")],
  collections: [{ id: "c1", name: "Shop API", items: [], variables: [kv("baseUrl", "https://shop.test")] }],
  environments: [
    { id: "e1", name: "Local", variables: [kv("baseUrl", "http://localhost:3000"), kv("token", "dev")] },
    { id: "e2", name: "Production", variables: [] },
  ],
  activeEnvironmentId: "e1",
};

describe("environment matrix model", () => {
  it("orders columns globals → collections → environments", () => {
    expect(matrixColumns(ws).map((c) => [c.key, c.group, c.label])).toEqual([
      ["g", "Workspace", "Globals"],
      ["c:c1", "Collection", "Shop API"],
      ["e:e1", "Environment", "Local"],
      ["e:e2", "Environment", "Production"],
    ]);
  });

  it("lists every variable once, sorted, including extra names", () => {
    expect(matrixVariableNames(ws, ["apiKey", "token"])).toEqual(["apiKey", "baseUrl", "timeout", "token"]);
  });

  it("sizes columns to fit, between 10 and 34 ch", () => {
    const [globals, collection, local] = matrixColumns(ws);
    const names = matrixVariableNames(ws);
    expect(columnWidth(globals, names)).toBe(10);
    expect(columnWidth(collection, names)).toBe("https://shop.test".length + 1);
    expect(valueIn(local, "token")).toBe("dev");
    expect(columnWidth({ ...local, variables: [kv("x", "y".repeat(80))] }, ["x"])).toBe(34);
  });

  it("accepts the same names {{variables}} use", () => {
    expect(VARIABLE_NAME.test("dotnetapi-local")).toBe(true);
    expect(VARIABLE_NAME.test("api.key_2")).toBe(true);
    expect(VARIABLE_NAME.test("has space")).toBe(false);
  });

  it("finds secret names across every column", () => {
    const secretWs: Workspace = {
      ...ws,
      globals: [{ ...kv("apiKey", ""), secret: true }],
      environments: [{ id: "e1", name: "Local", variables: [{ ...kv("token", "dev"), secret: true }, kv("baseUrl", "x")] }],
    };
    expect([...secretVariableNames(matrixColumns(secretWs))].sort()).toEqual(["apiKey", "token"]);
    expect(secretVariableNames(matrixColumns(ws)).size).toBe(0);
  });

  it("knows whether a variable has a value anywhere", () => {
    const columns = matrixColumns({ ...ws, globals: [kv("empty", ""), kv("timeout", "30")] });
    expect(hasAnyValue(columns, "token")).toBe(true);
    expect(hasAnyValue(columns, "empty")).toBe(false);
    expect(hasAnyValue(columns, "missing")).toBe(false);
  });

  it("masks secret values with a fixed length unless revealed", () => {
    expect(displayValue("hunter2", true, false)).toBe(SECRET_MASK);
    expect(displayValue("a".repeat(60), true, false)).toBe(SECRET_MASK);
    expect(displayValue("hunter2", true, true)).toBe("hunter2");
    expect(displayValue("hunter2", false, false)).toBe("hunter2");
    expect(displayValue("", true, false)).toBe("");
  });

  it("sizes secret values as the mask, not their length", () => {
    const local = { ...matrixColumns(ws)[2], variables: [{ ...kv("token", "t".repeat(80)), secret: true }] };
    expect(columnWidth(local, ["token"])).toBe(34);
    expect(columnWidth(local, ["token"], new Set(["token"]))).toBe(10);
  });
});
