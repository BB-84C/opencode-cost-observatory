import assert from "node:assert/strict"
import test from "node:test"

import { JsonResponseCache, buildResponseCacheKey } from "./response-cache"

test("response cache builds stable keys from path and sorted query params", () => {
  assert.equal(
    buildResponseCacheKey("overview", "/api/overview/lifetime", { b: "2", a: "1" }),
    "overview:/api/overview/lifetime?a=1&b=2",
  )
})

test("response cache returns hits until TTL expires", () => {
  const cache = new JsonResponseCache(60_000)
  cache.set("key", { ok: true }, 1_000)

  assert.equal(cache.get("key", 1_500)?.body, "{\"ok\":true}")
  assert.equal(cache.get("key", 61_001), null)
})

test("response cache stores serialized length", () => {
  const cache = new JsonResponseCache(60_000)
  const entry = cache.set("key", { value: "abc" }, 1_000)

  assert.equal(entry.contentLength, Buffer.byteLength(entry.body))
})
