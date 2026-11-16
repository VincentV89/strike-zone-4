// Types for scripts/check-dist.mjs, used by test/scripts/check-dist.test.ts.
export declare function stripAllowedUrlContext(text: string): string;
export declare function findIndexHtmlProblems(html: string): string[];
export declare function findExternalUrls(text: string): string[];
export declare function checkDist(root: string): string[];
export declare const NOTICE_PATTERN: RegExp;
export declare const NOTICE_ALLOWED_URLS: ReadonlySet<string>;
export declare function needsRapierNotice(root: string): boolean;
