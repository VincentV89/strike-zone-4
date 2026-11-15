import { describe, expect, it } from 'vitest';
import { runStackStatus, type StackStatusDeps } from '../scripts/stack-status';

async function run(status: Promise<string | undefined>, region: string | undefined) {
  const lines: string[] = [];
  const requested: string[] = [];
  const deps: StackStatusDeps = {
    resolveRegion: () => Promise.resolve(region),
    describeStackStatus: (_region, stackName) => {
      requested.push(stackName);
      return status;
    },
  };
  const code = await runStackStatus(deps, (line) => lines.push(line));
  return { code, output: lines.join('\n'), requested };
}

describe('stack-status (NFR-HI-R1)', () => {
  it.each(['CREATE_COMPLETE', 'UPDATE_COMPLETE'])('passes on %s', async (status) => {
    const { code, output, requested } = await run(Promise.resolve(status), 'eu-west-1');
    expect(code).toBe(0);
    expect(output).toContain(`PASS StrikeZoneHosting ${status}`);
    expect(requested).toEqual(['StrikeZoneHosting']);
  });

  it.each(['UPDATE_ROLLBACK_COMPLETE', 'ROLLBACK_COMPLETE', 'UPDATE_IN_PROGRESS'])(
    'fails on %s',
    async (status) => {
      const { code, output } = await run(Promise.resolve(status), 'eu-west-1');
      expect(code).toBe(1);
      expect(output).toContain(`FAIL StrikeZoneHosting ${status}`);
    },
  );

  it('fails when the stack does not exist', async () => {
    const missing = new Error('Stack with id StrikeZoneHosting does not exist');
    missing.name = 'ValidationError';
    const { code, output } = await run(Promise.reject(missing), 'eu-west-1');
    expect(code).toBe(1);
    expect(output).toBe(
      'stack-status: ValidationError: Stack with id StrikeZoneHosting does not exist',
    );
  });

  it('fails without calling AWS when no region resolves', async () => {
    const { code, requested } = await run(Promise.resolve('CREATE_COMPLETE'), undefined);
    expect(code).toBe(1);
    expect(requested).toEqual([]);
  });
});
