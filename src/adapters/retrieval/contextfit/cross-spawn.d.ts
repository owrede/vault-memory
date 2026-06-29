/**
 * Minimal type declaration for `cross-spawn` (no @types package needed).
 * cross-spawn's default export has the same signature as
 * `child_process.spawn` — a drop-in that fixes cross-platform + fd edge
 * cases (see cli.ts for why we use it instead of node:child_process).
 */
declare module "cross-spawn" {
  import type { ChildProcess, SpawnOptions } from "node:child_process";
  const spawn: (command: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;
  export default spawn;
}
