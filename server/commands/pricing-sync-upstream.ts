import { syncUpstreamPricing } from "../services/upstream-pricing-sync"

async function main() {
  const pricingDbPath = process.env.PRICING_DB_PATH
  if (!pricingDbPath) throw new Error("PRICING_DB_PATH is required")
  console.log(JSON.stringify(await syncUpstreamPricing(pricingDbPath)))
}

void main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
