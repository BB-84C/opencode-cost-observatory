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
    DASHBOARD_TOKEN: "dashboard-token",
    BB84_VPS_MODE: "ingest",
    INGEST_TOKEN: "ingest-token",
  }, emptyConfigFiles())

  assert.equal(config.bb84VpsMode, "ingest")
  assert.equal(config.ingestToken, "ingest-token")
})
