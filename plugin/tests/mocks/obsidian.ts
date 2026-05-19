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

export class Plugin {
  app: unknown;
  manifest: unknown;
  constructor(app?: unknown, manifest?: unknown) {
    this.app = app;
    this.manifest = manifest;
  }
  registerView(_type: string, _factory: (leaf: WorkspaceLeaf) => View): void {}
  registerExtensions(_exts: readonly string[], _viewType: string): void {}
  addSettingTab(_tab: PluginSettingTab): void {}
  async onload(): Promise<void> {}
  async onunload(): Promise<void> {}
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(_data: unknown): Promise<void> {}
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
  workspace: { getLeaf(): WorkspaceLeaf } = {
    getLeaf: () => new WorkspaceLeaf(),
  };
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = (globalThis as unknown as { document?: Document })
      .document?.createElement("div") ?? ({} as HTMLElement);
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_n: string): this {
    return this;
  }
  setDesc(_d: string): this {
    return this;
  }
  addText(_cb: (t: unknown) => void): this {
    return this;
  }
  addToggle(_cb: (t: unknown) => void): this {
    return this;
  }
  addDropdown(_cb: (d: unknown) => void): this {
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
