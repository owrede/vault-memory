// plugin/esbuild.config.mjs
// Source pattern: github.com/obsidianmd/obsidian-sample-plugin/esbuild.config.mjs
// Bundles `main.ts` (and Svelte components) into a single CommonJS `main.js`
// loadable by Obsidian's plugin loader. External: `obsidian`, `electron`,
// Node builtins (the Electron host already provides these).
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import builtins from "builtin-modules";
import { readFileSync } from "node:fs";

const prod = process.argv.includes("production");

// Convert `import "...style.css"` statements into JS that injects the
// CSS into a <style> tag at runtime. Without this, esbuild bundles CSS
// imports into a separate main.css file that Obsidian never loads —
// breaking xyflow's core layout (svelte-flow__container etc).
const cssInjectPlugin = {
  name: "css-inject",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, (args) => {
      const css = readFileSync(args.path, "utf8");
      const id = "vm-injected-" + args.path.replace(/[^a-z0-9]/gi, "_").slice(-50);
      return {
        contents: `
          (function(){
            if (typeof document === "undefined") return;
            if (document.getElementById(${JSON.stringify(id)})) return;
            var s = document.createElement("style");
            s.id = ${JSON.stringify(id)};
            s.textContent = ${JSON.stringify(css)};
            document.head.appendChild(s);
          })();
        `,
        loader: "js",
      };
    });
  },
};

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
    cssInjectPlugin,
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
