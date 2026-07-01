/**
 * Single source of truth for the vault-memory version (Issue #14 / P2).
 *
 * The version lives in `package.json` and nowhere else. `server.ts` previously
 * hardcoded `const VERSION = "1.0.0"` which drifted years behind the published
 * package — the MCP server advertised the wrong version and sink provisioning
 * stamped stale sentinels.
 *
 * tsup inlines this JSON import at build time (resolveJsonModule is on), so the
 * bundled `dist/cli.js` carries the literal string with no runtime file read.
 */
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
