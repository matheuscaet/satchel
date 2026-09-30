export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "QUERY"
  | "HEAD"
  | "OPTIONS";

export const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "QUERY", "HEAD", "OPTIONS"];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  // Variables only: the value is personal (a token, a password). In a
  // workspace folder it is kept in .satchel/local.json, never in shared files.
  secret?: boolean;
}

// A multipart/form-data field. File fields keep a path on disk (read at send
// time, so edits to the file are picked up) plus the name/size shown in the UI.
// A file field imported from elsewhere may carry a fileName but no filePath —
// the file lives on someone else's machine and has to be picked again.
export interface FormField extends KeyValue {
  type: "text" | "file";
  fileName?: string;
  filePath?: string;
  fileSize?: number;
}

export type AuthConfig =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; key: string; value: string; in: "header" | "query" };

export type RequestBody =
  | { mode: "none" }
  | { mode: "raw"; raw: string; language: "json" | "text" | "xml" | "html" }
  | { mode: "urlencoded"; params: KeyValue[] }
  | { mode: "formdata"; fields: FormField[] };

export interface SatchelRequest {
  id: string;
  name: string;
  method: HttpMethod;
  // The URL is the source of truth for the query string: enabled `params`
  // are always reflected in it (see url.ts). Disabled params live only in
  // `params`.
  url: string;
  params: KeyValue[];
  // Values for `/:name` segments of the URL path, keyed by name.
  pathVariables?: Record<string, string>;
  headers: KeyValue[];
  auth: AuthConfig;
  body: RequestBody;
}

export interface FolderNode {
  type: "folder";
  id: string;
  name: string;
  children: TreeNode[];
}

export interface RequestNode {
  type: "request";
  id: string;
  request: SatchelRequest;
}

export type TreeNode = FolderNode | RequestNode;

export interface Collection {
  id: string;
  name: string;
  variables: KeyValue[];
  items: TreeNode[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
  // CSS color value (usually a var(--…) token) for the environment's dot.
  color?: string;
}

export interface Workspace {
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  globals: KeyValue[];
}
