/**
 * Post-deploy stack status (req-deploy-verification AC2, NFR-HI-R1): StrikeZoneHosting must be
 * CREATE_COMPLETE or UPDATE_COMPLETE. Read-only CloudFormation DescribeStacks call.
 * Exit codes: 0 healthy, 1 any other status or error.
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { STACK_NAME } from '../lib/hosting-stack';
import { formatError, resolveRegion, type Logger } from './aws-env';

export const HEALTHY_STACK_STATUSES: readonly string[] = ['CREATE_COMPLETE', 'UPDATE_COMPLETE'];

export interface StackStatusDeps {
  resolveRegion(): Promise<string | undefined>;
  describeStackStatus(region: string, stackName: string): Promise<string | undefined>;
}

export async function runStackStatus(deps: StackStatusDeps, log: Logger): Promise<number> {
  const region = await deps.resolveRegion();
  if (region === undefined) {
    log('stack-status: no region resolved — set AWS_REGION or a profile region');
    return 1;
  }
  let status: string | undefined;
  try {
    status = await deps.describeStackStatus(region, STACK_NAME);
  } catch (error) {
    log(`stack-status: ${formatError(error)}`);
    return 1;
  }
  if (status !== undefined && HEALTHY_STACK_STATUSES.includes(status)) {
    log(`stack-status: PASS ${STACK_NAME} ${status} (${region})`);
    return 0;
  }
  log(`stack-status: FAIL ${STACK_NAME} ${status ?? 'not found'} (${region})`);
  return 1;
}

export function createSdkStackStatusDeps(): StackStatusDeps {
  return {
    resolveRegion: () => resolveRegion(),
    describeStackStatus: async (region, stackName) => {
      const output = await new CloudFormationClient({ region }).send(
        new DescribeStacksCommand({ StackName: stackName }),
      );
      return output.Stacks?.[0]?.StackStatus;
    },
  };
}

if (require.main === module) {
  void runStackStatus(createSdkStackStatusDeps(), (line) => {
    console.log(line);
  }).then((code) => {
    process.exitCode = code;
  });
}
