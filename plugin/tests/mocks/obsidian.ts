/**
 * Vitest mock for the `obsidian` module.
 *
 * Phase 7 / 07-RESEARCH §"Pitfalls" Pitfall 5. The `obsidian` npm package
 * is a types-only shim — no runtime entry. Vitest fails to resolve it. We
 * alias `obsidian` → this file in `plugin/vitest.config.ts` so pure-code
 * unit tests (codec, canonicalize, zod-form mapper) can import the types
 * they need without dragging in the live Obsidian runtime.
 *
 * View-level tests run against the real Obsidian instance (manual smoke
 * test via the screencast in v2.0.0; Playwright deferred to v2.1).
 *
 * Surface: only the classes / enums / constructors the plugin source
 * actually imports. Extend additively as new modules are added.
 */

/**
 * Minimal Obsidian-flavoured HTMLElement stub.
 *
 * Real Obsidian (and the runtime extensions it patches onto HTMLElement)
 * adds `empty`, `createEl`, `createDiv`, `setText`, etc. We don't load the
 * real Obsidian runtime in vitest, so settings-tab / chrome panel tests
 * need a node-pure substitute that responds to those methods. This stub
 * implements just enough for plugin chrome to render: children list,
 * attributes map, text node, classList, and the Obsidian helpers.
 *
 * Used by the settings-tab + secrets-panel test suites (07-08). Editor
 * view code lives elsewhere and exercises the real Obsidian runtime.
 */
export class FakeEl {
  tagName: string;
  parentEl: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  classes: Set<string> = new Set();
  textContent: string = "";
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  // Test-only: pretend to be an HTMLElement so production code's type
  // annotations compile when this stub is passed in.
  constructor(tagName: string = "div") {
    this.tagName = tagName.toUpperCase();
  }
  // ---- Obsidian extensions ----
  empty(): void {
    this.children = [];
    this.textContent = "";
  }
  createEl(
    tag: string,
    options?: { text?: string; cls?: string; attr?: Record<string, string> },
  ): FakeEl {
    const el = new FakeEl(tag);
    if (options?.text !== undefined) el.textContent = options.text;
    if (options?.cls) options.cls.split(" ").forEach((c) => el.classes.add(c));
    if (options?.attr) Object.assign(el.attrs, options.attr);
    el.parentEl = this;
    this.children.push(el);
    return el;
  }
  createDiv(options?: { cls?: string; attr?: Record<string, string> }): FakeEl {
    return this.createEl("div", options);
  }
  createSpan(options?: { cls?: string; text?: string }): FakeEl {
    return this.createEl("span", options);
  }
  setText(text: string): this {
    this.textContent = text;
    this.children = [];
    return this;
  }
  setAttribute(name: string, value: string): this {
    this.attrs[name] = value;
    return this;
  }
  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
      ? (this.attrs[name] ?? null)
      : null;
  }
  // ---- DOM-like surface ----
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      contains: (c: string) => this.classes.has(c),
      toggle: (c: string) => {
        if (this.classes.has(c)) this.classes.delete(c);
        else this.classes.add(c);
      },
    };
  }
  appendChild(child: FakeEl): FakeEl {
    child.parentEl = this;
    this.children.push(child);
    return child;
  }
  addEventListener(event: string, handler: (ev: unknown) => void): void {
    (this.listeners[event] ??= []).push(handler);
  }
  click(): void {
    this.listeners["click"]?.forEach((h) => h({ target: this }));
  }
  /** Depth-first walk yielding every descendant including self. */
  *walk(): IterableIterator<FakeEl> {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
  /** Test helper: find first descendant with the given data-testid. */
  findByTestId(id: string): FakeEl | null {
    for (const el of this.walk()) {
      if (el.attrs["data-testid"] === id) return el;
    }
    return null;
  }
  /** Test helper: collect all descendants matching predicate. */
  findAll(predicate: (el: FakeEl) => boolean): FakeEl[] {
    const out: FakeEl[] = [];
    for (const el of this.walk()) {
      if (predicate(el)) out.push(el);
    }
    return out;
  }
  /** Recursive text aggregation (children + own textContent). */
  innerText(): string {
    if (this.children.length === 0) return this.textContent;
    return this.children.map((c) => c.innerText()).join("");
  }
}

/** Create a root FakeEl — used by tests that don't want to go through PluginSettingTab. */
export function makeFakeEl(tag: string = "div"): FakeEl {
  return new FakeEl(tag);
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  // Instance-level storage for loadData/saveData round-trip. The real
  // Obsidian implementation persists this to `.obsidian/plugins/<id>/
  // data.json`. For tests we keep it on the instance so a fresh `Plugin`
  // simulates an Obsidian restart (Phase 7 / PLG-01 settings-store test).
  private __pluginData: unknown = null;
  constructor(app?: unknown, manifest?: unknown) {
    this.app = app;
    this.manifest = manifest;
  }
  registerView(_type: string, _factory: (leaf: WorkspaceLeaf) => View): void {}
  registerExtensions(_exts: readonly string[], _viewType: string): void {}
  addSettingTab(_tab: PluginSettingTab): void {}
  addCommand(_cmd: { id: string; name: string; callback?: () => unknown }): void {}
  async onload(): Promise<void> {}
  async onunload(): Promise<void> {}
  async loadData(): Promise<unknown> {
    return this.__pluginData;
  }
  async saveData(data: unknown): Promise<void> {
    // Deep-clone via JSON to mirror Obsidian's persistence boundary
    // (saveData writes JSON to disk; loadData reads it back, so mutations
    // to the returned object should not leak into stored state).
    this.__pluginData = data === undefined ? null : JSON.parse(JSON.stringify(data));
  }
}

export class View {
  leaf: WorkspaceLeaf;
  contentEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.contentEl = (globalThis as unknown as { document?: Document })
      .document?.createElement("div") ?? ({} as HTMLElement);
  }
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
}

export class TextFileView extends View {
  data: string = "";
  file: { basename: string; path: string } | null = null;
  setViewData(_data: string, _clear: boolean): void {}
  getViewData(): string {
    return this.data;
  }
  clear(): void {}
  requestSave(): void {}
}

// ItemView — Phase 7 / 07-09. ChromeView extends ItemView for the
// side-panel host. Tests only exercise the metadata methods + the
// `composeChromePanels` helper, so the surface here stays minimal.
export class ItemView extends View {
  getIcon(): string {
    return "";
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
  view: View | null = null;
}

export class Vault {
  adapter: {
    write(_path: string, _data: string): Promise<void>;
    read(_path: string): Promise<string>;
  } = {
    async write() {},
    async read() {
      return "";
    },
  };
}

export class App {
  vault: Vault = new Vault();
  workspace: {
    getLeaf(): WorkspaceLeaf;
    getRightLeaf(_split: boolean): WorkspaceLeaf | null;
    revealLeaf(_leaf: WorkspaceLeaf): void;
    getLeavesOfType(_type: string): WorkspaceLeaf[];
    detachLeavesOfType(_type: string): void;
  } = {
    getLeaf: () => new WorkspaceLeaf(),
    getRightLeaf: (_split: boolean) => new WorkspaceLeaf(),
    revealLeaf: (_leaf: WorkspaceLeaf) => {},
    getLeavesOfType: (_type: string) => [],
    detachLeavesOfType: (_type: string) => {},
  };
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: FakeEl;
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = new FakeEl("div");
  }
  display(): void {}
  hide(): void {}
}

/**
 * Setting mock — creates a real DOM element per row so tests can introspect
 * the settings-tab structure via `data-testid` attributes added by the
 * production code. The chainable component callbacks receive a stub that
 * records the wired `onChange` handler so tests can simulate user input.
 */
class TextComponentStub {
  value = "";
  private handler: ((v: string) => void) | null = null;
  setPlaceholder(_p: string): this {
    return this;
  }
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  getValue(): string {
    return this.value;
  }
  onChange(cb: (v: string) => void): this {
    this.handler = cb;
    return this;
  }
  /** Test-only helper — simulate the user typing a new value. */
  __fire(v: string): void {
    this.value = v;
    this.handler?.(v);
  }
}

class ToggleComponentStub {
  value = false;
  private handler: ((v: boolean) => void) | null = null;
  setValue(v: boolean): this {
    this.value = v;
    return this;
  }
  getValue(): boolean {
    return this.value;
  }
  onChange(cb: (v: boolean) => void): this {
    this.handler = cb;
    return this;
  }
  __fire(v: boolean): void {
    this.value = v;
    this.handler?.(v);
  }
}

class DropdownComponentStub {
  value = "";
  options: Record<string, string> = {};
  private handler: ((v: string) => void) | null = null;
  addOption(value: string, display: string): this {
    this.options[value] = display;
    return this;
  }
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  getValue(): string {
    return this.value;
  }
  onChange(cb: (v: string) => void): this {
    this.handler = cb;
    return this;
  }
  __fire(v: string): void {
    this.value = v;
    this.handler?.(v);
  }
}

export class Setting {
  readonly settingEl: FakeEl;
  constructor(containerEl: FakeEl) {
    this.settingEl = new FakeEl("div");
    this.settingEl.classList.add("setting-item");
    containerEl.appendChild(this.settingEl);
  }
  setName(n: string): this {
    this.settingEl.setAttribute("data-setting-name", n);
    return this;
  }
  setDesc(d: string): this {
    this.settingEl.setAttribute("data-setting-desc", d);
    return this;
  }
  addText(cb: (t: TextComponentStub) => void): this {
    cb(new TextComponentStub());
    return this;
  }
  addToggle(cb: (t: ToggleComponentStub) => void): this {
    cb(new ToggleComponentStub());
    return this;
  }
  addDropdown(cb: (d: DropdownComponentStub) => void): this {
    cb(new DropdownComponentStub());
    return this;
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement;
  constructor(app: App) {
    this.app = app;
    this.contentEl = (globalThis as unknown as { document?: Document })
      .document?.createElement("div") ?? ({} as HTMLElement);
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
  setMessage(_m: string): this {
    return this;
  }
  hide(): void {}
}

export function setIcon(_el: HTMLElement, _name: string): void {}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMacOS: true,
  isWin: false,
  isLinux: false,
} as const;
