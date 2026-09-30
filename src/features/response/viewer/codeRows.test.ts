import { describe, expect, it } from "vitest";
import { findRow, firstRangeAfter, indexLines, rowEnd, wrapRows } from "./codeRows";

const rowTexts = (text: string, rows: Uint32Array) => Array.from(rows, (_, i) => text.slice(rows[i], rowEnd(text, rows, i)));

describe("indexLines", () => {
  it("finds line starts and the longest line", () => {
    const lines = indexLines("ab\ncdef\n\ng");
    expect(Array.from(lines.starts)).toEqual([0, 3, 8, 9]);
    expect(lines.longest).toBe(4);
  });

  it("counts a trailing newline as an empty last line", () => {
    expect(Array.from(indexLines("a\n").starts)).toEqual([0, 2]);
    expect(Array.from(indexLines("").starts)).toEqual([0]);
  });
});

describe("wrapRows", () => {
  it("keeps lines that fit as one row each", () => {
    const text = "ab\ncd";
    const lines = indexLines(text);
    expect(wrapRows(text, lines, 10)).toBe(lines.starts);
  });

  it("splits long lines into rows of at most `cols` characters", () => {
    const text = "abcdefg\nhi\n";
    expect(rowTexts(text, wrapRows(text, indexLines(text), 3))).toEqual(["abc", "def", "g", "hi", ""]);
  });

  it("never splits a surrogate pair", () => {
    const text = "ab😀cd";
    const rows = rowTexts(text, wrapRows(text, indexLines(text), 3));
    expect(rows.join("")).toBe(text);
    expect(rows.every((r) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(r))).toBe(true);
  });

  it("drops \\r\\n line endings from row text", () => {
    const text = "ab\r\ncd";
    expect(rowTexts(text, indexLines(text).starts)).toEqual(["ab", "cd"]);
  });
});

describe("findRow / firstRangeAfter", () => {
  it("finds the row containing an offset", () => {
    const rows = Uint32Array.from([0, 3, 8, 9]);
    expect(findRow(rows, 0)).toBe(0);
    expect(findRow(rows, 2)).toBe(0);
    expect(findRow(rows, 3)).toBe(1);
    expect(findRow(rows, 100)).toBe(3);
  });

  it("finds the first range that ends after an offset", () => {
    const ranges: [number, number][] = [
      [0, 2],
      [5, 7],
      [10, 12],
    ];
    expect(firstRangeAfter(ranges, 0)).toBe(0);
    expect(firstRangeAfter(ranges, 2)).toBe(1);
    expect(firstRangeAfter(ranges, 6)).toBe(1);
    expect(firstRangeAfter(ranges, 12)).toBe(3);
  });
});
