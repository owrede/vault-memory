import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  // better-sqlite3 has native bindings — keep external
  external: ["better-sqlite3", "sqlite-vec"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
