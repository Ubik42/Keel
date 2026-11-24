export class KeelApiError extends Error {
  readonly code: string;
  readonly detail: unknown;
}

export interface KeelTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface KeelClient {
  tools(): Promise<KeelTool[]>;
  /** Only the tool's result. */
  call<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T>;
  /** Keel's full answer, with history and undo ids. */
  callRaw<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<{
    ok: true;
    toolName: string;
    commandId?: string;
    result: T;
    historyEntryId?: string;
    undoGroupId?: string;
    libraryId?: string;
    libraryChangeSequence?: number;
  }>;
  close(): Promise<void>;
}

export function candidateProfiles(env?: Record<string, string | undefined>): string[];
export function connectKeel(options?: { profile?: string; clientName?: string }): Promise<KeelClient>;
