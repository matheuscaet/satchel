import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { firstRequestId, useWorkspace } from "@/state/workspace";
import { useSessionCore } from "@/state/session";
import { useUi } from "@/state/ui";
import type { FolderNode } from "@/types";
import {
  FieldError,
  Hint,
  Modal,
  ModalBody,
  ModalFooter,
  PrimaryButton,
  SecondaryButton,
} from "@/components/common/Modal";
import { AttachedEnvironments } from "./AttachedEnvironments";
import { DropZone } from "./DropZone";
import { ImportReview, type ImportDest } from "./ImportReview";
import { ImportWarnings } from "./ImportWarnings";
import {
  importWarnings,
  knownVariables,
  plannedEnvironmentNames,
  plural,
  readPostmanFiles,
  type AttachedEnvironment,
  type PickedCollection,
} from "./importModel";

/** "Import from Postman", driven by ui.postmanDialog (files dropped on the window arrive in `files`). */
export function PostmanImportDialog() {
  const ui = useUi();
  if (!ui.postmanDialog) return null;
  return <PostmanImport files={ui.postmanDialog.files} onClose={ui.closePostmanDialog} />;
}

function PostmanImport({ files, onClose }: { files: File[]; onClose: () => void }) {
  const ws = useWorkspace();
  const session = useSessionCore();
  const ui = useUi();
  const collections = ws.workspace.collections;

  const [picked, setPicked] = useState<PickedCollection | null>(null);
  const [attached, setAttached] = useState<AttachedEnvironment[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [dest, setDest] = useState<ImportDest>("new");
  const [into, setInto] = useState(collections[0]?.id ?? "");
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFiles(list: File[]) {
    if (!list.length) return;
    setError("");
    const result = await readPostmanFiles(list);
    if (result.environments.length) setAttached((a) => [...a, ...result.environments]);
    if (result.collection) {
      setPicked(result.collection);
      setName(result.collection.analysis.collection.name);
    }
    setError(result.error ?? "");
  }

  // Files handed over on open (or dropped on the window while open). The ref
  // keeps StrictMode's double effect from attaching environments twice.
  const handled = useRef<File[] | null>(null);
  useEffect(() => {
    if (handled.current === files) return;
    handled.current = files;
    void handleFiles(files);
  }, [files]);

  const targetId = collections.some((c) => c.id === into) ? into : (collections[0]?.id ?? "");
  const merging = dest === "merge" && !!targetId;

  const warnings = useMemo(() => {
    if (!picked) return [];
    const known = knownVariables(picked.analysis, ws.workspace, attached, { dest: merging ? "merge" : "new", into: targetId });
    return importWarnings(picked.analysis, known);
  }, [picked, ws.workspace, attached, merging, targetId]);

  const plannedNames = useMemo(
    () => plannedEnvironmentNames(ws.workspace.environments.map((e) => e.name), attached),
    [ws.workspace.environments, attached],
  );

  function commit() {
    if (!picked) return;
    const { collection, stats } = picked.analysis;
    const finalName = name.trim() || collection.name;
    let first: string | undefined;
    if (merging) {
      const folder: FolderNode = { type: "folder", id: crypto.randomUUID(), name: finalName, children: collection.items };
      ws.importIntoCollection(targetId, folder, collection.variables);
      first = firstRequestId(folder.children);
    } else {
      ws.importCollection({ ...collection, name: finalName });
      first = firstRequestId(collection.items);
    }
    const added = attached.length ? ws.addEnvironments(attached.map((a) => a.environment)) : [];
    ui.setForceFirstRun(false);
    if (first) session.openTab(first);
    onClose();
    toast(
      <span>
        Imported <b className="font-medium">{finalName}</b>: {plural(stats.requests, "request")}
        {added.length ? ` and ${plural(added.length, "environment")} (${added.map((e) => e.name).join(", ")})` : ""}.
      </span>,
    );
  }

  const chooseFiles = () => fileInput.current?.click();

  return (
    <Modal title="Import from Postman" onClose={onClose}>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          void handleFiles(list);
        }}
      />
      {picked ? (
        <>
          <ModalBody>
            <ImportReview
              picked={picked}
              name={name}
              onNameChange={setName}
              dest={merging ? "merge" : "new"}
              onDestChange={setDest}
              collections={collections}
              into={targetId}
              onIntoChange={setInto}
              onChangeFile={chooseFiles}
            />
            <ImportWarnings warnings={warnings} />
            <AttachedEnvironments
              attached={attached}
              plannedNames={plannedNames}
              onRemove={(id) => setAttached((a) => a.filter((x) => x.id !== id))}
              onAdd={chooseFiles}
            />
            <FieldError>{error}</FieldError>
          </ModalBody>
          <ModalFooter hint="Read locally. Postman isn't contacted.">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton onClick={commit}>Import {plural(picked.analysis.stats.requests, "request")}</PrimaryButton>
          </ModalFooter>
        </>
      ) : (
        <>
          <ModalBody>
            <DropZone onChoose={chooseFiles} />
            {attached.length > 0 && (
              <Hint>
                {plural(attached.length, "environment file")} ready: {attached.map((a) => a.environment.name).join(", ")}. Now add
                the collection.
              </Hint>
            )}
            <FieldError>{error}</FieldError>
          </ModalBody>
          <ModalFooter hint="The file is read on this machine. Postman isn't contacted.">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
