import { useRef, useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkmark } from "@/components/common/Checkmark";
import { ENV_SWATCHES, useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi, type EnvironmentDialogState } from "@/state/ui";
import type { Environment } from "@/types";
import { cn } from "@/lib/utils";
import {
  Field,
  FieldError,
  Hint,
  Modal,
  ModalBody,
  ModalFooter,
  PrimaryButton,
  SecondaryButton,
  SELECT_CONTENT_CLASS,
  SELECT_ITEM_CLASS,
  SELECT_TRIGGER_CLASS,
  TextInput,
} from "@/components/common/Modal";

const EMPTY = "__empty__";

/** "New environment" / "Rename environment", driven by ui.environmentDialog. */
export function EnvironmentDialog() {
  const ui = useUi();
  const state = ui.environmentDialog;
  if (!state) return null;
  // Remount per request so the form starts fresh each time.
  return <EnvironmentForm key={JSON.stringify(state)} state={state} onClose={ui.closeEnvironmentDialog} />;
}

function EnvironmentForm({ state, onClose }: { state: EnvironmentDialogState; onClose: () => void }) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const environments = ws.workspace.environments;
  const creating = state.mode === "create";
  const renaming = state.mode === "rename" ? environments.find((e) => e.id === state.environmentId) : undefined;
  const copyFrom = state.mode === "create" ? environments.find((e) => e.id === state.copyFromId) : undefined;

  const [name, setName] = useState(renaming?.name ?? (copyFrom ? `${copyFrom.name} copy` : ""));
  const [color, setColor] = useState(renaming?.color ?? ENV_SWATCHES[(environments.length + 1) % ENV_SWATCHES.length]);
  const [sourceId, setSourceId] = useState(copyFrom?.id ?? EMPTY);
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const source = environments.find((e) => e.id === sourceId);

  function submit() {
    const trimmed = name.trim();
    const clash = environments.find((e) => e.name.toLowerCase() === trimmed.toLowerCase() && e.id !== renaming?.id);
    const problem = !trimmed ? "Give it a name." : clash ? `There's already an environment called “${clash.name}”.` : "";
    if (problem) {
      setError(problem);
      nameRef.current?.focus();
      return;
    }

    if (!creating) {
      if (renaming) ws.updateEnvironment(renaming.id, { name: trimmed, color });
      onClose();
      toast(
        <span>
          Renamed to <b className="font-medium">{trimmed}</b>.
        </span>,
      );
      return;
    }

    const env = ws.createEnvironment({ name: trimmed, color, copyFromId: source?.id, activate });
    if (activate) {
      session.clearBlocker();
      session.bumpSweep();
    }
    onClose();
    session.openEnvironments({ freshEnvironmentId: env.id });
    toast(
      <span>
        Created <b className="font-medium">{trimmed}</b>
        {activate ? " and made it active" : ""}. Fill in its column.
      </span>,
    );
  }

  if (!creating && !renaming) return null; // the environment vanished (deleted/undo) while the dialog was open

  return (
    <Modal
      size="sm"
      title={creating ? "New environment" : "Rename environment"}
      onClose={onClose}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        nameRef.current?.focus();
        nameRef.current?.select();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <ModalBody>
        <Field label="Name" htmlFor="env-dialog-name">
          <TextInput
            ref={nameRef}
            id="env-dialog-name"
            value={name}
            placeholder="QA, Docker, Staging EU…"
            aria-invalid={!!error}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
          />
          <FieldError>{error}</FieldError>
        </Field>

        <Field label="Color">
          <ColorSwatches value={color} onChange={setColor} />
        </Field>

        {creating && (
          <>
            <Field label="Start with" htmlFor="env-dialog-from">
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="env-dialog-from" className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className={SELECT_CONTENT_CLASS}>
                  <SelectItem value={EMPTY} className={SELECT_ITEM_CLASS}>
                    No variables
                  </SelectItem>
                  {environments.map((e) => (
                    <SelectItem key={e.id} value={e.id} className={SELECT_ITEM_CLASS}>
                      A copy of {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Hint>
                <SourcePreview source={source} />
              </Hint>
            </Field>

            <label className="flex w-max cursor-pointer items-center gap-2 text-[12.5px] text-fg2">
              <Checkmark checked={activate} onChange={setActivate} />
              Switch to it after creating
            </label>
          </>
        )}
      </ModalBody>
      <ModalFooter hint="Stored in the workspace file with everything else.">
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={submit}>{creating ? "Create environment" : "Rename"}</PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

function SourcePreview({ source }: { source: Environment | undefined }) {
  if (!source) return <>Starts empty. Anything it doesn't define falls back to the collection, then globals.</>;
  const keys = source.variables.map((v) => v.key);
  const anySecret = source.variables.some((v) => v.secret);
  return (
    <>
      Copies {keys.length} variable{keys.length === 1 ? "" : "s"} from {source.name}:{" "}
      <span className="font-mono">{keys.join(", ") || "none"}</span>.{anySecret && " Secret values are copied only on this machine."}
    </>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Color">
      {ENV_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c.replace(/^var\(--|\)$/g, "")}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={cn(
            "size-[22px] cursor-pointer rounded-full shadow-[0_0_0_2px_var(--bg1),0_0_0_3px_transparent]",
            c === value && "shadow-[0_0_0_2px_var(--bg1),0_0_0_3.5px_var(--fg2)]",
          )}
        />
      ))}
    </div>
  );
}
