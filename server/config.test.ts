import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { loadConfig } from "./config"

function emptyConfigFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-config-"))
  return {
    dashboardConfigPath: path.join(root, "dashboard.config.json"),
    envFilePath: path.join(root, ".env"),
  }
}

test("loadConfig defaults BB84_VPS_MODE to local", () => {
  const config = loadConfig({ DASHBOARD_TOKEN: "dashboard-token" }, emptyConfigFiles())

  assert.equal(config.bb84VpsMode, "local")
  assert.equal(config.ingestToken, undefined)
})

test("loadConfig requires INGEST_TOKEN when BB84_VPS_MODE is ingest", () => {
  assert.throws(() => loadConfig({ DASHBOARD_TOKEN: "dashboard-token", BB84_VPS_MODE: "ingest" }, emptyConfigFiles()), /INGEST_TOKEN/)
})

test("loadConfig accepts ingest mode when INGEST_TOKEN is present", () => {
  const config = loadConfig({
    BB84_VPS_MODE: "ingest",
    INGEST_TOKEN: "ingest-token",
    BOOTSTRAP_TOKEN: "a".repeat(64),
    AUTH_ENCRYPTION_KEY: "x".repeat(32),
  }, emptyConfigFiles())

  assert.equal(config.bb84VpsMode, "ingest")
  assert.equal(config.ingestToken, "ingest-token")
  assert.equal(config.dashboardToken, undefined)
  assert.equal(config.bootstrapToken, "a".repeat(64))
  assert.equal(config.webAuthnRpId, "tokenobs.bb84.ai")
  assert.equal(config.webAuthnRpName, "BB84 OpenCode Observatory")
  assert.equal(config.webAuthnOrigin, "https://tokenobs.bb84.ai")
  assert.equal(config.authSessionTtlSeconds, 604_800)
  assert.equal(config.adminName, "admin")
  assert.equal(config.authEncryptionKey, "x".repeat(32))
  assert.equal(config.authDbPath.endsWith(path.join(".run", "auth.db")), true)
})

test("loadConfig requires DASHBOARD_TOKEN only in local mode", () => {
  assert.throws(() => loadConfig({}, emptyConfigFiles()), /DASHBOARD_TOKEN/)
})

test("loadConfig requires bootstrap and encryption config in ingest mode", () => {
  assert.throws(() => loadConfig({
    BB84_VPS_MODE: "ingest",
    INGEST_TOKEN: "ingest-token",
    AUTH_ENCRYPTION_KEY: "x".repeat(32),
  }, emptyConfigFiles()), /BOOTSTRAP_TOKEN/)

  assert.throws(() => loadConfig({
    BB84_VPS_MODE: "ingest",
    INGEST_TOKEN: "ingest-token",
    BOOTSTRAP_TOKEN: "a".repeat(64),
  }, emptyConfigFiles()), /AUTH_ENCRYPTION_KEY/)
})
