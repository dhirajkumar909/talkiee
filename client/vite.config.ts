import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Allow access through tunnels (Cloudflare/ngrok) whose subdomains rotate,
    // so you can expose the dev server over HTTPS (needed for mic access).
    allowedHosts: [
      ".trycloudflare.com",
      ".ngrok-free.app",
      ".ngrok.io",
      "localhost",
      ".localto.net",
      ".pinggy-free.link",
    ],
  },
});
