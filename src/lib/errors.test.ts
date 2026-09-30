import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("reads Errors, and the plain strings Tauri plugins reject with", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(errorMessage("forbidden path: /home/dev/ws/.satchel/local.json", "fallback")).toBe("forbidden path: /home/dev/ws/.satchel/local.json");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage("", "fallback")).toBe("fallback");
  });
});
