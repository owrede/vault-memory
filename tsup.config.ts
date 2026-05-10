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
  // Native bindings / large optional runtimes — keep external so the
  // bundler doesn't try to inline .node binaries or 570 MB of model glue.
  external: [
    "better-sqlite3",
    "sqlite-vec",
    "onnxruntime-node",
    "@huggingface/tokenizers",
  ],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
