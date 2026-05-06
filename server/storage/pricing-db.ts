import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { configure, ensureParentDir, normalizeLegacyPricingRecord } from "./db-internals"
import { pricingBootstrapSql, pricing_record, pricing_source_event } from "./schema.sql"

const pricingSchema = { pricing_record, pricing_source_event }

export function bootstrapPricingDb(file: string) {
  ensureParentDir(file)
  const sqlite = new Database(file)
  try {
    configure(sqlite, "readwrite")
    normalizeLegacyPricingRecord(sqlite)
    sqlite.exec(pricingBootstrapSql)
  } finally {
    sqlite.close()
  }
}

export function openPricingDb(file: string) {
  bootstrapPricingDb(file)
  const sqlite = new Database(file)
  configure(sqlite, "readwrite")
  const db = drizzle(sqlite, { schema: pricingSchema })
  return Object.assign(db, { sqlite })
}

export function openPricingReadonlyDb(file: string) {
  const sqlite = new Database(file, {
    readonly: true,
    fileMustExist: true,
  })
  configure(sqlite, "readonly")
  const db = drizzle(sqlite, { schema: pricingSchema })
  return Object.assign(db, { sqlite })
}
