import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/storage/schema.sql.ts",
  out: "./migrations",
  dbCredentials: {
    url: "./.run/analytics.db",
  },
})
