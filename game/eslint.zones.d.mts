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
