// Types for scripts/check-dist.mjs, used by test/scripts/check-dist.test.ts.
export declare function stripAllowedUrlContext(text: string): string;
export declare function findIndexHtmlProblems(html: string): string[];
export declare function findExternalUrls(text: string): string[];
export declare function checkDist(root: string): string[];
export declare const NOTICE_PATTERN: RegExp;
export declare const NOTICE_ALLOWED_URLS: ReadonlySet<string>;
export declare function needsRapierNotice(root: string): boolean;
export declare const AUDIO_FILE_EXTENSIONS: RegExp;
export declare const BINARY_ASSET_EXTENSIONS: RegExp;
export declare const CODE_ALLOWED_URLS: ReadonlySet<string>;
export declare const WEBGPU_MARKER: RegExp;
export declare const NOTICE_REQUIREMENTS: ReadonlyMap<string, ReadonlyArray<string>>;
export declare function findDynamicCode(text: string): string[];
export declare function needsThreeNotice(root: string): boolean;
export declare function sizeReport(root: string): string[];
