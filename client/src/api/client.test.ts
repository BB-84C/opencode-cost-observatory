import assert from "node:assert/strict"
import test from "node:test"

import { buildLoginRedirectPath, fetchAppSession, fetchObservedPricingCoverage, fetchOverview } from "./client"

test("successful dashboard responses fail loudly when JSON parsing fails", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async () => new Response("<html>", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch

  await assert.rejects(() => fetchOverview(), /Unexpected token/)
})

test("fetchObservedPricingCoverage reads from separate observed coverage endpoint", async (t) => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify({
      rows: [{
        observedProviderId: "gauge-forge-openai",
        observedModelId: "gpt-5.5",
        canonicalRecordId: "openai:gpt-5.5",
        canonicalVendor: "openai",
        canonicalModel: "gpt-5.5",
        vendorModelId: "gpt-5.5",
        sourceType: "official",
        sourceUrl: "https://developers.openai.com/api/docs/pricing",
        confidence: "high",
        inputPrice: 5,
        outputPrice: 30,
        reasoningPrice: 30,
        cacheReadPrice: 0.5,
        cacheWritePrice: 0,
        messageCount: 1,
        totalTokens: 3000,
        firstSeen: 1_746_493_200,
        lastSeen: 1_746_493_200,
        resolutionStatus: "priced",
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const response = await fetchObservedPricingCoverage()

  assert.deepEqual(calls, ["/api/pricing/observed-coverage"])
  assert.equal(response.rows[0].observedProviderId, "gauge-forge-openai")
  assert.equal(response.rows[0].canonicalVendor, "openai")
})

test("fetchAppSession reads the app-level passkey session with cookies", async (t) => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; credentials?: RequestCredentials }> = []
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async (input, init) => {
    calls.push({ input: String(input), credentials: init?.credentials })
    return new Response(JSON.stringify({ username: "bb84-admin", expiresAt: 1_800_000_000 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const response = await fetchAppSession()

  assert.deepEqual(calls, [{ input: "/auth/session", credentials: "include" }])
  assert.equal(response.authenticated, true)
  assert.equal(response.username, "bb84-admin")
  assert.equal(response.expiresAt, 1_800_000_000)
})

test("login redirect preserves the current path as next", () => {
  assert.equal(buildLoginRedirectPath("/pricing?window=30d"), "/login.html?next=%2Fpricing%3Fwindow%3D30d")
})
