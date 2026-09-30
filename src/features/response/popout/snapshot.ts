import type { HttpResponse } from "@/http/send";
import type { HttpMethod, SatchelRequest } from "@/types";

/** Everything the response window needs, detached from the main window's state. */
export interface ResponseSnapshot {
  requestId: string;
  method: HttpMethod;
  name: string;
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  headers: [string, string][];
  /** exactly as received */
  rawBodyText: string;
  isJson: boolean;
  /** Date.now() when the response arrived */
  receivedAt: number;
}

export function snapshotOf(request: SatchelRequest, response: HttpResponse, receivedAt = Date.now()): ResponseSnapshot {
  return {
    requestId: request.id,
    method: request.method,
    name: request.name,
    status: response.status,
    statusText: response.statusText,
    timeMs: response.timeMs,
    sizeBytes: response.sizeBytes,
    headers: response.headers,
    rawBodyText: response.rawBodyText,
    isJson: response.isJson,
    receivedAt,
  };
}
