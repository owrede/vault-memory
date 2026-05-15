import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface ScanOptions {
  excludeGlobs?: string[];
}

const DEFAULT_EXCLUDES = [".obsidian/**", ".trash/**", "node_modules/**"];

/**
 * Recursively walk `rootPath` and return absolute paths of all `.md` files.
 * Symlinks are NOT followed (loop-safe).
 *
 * Excludes are matched against the *relative* posix path of each file/dir.
 * A directory is pruned if its relative path matches any exclude glob.
 */
export async function scanVault(rootPath: string, options?: ScanOptions): Promise<string[]> {
  const root = path.resolve(rootPath);
  const excludes = options?.excludeGlobs ?? DEFAULT_EXCLUDES;
  const matchers = excludes.map(compileGlob);

  const results: string[] = [];
  await walk(root, root, matchers, results);
  results.sort();
  return results;
}

async function walk(root: string, dir: string, matchers: RegExp[], out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(root, abs));
    if (rel.length === 0) continue;
    if (isExcluded(rel, matchers)) continue;

    if (entry.isSymbolicLink()) {
      // Skip symlinks entirely to avoid loops.
      continue;
    }
    if (entry.isDirectory()) {
      await walk(root, abs, matchers, out);
    } else if (entry.isFile() && abs.toLowerCase().endsWith(".md")) {
      out.push(abs);
    }
  }
}

function isExcluded(relPath: string, matchers: RegExp[]): boolean {
  for (const re of matchers) {
    if (re.test(relPath)) return true;
  }
  return false;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Compile a minimal glob to a RegExp.
 * Supports:
 *   - `*`   → any chars except `/`
 *   - `**`  → any chars including `/`
 *   - `?`   → single char except `/`
 *   - everything else literal
 *
 * The pattern matches the whole relative path. To also match descendants of
 * a matched directory (Obsidian convention), if the pattern ends with `/**`,
 * we also match the bare directory prefix.
 */
export function compileGlob(glob: string): RegExp {
  // Match descendants too when pattern ends with `/**`.
  const trimmed = glob.replace(/^\.\//, "");
  const altDir = trimmed.endsWith("/**") ? trimmed.slice(0, -3) : null;

  const toRe = (g: string): string => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === undefined) continue;
      if (c === "*") {
        if (g[i + 1] === "*") {
          re += ".*";
          i++;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else if (/[.+^${}()|[\]\\]/.test(c)) {
        re += "\\" + c;
      } else {
        re += c;
      }
    }
    return re;
  };

  const parts = [toRe(trimmed)];
  if (altDir !== null) parts.push(toRe(altDir));
  return new RegExp("^(?:" + parts.join("|") + ")$");
}
