import { onDemand } from "@/features/shell/onDemand";

/** Burst results in the response pane: stats, chart, and the per-request log (loaded with the first burst). */
export const BurstPanel = onDemand(() => import("./BurstReport").then((m) => m.BurstReport));
