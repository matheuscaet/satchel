import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EnvDot } from "@/components/common/EnvDot";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import { useAppActions } from "@/state/actions";
import { cn } from "@/lib/utils";
import { EnvironmentColumnMenu } from "./EnvironmentColumnMenu";
import { MATRIX_CELL_CLASS, MATRIX_STICKY_CLASS, MatrixCell } from "./MatrixCell";
import { LinkButton, SecondaryButton } from "@/components/common/Modal";
import { SecretTag } from "./SecretTag";
import { SecretToggle } from "./SecretToggle";
import { ShareSecretDialog } from "./ShareSecretDialog";
import {
  columnWidth,
  envColumnKey,
  GLOBALS_KEY,
  hasAnyValue,
  matrixColumns,
  matrixVariableNames,
  secretVariableNames,
  valueIn,
  VARIABLE_NAME,
  type MatrixColumn,
} from "./matrixModel";

type Highlight = { kind: "hit"; variable: string; columnKey: string } | { kind: "fresh"; columnKey: string };
/** A cell to focus (or, without a variable, a column to reveal) after the next render. */
type FocusRequest = { columnKey: string; variable?: string };

const HEAD_CELL_CLASS = "sticky top-0 z-[2] h-11 border-t bg-bg0 font-sans text-[12.5px] font-medium text-fg2";

/** The "Environments" tab: every variable × globals / collections / environments, edited in place. */
export function EnvironmentMatrix() {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const actions = useAppActions();
  const { workspace } = ws;
  const activeId = workspace.activeEnvironmentId;
  const activeKey = activeId && workspace.environments.some((e) => e.id === activeId) ? envColumnKey(activeId) : null;

  const [extra, setExtra] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [newName, setNewName] = useState("");
  /** Rows not defined anywhere yet that were marked secret: the flag is applied with their first value. */
  const [pendingSecret, setPendingSecret] = useState<string[]>([]);
  const [confirmShare, setConfirmShare] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const columns = useMemo(() => matrixColumns(workspace), [workspace]);
  const names = useMemo(() => matrixVariableNames(workspace, extra), [workspace, extra]);
  const secrets = useMemo(() => {
    const set = secretVariableNames(columns);
    for (const n of pendingSecret) set.add(n);
    return set;
  }, [columns, pendingSecret]);
  const widths = useMemo(() => new Map(columns.map((c) => [c.key, columnWidth(c, names, secrets)])), [columns, names, secrets]);

  // Extra rows (and their pending secret flag) only live until something defines them.
  useEffect(() => {
    const defined = new Set(matrixVariableNames(workspace));
    setExtra((x) => (x.some((n) => defined.has(n)) ? x.filter((n) => !defined.has(n)) : x));
    setPendingSecret((x) => (x.some((n) => defined.has(n)) ? x.filter((n) => !defined.has(n)) : x));
  }, [workspace]);

  // "Define in Production", a just-created environment, …: highlight and focus, then consume the request.
  const { matrixFocus, clearMatrixFocus } = session;
  useEffect(() => {
    if (!matrixFocus) return;
    if (matrixFocus.freshEnvironmentId) {
      const columnKey = envColumnKey(matrixFocus.freshEnvironmentId);
      setHighlight({ kind: "fresh", columnKey });
      setFocusRequest({ columnKey, variable: names[0] });
    } else if (matrixFocus.variable) {
      const variable = matrixFocus.variable;
      const columnKey = matrixFocus.environmentId ? envColumnKey(matrixFocus.environmentId) : (activeKey ?? GLOBALS_KEY);
      if (!names.includes(variable)) setExtra((x) => [...x, variable]);
      setHighlight(matrixFocus.environmentId ? { kind: "hit", variable, columnKey } : null);
      setFocusRequest({ columnKey, variable });
    }
    clearMatrixFocus();
    // names/activeKey are read at the moment the request arrives.
  }, [matrixFocus, clearMatrixFocus]);

  useEffect(() => {
    if (!focusRequest) return;
    const table = tableRef.current;
    const wrap = wrapRef.current;
    setFocusRequest(null);
    if (!table || !wrap) return;
    const target = focusRequest.variable
      ? [...table.querySelectorAll<HTMLInputElement>("input[data-cell]")].find(
          (i) => i.dataset.cell === `${focusRequest.columnKey}|${focusRequest.variable}`,
        )
      : undefined;
    const cell =
      target?.closest("td") ??
      [...table.querySelectorAll<HTMLElement>("th[data-col]")].find((th) => th.dataset.col === focusRequest.columnKey);
    if (!cell) return;
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealHorizontally(wrap, cell, table.querySelector("th")?.offsetWidth ?? 0);
    if (target) {
      target.focus({ preventScroll: true });
      target.select();
    } else {
      table.querySelector<HTMLInputElement>("input[data-new-variable]")?.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  function commit(column: MatrixColumn, name: string, draft: string) {
    if (draft === (valueIn(column, name) ?? "")) return;
    ws.setVariableIn(column.target, name, draft === "" ? null : draft);
    if (draft !== "" && pendingSecret.includes(name)) ws.setVariableSecret(name, true);
    setHighlight(null);
    toast(
      <span>
        <span className="font-mono">{`{{${name}}}`}</span> {draft === "" ? "removed from" : "saved in"} {column.label}.
      </span>,
    );
  }

  function setSecret(name: string, secret: boolean) {
    const defined = columns.some((c) => c.variables.some((v) => v.key === name));
    if (defined) ws.setVariableSecret(name, secret);
    setPendingSecret((x) => (secret && !defined ? [...x, name] : x.filter((n) => n !== name)));
    toast(
      <span>
        <span className="font-mono">{`{{${name}}}`}</span>{" "}
        {secret ? "is secret now. Its values stay on this machine." : "is shared again. Its values go in the workspace files."}
      </span>,
    );
  }

  function toggleSecret(name: string) {
    if (!secrets.has(name)) setSecret(name, true);
    else if (hasAnyValue(columns, name)) setConfirmShare(name);
    else setSecret(name, false);
  }

  function addVariable(): boolean {
    const name = newName.trim();
    if (!name) return true;
    if (!VARIABLE_NAME.test(name)) {
      toast("Variable names use letters, numbers, dots, dashes and underscores.");
      return false;
    }
    if (!names.includes(name)) setExtra((x) => [...x, name]);
    setNewName("");
    const columnKey = activeKey ?? GLOBALS_KEY;
    setHighlight({ kind: "hit", variable: name, columnKey });
    setFocusRequest({ columnKey, variable: name });
    return true;
  }

  function ringFor(columnKey: string, name: string): "hit" | "fresh" | null {
    if (!highlight || highlight.columnKey !== columnKey) return null;
    if (highlight.kind === "fresh") return "fresh";
    return highlight.variable === name ? "hit" : null;
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4">
      <div className="mb-3.5 flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="m-0 mb-1 text-[15px] font-semibold tracking-[-0.01em]">Environments &amp; globals</h2>
          <div className="text-[12.5px] text-fg3">
            Resolves as <span className="text-fg2">Active environment</span> → <span className="text-fg2">Collection</span> →{" "}
            <span className="text-fg2">Globals</span>. Click an environment's header to make it active.
          </div>
        </div>
        <span className="flex-1" />
        <SecondaryButton onClick={() => ui.openEnvironmentDialog({ mode: "create" })}>New environment</SecondaryButton>
      </div>

      <div ref={wrapRef} className="max-w-full overflow-x-auto">
        <table ref={tableRef} className="border-separate border-spacing-0 font-mono text-[12.5px]">
          <thead>
            <tr>
              <th className={cn(MATRIX_CELL_CLASS, HEAD_CELL_CLASS, MATRIX_STICKY_CLASS, "z-[3] bg-bg0 text-fg")}>Variable</th>
              {columns.map((column) => {
                const env = column.environment;
                const isActive = column.key === activeKey;
                return (
                  <th
                    key={column.key}
                    data-col={column.key}
                    onClick={env ? () => actions.switchEnvironment(env.id) : undefined}
                    className={cn(
                      MATRIX_CELL_CLASS,
                      HEAD_CELL_CLASS,
                      env && "group cursor-pointer hover:text-fg",
                      isActive &&
                        "bg-[color-mix(in_srgb,var(--brass)_10%,var(--bg0))] text-fg shadow-[inset_0_2px_0_var(--brass)]",
                    )}
                  >
                    <span className="block text-[10.5px] leading-[14px] font-medium tracking-[0.04em] text-fg3 uppercase">
                      {column.group}
                      {isActive && " · active"}
                    </span>
                    <span className="flex items-center gap-[7px] leading-[18px]">
                      {env && <EnvDot color={env.color} />}
                      {column.label}
                      {env && <EnvironmentColumnMenu environment={env} />}
                    </span>
                  </th>
                );
              })}
              <th className={cn(MATRIX_CELL_CLASS, HEAD_CELL_CLASS, "border-r-0 bg-transparent pb-1.5 align-bottom")}>
                <LinkButton onClick={() => ui.openEnvironmentDialog({ mode: "create" })}>+ Environment</LinkButton>
              </th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => (
              <tr key={name} className="group/row">
                <td className={cn(MATRIX_CELL_CLASS, MATRIX_STICKY_CLASS)}>
                  <span className="flex items-center gap-2">
                    <span>
                      {name}
                      {secrets.has(name) && <SecretTag />}
                    </span>
                    <SecretToggle name={name} secret={secrets.has(name)} onToggle={() => toggleSecret(name)} />
                  </span>
                </td>
                {columns.map((column) => {
                  const value = valueIn(column, name);
                  const isActive = column.key === activeKey;
                  return (
                    <MatrixCell
                      key={column.key}
                      name={name}
                      columnKey={column.key}
                      columnLabel={column.label}
                      value={value}
                      width={widths.get(column.key) ?? 10}
                      active={isActive}
                      winning={isActive && (value ?? "") !== ""}
                      ring={ringFor(column.key, name)}
                      secret={secrets.has(name)}
                      onCommit={(draft) => commit(column, name, draft)}
                    />
                  );
                })}
                <td className={cn(MATRIX_CELL_CLASS, "border-r-0")} />
              </tr>
            ))}
            <tr>
              <td className={cn(MATRIX_CELL_CLASS, MATRIX_STICKY_CLASS)}>
                <input
                  data-new-variable
                  value={newName}
                  placeholder="+ Add variable"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Add variable"
                  className="block h-[31px] w-full min-w-0 bg-transparent font-mono text-[12.5px] leading-[31px] text-fg outline-none placeholder:font-sans placeholder:text-fg3"
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={addVariable}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addVariable();
                    }
                  }}
                />
              </td>
              {columns.map((column) => (
                <td key={column.key} className={cn(MATRIX_CELL_CLASS, column.key === activeKey && "bg-brass-soft")} />
              ))}
              <td className={cn(MATRIX_CELL_CLASS, "border-r-0")} />
            </tr>
          </tbody>
        </table>
      </div>
      {confirmShare && (
        <ShareSecretDialog
          name={confirmShare}
          onConfirm={() => setSecret(confirmShare, false)}
          onClose={() => setConfirmShare(null)}
        />
      )}
    </div>
  );
}

/** Scroll the matrix wrapper so `cell` is fully visible to the right of the sticky name column. */
function revealHorizontally(wrap: HTMLElement, cell: HTMLElement, stickyWidth: number) {
  const left = cell.offsetLeft;
  const right = left + cell.offsetWidth;
  if (right > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = right - wrap.clientWidth + 40;
  if (left < wrap.scrollLeft + stickyWidth) wrap.scrollLeft = Math.max(0, left - stickyWidth);
}
