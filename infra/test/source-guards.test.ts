import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Source-level guards for controls a synthesized template cannot show. */
const INFRA_DIR = join(__dirname, '..');
const ROOT_DIR = join(INFRA_DIR, '..');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function scriptsOf(packageJsonPath: string): Record<string, string> {
  const parsed = JSON.parse(readText(packageJsonPath)) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

const PACKAGE_FILES = [join(INFRA_DIR, 'package.json'), join(ROOT_DIR, 'package.json')];

describe('bootstrap roles only (SEC-HI-09)', () => {
  it.each(['cdk.json', 'bin/strikezone.ts', 'lib/app.ts', 'lib/hosting-stack.ts'])(
    '%s sets no synthesizer or bootstrap qualifier override',
    (file) => {
      const source = readText(join(INFRA_DIR, file));
      expect(source).not.toMatch(/synthesizer/i);
      expect(source).not.toContain('bootstrapQualifier');
    },
  );
});

describe('destroy safety (SEC-HI-13)', () => {
  it.each(PACKAGE_FILES)('%s keeps the destroy confirmation prompt', (path) => {
    for (const [name, command] of Object.entries(scriptsOf(path))) {
      const destroys = /\bdestroy\b/.test(command);
      expect(destroys && /--force|\s-f\b/.test(command), `${name}: ${command}`).toBe(false);
    }
  });

  it.each(PACKAGE_FILES)('%s never destroys from an automated script', (path) => {
    const automated = ['verify', 'test', 'smoke', 'preflight', 'stack-status', 'deploy', 'synth'];
    const scripts = scriptsOf(path);
    for (const name of automated.filter((n) => n in scripts)) {
      expect(scripts[name], name).not.toMatch(/\bdestroy\b/);
    }
  });

  it('exposes destroy as cdk destroy --all from both packages', () => {
    expect(scriptsOf(join(INFRA_DIR, 'package.json')).destroy).toBe('cdk destroy --all');
    expect(scriptsOf(join(ROOT_DIR, 'package.json')).destroy).toBe(
      'npm --prefix infra exec -- cdk destroy --all',
    );
  });

  it('deploys every stack with npx-run CDK and records outputs (req-cdk-deploy-all)', () => {
    const deploy = scriptsOf(join(INFRA_DIR, 'package.json')).deploy!;
    expect(deploy).toMatch(/^npm run preflight && cdk deploy --all /);
    expect(deploy).toContain('--outputs-file cdk-outputs.json');
    expect(deploy).toContain('npm run smoke');
  });
});

describe('operator scripts are read-only (logical components table)', () => {
  const ALLOWED_SDK_IMPORTS: Readonly<Record<string, readonly string[]>> = {
    '@aws-sdk/client-sts': ['STSClient', 'GetCallerIdentityCommand'],
    '@aws-sdk/client-ssm': ['SSMClient', 'GetParameterCommand'],
    '@aws-sdk/client-cloudformation': ['CloudFormationClient', 'DescribeStacksCommand'],
  };
  const scriptFiles = readdirSync(join(INFRA_DIR, 'scripts')).filter((f) => f.endsWith('.ts'));

  it.each(scriptFiles)('%s imports only read operations from allowed SDK clients', (file) => {
    const source = readText(join(INFRA_DIR, 'scripts', file));
    for (const match of source.matchAll(
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'(@aws-sdk\/[^']+)'/g,
    )) {
      const [, names, module] = match;
      const allowed = ALLOWED_SDK_IMPORTS[module!];
      expect(allowed, `${file} imports ${module}`).toBeDefined();
      for (const name of names!
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)) {
        expect(allowed, `${file} imports ${name} from ${module}`).toContain(name);
      }
    }
    expect(source).not.toMatch(
      /from\s*'@aws-sdk\/(?!client-sts'|client-ssm'|client-cloudformation')/,
    );
    expect(source, `${file} must not log the environment`).not.toMatch(
      /console\.\w+\(\s*process\.env/,
    );
  });
});
