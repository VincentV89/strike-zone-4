/**
 * Security header values for the CloudFront ResponseHeadersPolicy (SEC-HI-06, SEC-HI-07).
 *
 * ADR-HI-7: these constants are the single source for the CDK construct, the template
 * assertion test and the live smoke check, so the three cannot drift apart. A game Bolt that
 * needs a new source edits one entry in CSP_DIRECTIVES and states why in its code summary.
 * Adding 'unsafe-eval' or any external host needs a new security review.
 */
import { Duration } from 'aws-cdk-lib';
import {
  HeadersFrameOption,
  HeadersReferrerPolicy,
  ResponseHeadersPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import type { Construct } from 'constructs';

export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  // Rapier compat compiles inlined WASM bytes, which needs 'wasm-unsafe-eval'.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Procedural textures and Web Audio buffers use data: and blob: URLs.
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  // Also enforces req-procedural-assets AC1: no request leaves the CloudFront origin.
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

export const CSP = CSP_DIRECTIVES.join('; ');
export const HSTS_MAX_AGE_SECONDS = 31_536_000;

/** Header values exactly as a browser receives them; used by the smoke check. */
export const EXPECTED_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': `max-age=${HSTS_MAX_AGE_SECONDS}`,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': CSP,
};

export function createSecurityHeadersPolicy(scope: Construct): ResponseHeadersPolicy {
  // No responseHeadersPolicyName: names are unique per account, so CDK generates one.
  return new ResponseHeadersPolicy(scope, 'SecurityHeaders', {
    comment: 'StrikeZone security headers (SEC-HI-06, SEC-HI-07)',
    securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy: CSP, override: true },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
      referrerPolicy: {
        referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
      strictTransportSecurity: {
        accessControlMaxAge: Duration.seconds(HSTS_MAX_AGE_SECONDS),
        includeSubdomains: false,
        preload: false,
        override: true,
      },
    },
  });
}
