// Types for scripts/scan-secrets.mjs (used by Vitest tests and the e2e summariser).
export interface SecretPattern {
  readonly kind: string;
  readonly re: RegExp;
}

export interface SecretHit {
  readonly kind: string;
  readonly line: number;
}

export interface TreeHit extends SecretHit {
  readonly file: string;
}

export declare const STRICT_PATTERNS: ReadonlyArray<SecretPattern>;
export declare const TREE_PATTERNS: ReadonlyArray<SecretPattern>;
export declare const SKIP_DIRS: ReadonlySet<string>;
export declare const MAX_SCAN_BYTES: number;
export declare function findSecrets(
  text: unknown,
  patterns?: ReadonlyArray<SecretPattern>,
): SecretHit[];
export declare function redact(text: unknown, home?: string): string;
export declare function isSkippedFile(relPath: string): boolean;
export declare function scanTree(root: string): TreeHit[];
export declare function main(
  argv: ReadonlyArray<string>,
  log?: { error(msg: string): void; log(msg: string): void },
): number;
