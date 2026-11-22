import { default as BetterSqlite3 } from 'better-sqlite3';

/**
 * better-sqlite3 connection types used by the Library Service and its migrations.
 */
export interface RunResult {
  changes: number;
}

export interface Statement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): RunResult;
}

export interface DatabaseConnection {
  backup(filename: string, options?: {
    progress?: (progress: { remainingPages: number; totalPages: number }) => number | void;
  }): Promise<{ remainingPages: number; totalPages: number }>;
  close(): void;
  exec(sql: string): void;
  function?(name: string, options: { deterministic: boolean }, callback: (value: string) => string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): Statement;
  transaction<T>(operation: () => T): DatabaseTransaction<T>;
}

export interface DatabaseTransaction<T> {
  (): T;
  immediate(): T;
}

export interface DatabaseConstructor {
  new (filename: string, options?: {
    readonly?: boolean;
    fileMustExist?: boolean;
    /** better-sqlite3 statement trace; used only by the test trace seam. */
    verbose?: (sql: string) => void;
  }): DatabaseConnection;
}

export const Database = BetterSqlite3 as DatabaseConstructor;
