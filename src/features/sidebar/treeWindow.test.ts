import { describe, expect, it } from "vitest";
import { ROW_H, revealScrollTop, rowAt, rowWindow, visibleSpan } from "./treeWindow";

describe("visibleSpan", () => {
  it("covers every row the viewport touches, even partly", () => {
    expect(visibleSpan(0, 10 * ROW_H)).toEqual({ first: 0, last: 10 });
    expect(visibleSpan(ROW_H / 2, 10 * ROW_H)).toEqual({ first: 0, last: 11 });
    expect(visibleSpan(5 * ROW_H, 3 * ROW_H)).toEqual({ first: 5, last: 8 });
  });

  it("starts at the first row when the list begins below the viewport's top", () => {
    expect(visibleSpan(-40, 100)).toEqual({ first: 0, last: 3 });
  });

  it("is empty for a hidden viewport", () => {
    expect(visibleSpan(3 * ROW_H, 0)).toEqual({ first: 3, last: 3 });
  });
});

describe("rowWindow", () => {
  it("adds overscan around the visible span", () => {
    expect(rowWindow({ first: 20, last: 30 }, 100, 5)).toEqual({ start: 15, end: 35 });
  });

  it("clamps to the rows there are", () => {
    expect(rowWindow({ first: 0, last: 30 }, 12, 5)).toEqual({ start: 0, end: 12 });
    expect(rowWindow({ first: 50, last: 60 }, 12, 5)).toEqual({ start: 12, end: 12 });
    expect(rowWindow({ first: 0, last: 10 }, 0, 5)).toEqual({ start: 0, end: 0 });
  });
});

describe("rowAt", () => {
  it("finds the row and the position inside it", () => {
    expect(rowAt(0, 5)).toEqual({ index: 0, rel: 0 });
    expect(rowAt(ROW_H * 2 + ROW_H / 4, 5)).toEqual({ index: 2, rel: 0.25 });
  });

  it("treats above the first row as its top and below the last as its bottom", () => {
    expect(rowAt(-10, 5)).toEqual({ index: 0, rel: 0 });
    expect(rowAt(ROW_H * 9, 5)).toEqual({ index: 4, rel: 1 });
  });

  it("is null without rows", () => {
    expect(rowAt(10, 0)).toBeNull();
  });
});

describe("revealScrollTop", () => {
  const view = 10 * ROW_H;

  it("doesn't move for a row already in view", () => {
    expect(revealScrollTop(5 * ROW_H, 0, view)).toBe(0);
    expect(revealScrollTop(9 * ROW_H, 0, view)).toBe(0);
  });

  it("scrolls up to align a row above with the top", () => {
    expect(revealScrollTop(3 * ROW_H, 8 * ROW_H, view)).toBe(3 * ROW_H);
  });

  it("scrolls down to align a row below with the bottom", () => {
    expect(revealScrollTop(20 * ROW_H, 0, view)).toBe(11 * ROW_H);
    // Partly visible at the bottom: just enough to show it whole.
    expect(revealScrollTop(10 * ROW_H - 10, 0, view)).toBe(ROW_H - 10);
  });

  it("shows a row's top when the viewport is shorter than a row", () => {
    expect(revealScrollTop(4 * ROW_H, 0, 10)).toBe(4 * ROW_H);
  });
});
