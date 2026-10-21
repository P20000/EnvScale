import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    watch: {
      usePolling: true,
      interval: 500,
      ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    },
    proxy: {
      "/api/v1/stream": {
        target: "http://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
})