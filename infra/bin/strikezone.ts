#!/usr/bin/env node
// CDK app entry, run by `npx cdk` through cdk.json ("npx tsx bin/strikezone.ts").
import { resolve } from 'node:path';
import { buildApp } from '../lib/app';

// ADR-HI-6: account and region come only from the CDK CLI's resolution of the operator's
// credentials and profile. There is deliberately no fallback region.
const { app } = buildApp({
  siteDir: resolve(__dirname, '../../game/dist'),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

app.synth();
