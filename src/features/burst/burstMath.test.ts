import { describe, expect, it } from "vitest";
import type { BurstResult } from "@/http/burst";
import {
  BAR_LIMIT,
  CHART,
  chartGeometry,
  firstRateLimited,
  latencyTop,
  mergeBySeq,
  percentile,
  remainingScale,
  resultKind,
  summarizeBurst,
} from "./burstMath";

function res(seq: number, over: Partial<BurstResult> = {}): BurstResult {
  return {
    seq,
    t: seq * 0.1,
    status: 200,
    ok: true,
    ms: 50,
    remaining: null,
    limit: null,
    retryAfter: null,
    rateLimitHeaders: [],
    ...over,
  };
}

describe("percentile", () => {
  it("returns null for no samples", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
  it("uses nearest-rank on a sorted list", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.5)).toBe(51);
    expect(percentile(xs, 0.95)).toBe(96);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe("mergeBySeq", () => {
  const seqs = (rs: BurstResult[]) => rs.map((r) => r.seq);
  it("appends a batch that comes after everything so far", () => {
    const sorted = [res(1), res(2)];
    const merged = mergeBySeq(sorted, [res(4), res(3)]);
    expect(seqs(merged)).toEqual([1, 2, 3, 4]);
    expect(seqs(sorted)).toEqual([1, 2]);
  });
  it("merges a batch that overlaps the tail", () => {
    expect(seqs(mergeBySeq([res(1), res(3), res(6)], [res(5), res(2), res(7)]))).toEqual([1, 2, 3, 5, 6, 7]);
    expect(seqs(mergeBySeq([res(4), res(5)], [res(1)]))).toEqual([1, 4, 5]);
  });
  it("returns the same array for an empty batch", () => {
    const sorted = [res(1)];
    expect(mergeBySeq(sorted, [])).toBe(sorted);
  });
});

describe("resultKind / firstRateLimited", () => {
  it("classifies statuses", () => {
    expect(resultKind(res(1))).toBe("ok");
    expect(resultKind(res(1, { status: 429, ok: false }))).toBe("limited");
    expect(resultKind(res(1, { status: 500, ok: false }))).toBe("other");
    expect(resultKind(res(1, { status: null, ok: false, error: "boom" }))).toBe("error");
  });
  it("finds the lowest-seq 429 regardless of order", () => {
    const rs = [res(5, { status: 429 }), res(1), res(3, { status: 429 }), res(2)];
    expect(firstRateLimited(rs)?.seq).toBe(3);
    expect(firstRateLimited([res(1)])).toBeNull();
  });
});

describe("summarizeBurst", () => {
  it("counts kinds and computes 2xx-only latency percentiles", () => {
    const rs = [
      res(1, { ms: 10 }),
      res(2, { ms: 30 }),
      res(3, { ms: 20 }),
      res(4, { status: 429, ok: false, ms: 5 }),
      res(5, { status: 503, ok: false, ms: 900 }),
      res(6, { status: null, ok: false, ms: 1, error: "refused" }),
    ];
    const s = summarizeBurst(rs);
    expect(s).toMatchObject({ sent: 6, ok: 3, limited: 1, other: 1, errors: 1, p50: 20, p95: 30 });
    expect(s.first429?.seq).toBe(4);
  });
  it("has null percentiles with no 2xx", () => {
    expect(summarizeBurst([res(1, { status: 429 })]).p50).toBeNull();
  });
});

describe("remainingScale", () => {
  it("is null when no remaining header was seen", () => {
    expect(remainingScale([res(1), res(2)])).toBeNull();
  });
  it("prefers the largest reported limit", () => {
    expect(remainingScale([res(1, { remaining: 9, limit: 10 }), res(2, { remaining: 8, limit: 60 })])).toBe(60);
  });
  it("falls back to first remaining + 1", () => {
    expect(remainingScale([res(1, { remaining: 59 }), res(2, { remaining: 58 })])).toBe(60);
  });
  it("never sits below a remaining value (window reset)", () => {
    expect(remainingScale([res(1, { remaining: 2 }), res(2, { remaining: 50 })])).toBe(50);
  });
});

describe("latencyTop", () => {
  it("is at least 120 and rounds up to 50", () => {
    expect(latencyTop([])).toBe(150);
    expect(latencyTop([res(1, { ms: 90 })])).toBe(150);
    expect(latencyTop([res(1, { ms: 151 })])).toBe(200);
    expect(latencyTop([res(1, { ms: 200 })])).toBe(200);
  });
});

describe("chartGeometry", () => {
  it("lays out the plot area with the mockup gutters and a minimum width", () => {
    const g = chartGeometry([], 5, 100, 100);
    expect(g.width).toBe(CHART.minWidth);
    expect(g.height).toBe(150);
    expect(g.left).toBe(50);
    expect(g.right).toBe(CHART.minWidth - 34);
    expect(g.top).toBe(12);
    expect(g.bottom).toBe(128);
    expect(g.ticks.map((t) => t.label)).toEqual(["0", "75", "150 ms"]);
    expect(g.ticks.map((t) => t.y)).toEqual([128, 70, 12]);
    expect(g.remaining).toBeNull();
    expect(g.first429).toBeNull();
  });

  it("positions bars by time and height by latency", () => {
    // width 434 → plot 50..400 (350px), 5s → 70px/s; top 150ms, plot height 116
    const g = chartGeometry([res(1, { t: 2.5, ms: 75 })], 5, 10, 434);
    const bw = Math.min(10, (350 / 10) * 0.62);
    const [bar] = g.bars;
    expect(bar.x).toBeCloseTo(225 - bw / 2, 2);
    expect(bar.w).toBeCloseTo(bw, 2);
    expect(bar.y).toBe(70);
    expect(bar.h).toBe(58);
    expect(bar.kind).toBe("ok");
  });

  it("uses a 1.2px minimum bar width", () => {
    const g = chartGeometry([res(1)], 60, 12000, 434);
    expect(g.bars[0].w).toBe(1.2);
  });

  it("clamps times past the end of the run to the plot edge", () => {
    const g = chartGeometry([res(1, { t: 9 })], 5, 10, 434);
    expect(g.bars[0].x + g.bars[0].w / 2).toBeCloseTo(400, 1);
  });

  it("draws the remaining step line from the scale down to each value", () => {
    const g = chartGeometry([res(1, { t: 1, remaining: 1, limit: 2 }), res(2, { t: 2, remaining: 0, limit: 2 })], 5, 10, 434);
    expect(g.remaining).toEqual({ path: "M50,12 H120 V70 H190 V128", scale: 2 });
  });

  it("skips results without a remaining header in the step line", () => {
    const g = chartGeometry([res(1, { t: 1, remaining: 1, limit: 2 }), res(2, { t: 2 })], 5, 10, 434);
    expect(g.remaining?.path).toBe("M50,12 H120 V70");
  });

  it("draws a run of equal remaining values as one stretch", () => {
    const g = chartGeometry(
      [res(1, { t: 1, remaining: 0, limit: 2 }), res(2, { t: 2, remaining: 0, limit: 2 }), res(3, { t: 3, remaining: 0, limit: 2 })],
      5,
      10,
      434,
    );
    expect(g.remaining?.path).toBe("M50,12 H120 V128 H260");
  });

  it("keeps one bar per result up to the limit", () => {
    const rs = Array.from({ length: BAR_LIMIT }, (_, i) => res(i + 1, { t: (i / BAR_LIMIT) * 5 }));
    expect(chartGeometry(rs, 5, BAR_LIMIT, 434).bars).toHaveLength(BAR_LIMIT);
  });

  it("pools a huge run into the tallest bar per pixel column and kind", () => {
    const n = 12000;
    const rs = Array.from({ length: n }, (_, i) =>
      res(i + 1, { t: (i / n) * 60, ms: i === 6000 ? 140 : 40, status: i % 100 === 0 ? 429 : 200 }),
    );
    const g = chartGeometry(rs, 60, n, 434);
    // 350px plot: at most one bar per column per kind
    expect(g.bars.length).toBeLessThanOrEqual(350 * 2);
    expect(g.bars.length).toBeGreaterThan(350);
    const tallest = g.bars.reduce((a, b) => (b.h > a.h ? b : a));
    expect(tallest.seq).toBe(6001);
    expect(g.bars.filter((b) => b.kind === "limited")).toHaveLength(120);
  });

  it("marks the first 429 and anchors its label at the end near the right edge", () => {
    const early = chartGeometry([res(1, { t: 1 }), res(2, { t: 1.5, status: 429 })], 5, 10, 434);
    expect(early.first429).toEqual({ x: 155, seq: 2, anchor: "start" });
    const late = chartGeometry([res(9, { t: 4.8, status: 429 })], 5, 10, 434);
    expect(late.first429?.anchor).toBe("end");
  });
});
