import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // Keep chrome types available if a module pulls them in transitively.
    passWithNoTests: false,
  },
});
