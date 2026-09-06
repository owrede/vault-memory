import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { buildChokidarOptions } from "./chokidar-config.js";

describe("vault watcher resource filtering", () => {
  let root: string;
  let watcher: FSWatcher | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vm-watch-filter-"));
  });
  afterEach(async () => {
    await watcher?.close();
    watcher = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function file(path: string) {
    const parts = path.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, path), "fixture");
  }

  async function start(excludes: string[] = []) {
    watcher = chokidar.watch(root, buildChokidarOptions(root, excludes));
    await new Promise<void>((resolve, reject) => {
      watcher!.once("ready", resolve);
      watcher!.once("error", reject);
    });
    return watcher;
  }

  function watchedPaths() {
    return Object.entries(watcher!.getWatched()).flatMap(([dir, names]) =>
      names.map((name) => relative(root, join(dir, name)).split(sep).join("/")),
    );
  }

  it("does not hold watchers for attachments while preserving directories containing notes", async () => {
    await file("note.md");
    await file("assets/image.png");
    await file("assets/report.pdf");
    await file("assets/script.py");
    await file("folder.png/note.md");
    await start();
    const paths = watchedPaths();
    expect(paths).toContain("note.md");
    expect(paths).toContain("folder.png/note.md");
    expect(paths).not.toContain("assets/image.png");
    expect(paths).not.toContain("assets/report.pdf");
    expect(paths).not.toContain("assets/script.py");
  });

  it("honors exclude globs with Chokidar 4 and ignores hidden and temporary notes", async () => {
    await file("private/secret.md");
    await file("public.draft.md");
    await file("nested/note.skip.md");
    await file("nested/note.tmp.123.md");
    await file(".hidden/note.md");
    await file("nested/visible.md");
    await start(["private/**", "*.draft.md", "nested/*.skip.md"]);
    const paths = watchedPaths();
    expect(paths).toContain("nested/visible.md");
    for (const path of [
      "private",
      "private/secret.md",
      "public.draft.md",
      "nested/note.skip.md",
      "nested/note.tmp.123.md",
      ".hidden/note.md",
    ]) {
      expect(paths).not.toContain(path);
    }
  });

  it("still discovers notes created later in an initially empty directory", async () => {
    await mkdir(join(root, "empty"));
    const live = await start();
    const added: string[] = [];
    live.on("add", (path) => added.push(path));
    await file("empty/new.md");
    await vi.waitFor(() => expect(added).toContain(join(root, "empty/new.md")), { timeout: 2500 });
  });
});
