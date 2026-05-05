import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { observatoryBackendControlPlugin } from "./server/vite-backend-control"

const projectRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  root: "client",
  plugins: [observatoryBackendControlPlugin(projectRoot), react()],
  server: {
    host: "127.0.0.1",
    port: 41778,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:41777",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/auth": {
        target: "http://127.0.0.1:41777",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
})
