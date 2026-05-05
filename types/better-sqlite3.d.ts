declare module "better-sqlite3" {
  export type BetterSqlite3Params = unknown[] | Record<string, unknown>

  export interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  export interface Statement<BindParameters extends BetterSqlite3Params = unknown[], Result = unknown> {
    run(...params: BindParameters extends unknown[] ? BindParameters : [BindParameters]): RunResult
    get(...params: BindParameters extends unknown[] ? BindParameters : [BindParameters]): Result | undefined
    all(...params: BindParameters extends unknown[] ? BindParameters : [BindParameters]): Result[]
    values(...params: BindParameters extends unknown[] ? BindParameters : [BindParameters]): unknown[][]
  }

  export default class Database {
    constructor(filename: string, options?: Record<string, unknown>)
    pragma(source: string, options?: Record<string, unknown>): unknown
    prepare<BindParameters extends BetterSqlite3Params = unknown[], Result = unknown>(source: string): Statement<BindParameters, Result>
    exec(source: string): this
    close(): void
  }
}
