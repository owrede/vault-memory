// plugin/esbuild.config.mjs
// Source pattern: github.com/obsidianmd/obsidian-sample-plugin/esbuild.config.mjs
// Bundles `main.ts` (and Svelte components) into a single CommonJS `main.js`
// loadable by Obsidian's plugin loader. External: `obsidian`, `electron`,
// Node builtins (the Electron host already provides these).
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import builtins from "builtin-modules";

const prod = process.argv.includes("production");

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  outfile: "main.js",
  treeShaking: true,
  conditions: ["svelte", "browser"],
  mainFields: ["svelte", "browser", "module", "main"],
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      compilerOptions: { css: "injected" },
    }),
  ],
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
  process.exit(0);
} else {
  await ctx.watch();
}
