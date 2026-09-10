import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Tests run inside workerd against the real bindings from wrangler.jsonc, so
// the budget object under test is the same SQLite-backed Durable Object that
// will run in production.
//
// remoteBindings must stay false. Workers AI always runs remotely, so leaving
// this on makes the pool open a remote proxy session before any test runs —
// which needs CLOUDFLARE_API_TOKEN and fails outright in CI with
// "In a non-interactive environment, it's necessary to set a
// CLOUDFLARE_API_TOKEN environment variable". Nothing here calls the model:
// the budget and retrieval tests are pure local logic, so the tests stay
// hermetic and CI needs no credentials until the deploy step.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false
    })
  ]
});
