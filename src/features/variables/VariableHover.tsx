import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { Environment } from "@/types";
import { useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { resolveVariable, mergedVariables, type VariableContext } from "@/variables";
import { findVariable } from "@/variableTokens";
import { cn } from "@/lib/utils";
import { displayValue } from "@/features/environments/matrixModel";
import { SecretTag } from "@/features/environments/SecretTag";
import { HOVER_TOKEN_SELECTOR, hitMirrorToken } from "./hitTest";
import { resolvePlain, resolverFor } from "./segments";

type HoverTarget = { kind: "var"; name: string } | { kind: "path"; name: string };

const SHOW_DELAY = 160;
const HIDE_DELAY = 180;
const WIDTH = 320;

function targetOf(el: HTMLElement): HoverTarget | null {
  if (el.dataset.var) return { kind: "var", name: el.dataset.var };
  if (el.dataset.pp) return { kind: "path", name: el.dataset.pp };
  return null;
}

interface VariableHoverLayerProps {
  /** Only tokens inside this element trigger the popover */
  rootRef: RefObject<HTMLElement | null>;
  requestId: string;
  /** "Edit" on a :path param popover */
  onEditPathParam: (name: string) => void;
}

/**
 * The provenance popover for {{variables}} and :path params. One per request
 * view: a document mousemove listener finds tokens under the pointer — real
 * spans in read-only text, or mirrored spans under an input/textarea (hit-tested
 * by rect, since the mirror doesn't take pointer events).
 */
export function VariableHoverLayer({ rootRef, requestId, onEditPathParam }: VariableHoverLayerProps) {
  // `id` changes per opening, so state inside the card (a revealed secret) lasts one popover instance.
  const [open, setOpen] = useState<{ target: HoverTarget; anchor: DOMRect; id: number } | null>(null);
  const openCount = useRef(0);
  const [visible, setVisible] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const forEl = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    forEl.current = null;
    setVisible(false);
    // A field left focused in the hidden card would keep it pinned (see onMove).
    const active = document.activeElement;
    if (active instanceof HTMLElement && popRef.current?.contains(active)) active.blur();
  }, []);

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const onMove = (e: MouseEvent) => {
      // Editing a value in the card pins it: the pointer drifting off (or over another token) doesn't swap or close it.
      if (popRef.current?.contains(document.activeElement)) return;
      const root = rootRef.current;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!root || !target) return;
      let token: HTMLElement | null = null;
      if (root.contains(target) && !target.closest("[data-no-hover]")) {
        token = target.closest<HTMLElement>(HOVER_TOKEN_SELECTOR);
        if (!token && target.matches("[data-vf-input]")) token = hitMirrorToken(target, e.clientX, e.clientY);
      }
      if (token) {
        clear();
        if (forEl.current !== token) {
          const el = token;
          timer.current = setTimeout(() => {
            const t = targetOf(el);
            if (!t || !el.isConnected) return;
            forEl.current = el;
            setOpen({ target: t, anchor: el.getBoundingClientRect(), id: ++openCount.current });
            // next frame, so the first show also fades in
            requestAnimationFrame(() => setVisible(forEl.current === el));
          }, SHOW_DELAY);
        }
        return;
      }
      if (popRef.current?.contains(target)) {
        clear();
        return;
      }
      clear();
      if (forEl.current) timer.current = setTimeout(hide, HIDE_DELAY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // Clicking elsewhere or scrolling (which strands the anchor) closes it right away.
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node && popRef.current?.contains(e.target))) hide();
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && popRef.current?.contains(e.target))) hide();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
      clear();
    };
  }, [rootRef, hide]);

  // Place under the token (clamped to the window), or above it when it would overflow the bottom.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop || !open) return;
    const r = open.anchor;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - WIDTH - 8);
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={open.target.kind === "path" ? `Path parameter ${open.target.name}` : `Variable ${open.target.name}`}
      className={cn(
        "fixed z-[90] w-[320px] rounded-lg bg-bg1 px-3 py-2.5 text-xs text-fg shadow-pop transition-[opacity,transform] duration-150 ease-out",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none -translate-y-0.5 opacity-0",
      )}
    >
      {open.target.kind === "path" ? (
        <PathParamCard
          requestId={requestId}
          name={open.target.name}
          onEdit={(name) => {
            hide();
            onEditPathParam(name);
          }}
        />
      ) : (
        <VariableCard key={open.id} requestId={requestId} name={open.target.name} onDone={hide} />
      )}
    </div>,
    document.body,
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-fg2 underline decoration-line2 underline-offset-[3px] hover:text-fg hover:decoration-current"
    >
      {children}
    </button>
  );
}

interface HeaderProps {
  name: string;
  tone: "var" | "miss" | "path";
  source: string;
  secret?: boolean;
}

function Header({ name, tone, source, secret }: HeaderProps) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="min-w-0">
        <span
          className={cn(
            "font-mono text-[12.5px] font-medium break-all",
            tone === "var" && "text-brass",
            tone === "miss" && "text-err",
            tone === "path" && "text-j-k",
          )}
        >
          {name}
        </span>
        {secret && <SecretTag />}
      </span>
      <span className="text-fg3">{source}</span>
    </div>
  );
}

function ValueBox({ children }: { children: ReactNode }) {
  return <div className="mb-2 rounded-[5px] bg-bg0 px-2 py-1.5 font-mono text-[12.5px] break-all text-fg">{children}</div>;
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex justify-between border-t border-line pt-[7px] text-fg3">{children}</div>;
}

function scopeLabel(label: string, scopeName: string) {
  return scopeName ? `${label} · ${scopeName}` : label;
}

function VariableCard({ requestId, name, onDone }: { requestId: string; name: string; onDone: () => void }) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ctx: VariableContext = ws.variableContext(requestId);
  const res = resolveVariable(name, ctx);
  const env = ws.activeEnvironment;
  const secret = ws.isSecretVariable(name);
  const [revealed, setRevealed] = useState(false);
  const shown = (value: string) => displayValue(value, secret, revealed);

  if (res.winner >= 0) {
    const win = res.chain[res.winner];
    return (
      <>
        <Header name={`{{${name}}}`} tone="var" source={`from ${scopeLabel(win.label, win.scopeName)}`} secret={secret} />
        <ValueBox>
          {secret && !revealed ? (
            <span className="flex items-center justify-between gap-2">
              <span aria-label="Hidden secret value">{shown(win.value ?? "")}</span>
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="cursor-pointer font-sans text-[11.5px] text-fg3 hover:text-fg"
              >
                Show
              </button>
            </span>
          ) : (
            win.value
          )}
        </ValueBox>
        <div className="mb-2 grid gap-0.5">
          {res.chain.map((c, i) => {
            const isWin = i === res.winner;
            const shadowed = !isWin && c.value !== undefined && i > res.winner;
            return (
              <div key={c.scope} className={cn("grid grid-cols-[14px_1fr_auto] items-center gap-1.5 text-fg3", isWin && "text-fg")}>
                <span className="grid place-items-center">{isWin && <Check className="size-2.5" strokeWidth={3} />}</span>
                <span className="truncate">{scopeLabel(c.label, c.scopeName)}</span>
                <span className={cn("max-w-[140px] truncate font-mono", shadowed && "line-through")}>{c.value !== undefined ? shown(c.value) || "—" : "—"}</span>
              </div>
            );
          })}
        </div>
        {env && <EnvValueEditor env={env} name={name} secret={secret} />}
        <Footer>
          <span>env → collection → globals</span>
          <LinkButton
            onClick={() => {
              onDone();
              session.openEnvironments({ variable: name });
            }}
          >
            Edit
          </LinkButton>
        </Footer>
      </>
    );
  }

  const definedIn = ws.workspace.environments.filter((e) => findVariable(name, e.variables) !== undefined).map((e) => e.name);
  return (
    <>
      <Header name={`{{${name}}}`} tone="miss" source={env ? `not defined in ${env.name}` : "not defined"} secret={secret} />
      <div className="mb-2 grid gap-0.5">
        {res.chain.map((c) => (
          <div key={c.scope} className="grid grid-cols-[14px_1fr_auto] items-center gap-1.5 text-fg3">
            <span />
            <span className="truncate">{scopeLabel(c.label, c.scopeName)}</span>
            <span className="max-w-[140px] truncate font-mono">—</span>
          </div>
        ))}
      </div>
      <div className="mb-2 text-xs leading-normal text-fg3">
        {definedIn.length ? `Defined in ${definedIn.join(", ")}.` : "Not defined anywhere."} As things stand, it would be sent literally.
      </div>
      {env && <EnvValueEditor env={env} name={name} secret={secret} />}
      <Footer>
        <span />
        <LinkButton
          onClick={() => {
            onDone();
            session.openEnvironments({ variable: name, environmentId: env?.id });
          }}
        >
          {env ? "Open environments" : "Define it"}
        </LinkButton>
      </Footer>
    </>
  );
}

/**
 * The variable's value in the active environment, editable in place. It only takes focus
 * on a click: the card opens while people type in the URL, and must not steal keystrokes.
 */
function EnvValueEditor({ env, name, secret }: { env: Environment; name: string; secret: boolean }) {
  const ws = useWorkspace();
  const current = findVariable(name, env.variables)?.value;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // A secret isn't shown to be edited: an untouched field means "keep the stored value".
  const keepsSecret = secret && current !== undefined && current !== "";

  const start = () => {
    setDraft(keepsSecret ? "" : (current ?? ""));
    setEditing(true);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!(keepsSecret && draft === "")) ws.setVariableIn({ scope: "environment", id: env.id }, name, draft);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2 rounded-[5px] border border-line px-2 py-1.5">
        <span className="min-w-0 truncate text-fg3">
          In {env.name}:{" "}
          {current === undefined ? (
            "not set"
          ) : (
            <span className="font-mono text-fg2">{displayValue(current, secret, false) || "empty"}</span>
          )}
        </span>
        <button type="button" onClick={start} className="flex-none text-brass hover:underline">
          {current === undefined ? `Set in ${env.name}` : "Change"}
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="mb-2 grid gap-1.5">
      <label className="text-fg3" htmlFor="variable-hover-value">
        Value in {env.name}
      </label>
      <div className="flex gap-1.5">
        <input
          id="variable-hover-value"
          autoFocus
          type={secret ? "password" : "text"}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={keepsSecret ? "Type a new value (blank keeps it)" : "Value"}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // First Escape cancels the edit; the next one closes the card.
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }}
          className="h-7 min-w-0 flex-1 rounded-[5px] border border-line2 bg-bg0 px-2 font-mono text-[12.5px] text-fg outline-none placeholder:font-sans placeholder:text-fg3 focus:border-brass-line"
        />
        <button type="submit" className="h-7 flex-none rounded-[5px] bg-brass px-2.5 font-medium text-brass-ink hover:brightness-110">
          Save
        </button>
      </div>
    </form>
  );
}

function PathParamCard({ requestId, name, onEdit }: { requestId: string; name: string; onEdit: (name: string) => void }) {
  const ws = useWorkspace();
  const request = ws.findRequest(requestId)?.request;
  const raw = request?.pathVariables?.[name];
  const value = raw ? resolvePlain(raw, resolverFor(mergedVariables(ws.variableContext(requestId)))) : "";
  return (
    <>
      <Header name={`:${name}`} tone="path" source="path parameter" />
      <ValueBox>{value ? value : <span className="text-err">no value yet</span>}</ValueBox>
      <Footer>
        <span>set in Params → Path parameters</span>
        <LinkButton onClick={() => onEdit(name)}>Edit</LinkButton>
      </Footer>
    </>
  );
}
