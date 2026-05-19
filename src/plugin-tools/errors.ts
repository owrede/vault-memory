/**
 * Structured errors for the five plugin-control tools.
 *
 * Phase 7 / Plan 07-04 / Pattern D — analog: `DocNotFoundError`
 * (`src/assembly/outline.ts`). Each class carries a stable `reason` discriminator
 * so the MCP wrapper can convert to `errorResponseJson({reason, ...details})`.
 *
 * # Adapter-seam discipline
 *
 * Pure error classes. Zero runtime imports.
 */

export class RestartRequiredError extends Error {
  readonly reason = "restart_required" as const;
  constructor(readonly key: string) {
    super(`config key '${key}' requires server restart`);
    this.name = "RestartRequiredError";
  }
}

export class UnknownConfigKeyError extends Error {
  readonly reason = "unknown_key" as const;
  constructor(readonly key: string) {
    super(`unknown config key: '${key}'`);
    this.name = "UnknownConfigKeyError";
  }
}

export class SafeStorageUnavailableError extends Error {
  readonly reason = "safe_storage_unavailable" as const;
  constructor(readonly secretName: string) {
    // SECURITY: include only the secret NAME (not value). The name is a
    // user-chosen identifier; the value never appears in any error message
    // or log line.
    super(`secret '${secretName}' could not be decrypted (safeStorage unavailable)`);
    this.name = "SafeStorageUnavailableError";
  }
}

export class SecretDecryptFailedError extends Error {
  readonly reason = "decrypt_failed" as const;
  constructor(readonly secretName: string) {
    super(`secret '${secretName}' decryption failed`);
    this.name = "SecretDecryptFailedError";
  }
}

export class UnknownMcpClientError extends Error {
  readonly reason = "unknown_mcp_client" as const;
  constructor(readonly clientName: string) {
    super(`mcp client '${clientName}' not found`);
    this.name = "UnknownMcpClientError";
  }
}

export class UnknownVaultError extends Error {
  readonly reason = "unknown_vault" as const;
  constructor(readonly vault: string) {
    super(`unknown vault: '${vault}'`);
    this.name = "UnknownVaultError";
  }
}

export class IndexerBusyError extends Error {
  readonly reason = "indexer_busy" as const;
  constructor(readonly vault: string) {
    super(`vault '${vault}' is already indexing`);
    this.name = "IndexerBusyError";
  }
}
