# StrikeZone hosting (`infra/`)

One AWS CDK v2 TypeScript app with one stack, `StrikeZoneHosting`. It serves the built game (`game/dist`) from a private S3 bucket through CloudFront with Origin Access Control. There is no backend, no VPC and no always-on compute.

| Resource                                  | Purpose                                                                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3 `SiteBucket`                           | Private (all public access blocked), SSE-S3, TLS-only, bucket-owner-enforced. Deleted with the stack, including its objects.                                                                                                                         |
| CloudFront `Distribution`                 | HTTPS only (HTTP gets a 301), HTTP/2 and HTTP/3, IPv6, managed `CachingOptimized` policy with Brotli/gzip. 403 and 404 return `/index.html` with status 200 so refreshes and deep links load the app.                                                |
| `SecurityHeaders` response headers policy | HSTS (1 year), `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, and the CSP in `lib/security-headers.ts`                                                                                                                       |
| `DeployAssets`, `DeployIndex`             | Two BucketDeployments. Hashed files get `public, max-age=31536000, immutable`; `index.html` gets `no-cache` and is written after the assets, followed by a `/*` invalidation. Neither prunes, so an open tab can still load the files it references. |
| `DeployLogGroup`                          | 7-day log group for the deployment Lambda, deleted with the stack                                                                                                                                                                                    |

Outputs: `SiteUrl`, `DistributionId`, `BucketName`. Tags: `Project=StrikeZone`, `Environment=prod`, `Unit=hosting-infra`, `ManagedBy=cdk`. To see these tags in Cost Explorer, activate them as cost allocation tags in Billing.

## Prerequisites

- Node.js 22 or later. Run `npm ci` in `infra/` once.
- AWS credentials from the default provider chain (environment variables, `AWS_PROFILE`, or the shared config and credentials files). The AWS CLI is not needed and not used.
- A region from `AWS_REGION`, `AWS_DEFAULT_REGION` or the profile. **There is no default region**, so preflight stops with exit 2 when none resolves.
- The target account and region bootstrapped with `cdk bootstrap` (qualifier `hnb659fds`, version 6 or later). Bootstrap creates shared account infrastructure, so it needs the account owner's approval. Preflight reports it as a blocker and never runs it.

The operator identity needs:

- `sts:AssumeRole` on `arn:aws:iam::<account>:role/cdk-hnb659fds-*` (the default bootstrap roles)
- `ssm:GetParameter` on `/cdk-bootstrap/hnb659fds/version`
- `cloudformation:DescribeStacks` on the `StrikeZoneHosting` stack
- `sts:GetCallerIdentity`, which needs no grant

## Commands

Run these from the repository root unless noted otherwise.

| Command                                       | What it does                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                              | Release gate: lint, type-check, Vitest (CDK assertions, script tests, source guards), `cdk synth` (builds the game first), removal of `cdk.out`, and an advisory `npm audit`. Needs no AWS access. |
| `npm --prefix infra run preflight`            | Read-only check of region (exit 2), identity (exit 3) and bootstrap version (exit 4). Prints account, caller ARN, region and bootstrap version.                                                    |
| `npm run deploy`                              | Preflight, then `cdk deploy --all --require-approval never --outputs-file cdk-outputs.json`, then the stack-status check and smoke. `cdk.json` builds the game before synthesis.                   |
| `npm --prefix infra run stack-status`         | Passes only when the stack is `CREATE_COMPLETE` or `UPDATE_COMPLETE`.                                                                                                                              |
| `npm --prefix infra run smoke [-- <SiteUrl>]` | Live HTTP checks against the deployed site, with one PASS, FAIL, FINDING, SKIP or INFO line per check. Exits non-zero on any FAIL.                                                                 |
| `npm run destroy`                             | `cdk destroy --all` with CDK's confirmation prompt. Ask the account owner before running it.                                                                                                       |

`--require-approval never` is used on deploy only, because the agent shell cannot answer the IAM-broadening prompt. The assertion tests pin every IAM statement, the bucket policy and the allowed resource types, so a broadening change fails `verify` before a deploy can run. Destroy keeps its prompt, and no script passes `--force`.

## Cleanup and what remains

`npm run destroy` removes everything the stack created: bucket and objects, distribution, OAC, headers policy, deployment and auto-delete Lambdas, their roles, and `DeployLogGroup`.

These remain afterwards:

- **The CDK bootstrap stack** (`CDKToolkit`) and its asset bucket `cdk-hnb659fds-assets-<account>-<region>`. This is shared account infrastructure, and CDK never deletes the staged asset zips in it.
- **The S3 auto-delete provider's log group.** AWS Lambda creates it implicitly on first invocation, and aws-cdk-lib 2.277.0 has no log-group option for that provider. Find it with the name prefix `/aws/lambda/StrikeZoneHosting-CustomS3AutoDeleteObjects` and delete it with the SDK, for example:

  ```sh
  node -e "const {CloudWatchLogsClient,DescribeLogGroupsCommand,DeleteLogGroupCommand}=require('@aws-sdk/client-cloudwatch-logs');(async()=>{const c=new CloudWatchLogsClient({});const r=await c.send(new DescribeLogGroupsCommand({logGroupNamePrefix:'/aws/lambda/StrikeZoneHosting-CustomS3AutoDeleteObjects'}));for(const g of r.logGroups??[]){await c.send(new DeleteLogGroupCommand({logGroupName:g.logGroupName}));console.log('deleted',g.logGroupName)}})()"
  ```

  This needs `npm i --no-save @aws-sdk/client-cloudwatch-logs` and `logs:DescribeLogGroups` and `logs:DeleteLogGroup` permissions.

## Operations

- **Metrics.** CloudFront's default metrics (Requests, 4xx and 5xx error rate, BytesDownloaded) are free and appear in the CloudFront console and in CloudWatch in `us-east-1`. The stack creates no alarms or dashboards, because nobody is on call and dashboards have a monthly charge.
- **Logging.** CloudFront and S3 access logs are off (ADR-HI-4), so no viewer IP addresses are stored.
- **Cost.** About US$0.10 per month at evaluation traffic, and usually US$0 within the free tier. Every resource is pay-per-use. A US$5 AWS Budgets alert set up by the account owner is recommended.
- **Drift.** Console changes count as drift. Check with CloudFormation `DetectStackDrift` and then `DescribeStackResourceDrifts` (SDK `@aws-sdk/client-cloudformation`). Fix drift by redeploying.
- **Rollback.** A failed update rolls back automatically. If a deploy succeeds but smoke fails, redeploy the last known-good commit (`npm run verify && npm run deploy`).

## Changing the CSP

Edit one entry in `CSP_DIRECTIVES` in `lib/security-headers.ts` and state the reason in the change. The stack, the assertion test and the smoke check all read that constant. Adding `'unsafe-eval'` or any external host needs a new security review.
