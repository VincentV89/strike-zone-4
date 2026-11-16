// Types for eslint.zones.mjs, used by test/lint/zones.test.ts.
export interface ImportPattern {
  readonly regex: string;
  readonly message: string;
  readonly samples: ReadonlyArray<string>;
}

export interface Zone {
  readonly name: string;
  readonly files: string[];
  readonly ignores?: string[];
  readonly forbiddenImportPatterns: ReadonlyArray<ImportPattern>;
  readonly allowed: ReadonlyArray<string>;
  readonly forbiddenGlobals: ReadonlyArray<{ readonly name: string; readonly message: string }>;
  readonly forbiddenProperties: ReadonlyArray<{
    readonly object?: string;
    readonly property: string;
    readonly message: string;
  }>;
  readonly forbiddenSyntax: ReadonlyArray<{ readonly selector: string; readonly message: string }>;
}

export declare const SHARED_IMPORTS: ReadonlyArray<ImportPattern>;
export declare const SHARED_SYNTAX: ReadonlyArray<{
  readonly selector: string;
  readonly message: string;
}>;
export declare const ZONES: ReadonlyArray<Zone>;
export declare const SRC_BASE: unknown;
export declare function zoneConfig(zone: Zone): unknown;

export interface ZoneOverride {
  readonly name: string;
  readonly files: string[];
  readonly zone: Zone;
}

export declare const APP_OVERRIDES: ReadonlyArray<ZoneOverride>;
export declare function overrideConfig(override: ZoneOverride): unknown;

export declare const E2E_IMPORT_PATTERN: ImportPattern;
export declare const E2E_OVERRIDE: unknown;
export declare const E2E_SPEC_OVERRIDE: unknown;
export declare const PLAYWRIGHT_DEFAULT_EXPORT_OVERRIDE: unknown;
