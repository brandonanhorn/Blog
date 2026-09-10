import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Tests run inside workerd against the real bindings from wrangler.jsonc, so
// the budget object under test is the same SQLite-backed Durable Object that
// will run in production.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" }
    })
  ]
});
