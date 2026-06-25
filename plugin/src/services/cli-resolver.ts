/**
 * CLI resolution fallback — self-healing PATH probe for the vault-memory binary.
 *
 * Problem (ISSUE-install-vault-memory-skill-improvements §23, two layers):
 *
 *   Layer 1 — Obsidian launched from Finder/Dock has a minimal GUI PATH
 *   (`/usr/bin:/bin:/usr/sbin:/sbin`). A bare `serverCommand: "vault-memory"`
 *   spawned via child_process inherits that PATH and resolves to ENOENT —
 *   nvm/volta/asdf/homebrew bin dirs are absent.
 *
 *   Layer 2 — Even an ABSOLUTE path to the binary fails, because the binary is
 *   a Node script with `#!/usr/bin/env node`. The kernel runs `env node <script>`,
 *   `env` searches the (stripped) PATH for `node`, doesn't find it → ENOENT again.
 *
 * Fix: on ENOENT, probe common dev-machine locations for BOTH the `vault-memory`
 * script AND a `node` binary, then spawn `node <script>` directly (dodging the
 * shebang lookup entirely). This makes the plugin self-healing on the most common
 * machine topologies without requiring the user to hand-edit `serverCommand`.
 *
 * Pure-ish module: filesystem probing is injected so it is unit-testable without
 * touching the real disk.
 */

import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Result of a successful probe: how to spawn the server. */
export interface ResolvedCli {
  command: string;
  args: string[];
  /** Human-readable note on how it was resolved (for the success toast/log). */
  via: string;
}

/** Injectable probes so tests don't hit the real filesystem. */
export interface ResolverDeps {
  /** Returns true if a path exists and is usable. */
  exists: (path: string) => boolean;
  /** User home directory. */
  home: string;
  /** Glob-ish expansion for nvm's versioned dirs: given a glob with a single
   *  `*`, return matching absolute paths (highest version last is fine — we
   *  pick the last). Tests stub this; production lists the nvm node dir. */
  listVersions: (globParent: string) => string[];
}

/**
 * Candidate locations for a just-installed bin, in priority order. Covers
 * homebrew (Apple Silicon + Intel), npm-global default, user-local, volta,
 * and asdf shims. nvm is handled separately (versioned dirs) by the caller.
 */
function staticBinDirs(home: string): string[] {
  return [
    "/opt/homebrew/bin", // Apple Silicon homebrew
    "/usr/local/bin", // Intel homebrew + npm default prefix
    join(home, ".local/bin"),
    join(home, ".volta/bin"),
    join(home, ".asdf/shims"),
  ];
}

/**
 * Probe for an executable named `bin` across the common locations, including
 * nvm's versioned node dirs (`~/.nvm/versions/node/*​/bin`).
 */
function probeBin(bin: string, deps: ResolverDeps): string | null {
  for (const dir of staticBinDirs(deps.home)) {
    const p = join(dir, bin);
    if (deps.exists(p)) return p;
  }
  // nvm: ~/.nvm/versions/node/<version>/bin/<bin>. Pick the last (highest) match.
  const nvmRoot = join(deps.home, ".nvm/versions/node");
  const versions = deps.listVersions(nvmRoot);
  for (let i = versions.length - 1; i >= 0; i--) {
    const p = join(versions[i]!, "bin", bin);
    if (deps.exists(p)) return p;
  }
  return null;
}

/**
 * Attempt to resolve a runnable vault-memory invocation after a bare-command
 * spawn failed with ENOENT. Returns null when nothing usable is found (the
 * caller then surfaces the diagnostic banner listing what was tried).
 *
 * Strategy:
 *   1. Find the `vault-memory` script (or executable) on common dev paths.
 *   2. Find a `node` binary on the same paths.
 *   3. Prefer `node <script>` (sidesteps the shebang layer-2 ENOENT). If a
 *      node is found but the binary is itself directly executable (e.g. a
 *      homebrew-compiled shim), fall back to running the binary directly.
 *
 * @param serverArgs the original args (e.g. ["serve"]) to append after the script.
 */
export function resolveCli(serverArgs: string[], deps: ResolverDeps): ResolvedCli | null {
  const binPath = probeBin("vault-memory", deps);
  if (!binPath) return null;
  const nodePath = probeBin("node", deps);
  if (nodePath) {
    // node <script> serve — dodges the shebang lookup (layer 2).
    return {
      command: nodePath,
      args: [binPath, ...serverArgs],
      via: `node + script (${nodePath} ${binPath})`,
    };
  }
  // No node found, but the binary path exists — try it directly. Works when
  // the binary is a real executable rather than a shebang script.
  return { command: binPath, args: serverArgs, via: `absolute binary (${binPath})` };
}

/** The list of paths probeBin would check — for diagnostic banners. */
export function probedPaths(home: string): string[] {
  return [
    ...staticBinDirs(home).map((d) => join(d, "vault-memory")),
    join(home, ".nvm/versions/node/*/bin/vault-memory"),
  ];
}

/** Production deps using the real filesystem. */
export function realResolverDeps(): ResolverDeps {
  return {
    exists: (p) => existsSync(p),
    home: homedir(),
    listVersions: (globParent) => {
      // List immediate child dirs of the nvm node root. Best-effort: if the
      // dir doesn't exist, return [].
      try {
        return readdirSync(globParent)
          .sort()
          .map((name) => join(globParent, name));
      } catch {
        return [];
      }
    },
  };
}
