import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    // Never reuse a server that might hold the real key: tests mock /api/suggest
    // in the browser, and anything unmocked hits OpenRouter with an invalid key.
    reuseExistingServer: false,
    env: { OPENROUTER_API_KEY: "e2e-invalid-key" },
  },
});
