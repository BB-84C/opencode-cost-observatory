import assert from "node:assert/strict"
import test from "node:test"

import { deriveManualPricingIdentity } from "./pricingIdentity"

test("deriveManualPricingIdentity maps Gauge Forge OpenAI gaps to canonical OpenAI pricing", () => {
  const identity = deriveManualPricingIdentity({
    providerId: "gauge-forge-openai",
    modelId: "gpt-5.5",
  })

  assert.deepEqual(identity, {
    id: "price-openai-gpt-5-5-manual",
    canonicalVendor: "openai",
    canonicalModel: "gpt-5.5",
    vendorModelId: "gpt-5.5",
  })
})

test("deriveManualPricingIdentity maps provider-scoped Gauge Forge model IDs to canonical OpenAI pricing", () => {
  const identity = deriveManualPricingIdentity({
    providerId: "gauge-forge-openai",
    modelId: "gauge-forge-openai/gpt-5.3-codex-spark",
  })

  assert.deepEqual(identity, {
    id: "price-openai-gpt-5-3-codex-manual",
    canonicalVendor: "openai",
    canonicalModel: "gpt-5.3-codex",
    vendorModelId: "gpt-5.3-codex",
  })
})

test("deriveManualPricingIdentity keeps unknown providers as the conservative fallback vendor", () => {
  const identity = deriveManualPricingIdentity({
    providerId: "unknown-transport",
    modelId: "custom-model",
  })

  assert.deepEqual(identity, {
    id: "price-unknown-transport-custom-model-manual",
    canonicalVendor: "unknown-transport",
    canonicalModel: "custom-model",
    vendorModelId: "custom-model",
  })
})
