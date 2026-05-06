import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { normalizePricingModelKey, rowMatchesPricingModelKey } from "./pricing-identity"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

test("package test script discovers TypeScript test files by default", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }

  assert.equal(packageJson.scripts?.test, "node --import tsx --test \"server/**/*.test.ts\" \"client/**/*.test.ts\"")
})

test("normalizePricingModelKey normalizes model names without provider input", () => {
  assert.equal(normalizePricingModelKey("gpt-5.4"), "gpt-5.4")
  assert.equal(normalizePricingModelKey(" GPT-5.4 "), "gpt-5.4")
  assert.equal(normalizePricingModelKey("claude-opus-4-7"), "claude-opus-4-7")
})

test("normalizePricingModelKey applies the k2p6 alias", () => {
  assert.equal(normalizePricingModelKey("k2p6"), "kimi-2.6")
  assert.equal(normalizePricingModelKey(" K2P6 "), "kimi-2.6")
})

test("rowMatchesPricingModelKey normalizes lookup keys before matching", () => {
  const row = {
    canonical_model: "kimi-2.6",
    vendor_model_id: "k2p6",
  }

  assert.equal(rowMatchesPricingModelKey(" K2P6 ", row), true)
  assert.equal(rowMatchesPricingModelKey("kimi-2.6", row), true)
  assert.equal(rowMatchesPricingModelKey("gpt-5.4", row), false)
})
