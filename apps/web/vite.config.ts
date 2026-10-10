import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:8090",
      "/admin": "http://localhost:8090",
      "/health": "http://localhost:8090",
      "/metrics": "http://localhost:8090",
      "/simulate": "http://localhost:8090",
      "/mailpit": "http://localhost:8090"
    }
  }
});
