import type { HttpMethod } from "@/types";
import { COLLECTION_FILE, COLLECTIONS_DIR, ENVIRONMENTS_DIR, FOLDER_FILE, REQUEST_SUFFIX, ROOT_FILE, type FileLabel } from "@/folderFormat";
import type { GitChange } from "./status";

export type ChangeGroup = "requests" | "structure" | "environments" | "workspace" | "other";

export const GROUP_LABEL: Record<ChangeGroup, string> = {
  requests: "Requests",
  structure: "Collections & folders",
  environments: "Environments",
  workspace: "Workspace",
  other: "Other files",
};

export interface DescribedChange extends GitChange {
  group: ChangeGroup;
  /** "Shop API › Auth › Login" */
  title: string;
  method?: HttpMethod;
  /** the entity's id, when it still exists in the workspace (to open it) */
  entityId?: string;
}

/** "list-products-2" → "list products 2": a readable name for a file that's no longer in the workspace. */
function humanize(slug: string): string {
  return slug.replace(/-/g, " ");
}

function fromPath(path: string): Pick<DescribedChange, "group" | "title"> {
  if (path === ROOT_FILE) return { group: "workspace", title: "Workspace settings" };
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (parts[0] === ENVIRONMENTS_DIR && parts.length === 2) return { group: "environments", title: humanize(name.replace(/\.json$/, "")) };
  if (parts[0] === COLLECTIONS_DIR && parts.length > 2) {
    const dirs = parts.slice(1, -1).map(humanize);
    if (name.endsWith(REQUEST_SUFFIX)) return { group: "requests", title: [...dirs, humanize(name.slice(0, -REQUEST_SUFFIX.length))].join(" › ") };
    if (name === COLLECTION_FILE || name === FOLDER_FILE) return { group: "structure", title: dirs.join(" › ") };
  }
  return { group: "other", title: path };
}

function fromLabel(label: FileLabel): Pick<DescribedChange, "group" | "title" | "method" | "entityId"> {
  const title = label.trail.join(" › ");
  switch (label.kind) {
    case "request":
      return { group: "requests", title, method: label.method, entityId: label.id };
    case "folder":
    case "collection":
      return { group: "structure", title, entityId: label.id };
    case "environment":
      return { group: "environments", title, entityId: label.id };
    case "workspace":
      return { group: "workspace", title };
  }
}

/** Each change in the app's terms, grouped and ordered for a changes list. */
export function describeChanges(changes: readonly GitChange[], labels: ReadonlyMap<string, FileLabel>): DescribedChange[] {
  const order: ChangeGroup[] = ["requests", "structure", "environments", "workspace", "other"];
  return changes
    .map((c) => {
      const label = labels.get(c.path);
      return { ...c, ...(label ? fromLabel(label) : fromPath(c.path)) };
    })
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.title.localeCompare(b.title));
}
