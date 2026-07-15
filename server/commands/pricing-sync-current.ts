import { syncCurrentEffectivePricingSeed } from "../services/current-effective-pricing-sync"

function main() {
  const pricingDbPath = process.env.PRICING_DB_PATH
  if (!pricingDbPath) {
    throw new Error("PRICING_DB_PATH is required")
  }

  console.log(JSON.stringify(syncCurrentEffectivePricingSeed(pricingDbPath)))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
