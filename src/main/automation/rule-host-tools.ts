import { createRuleMcpTools } from './rule-mcp-tools';
import { state } from '../main-state';

/**
 * The rule tools offered by the embedded MCP server (split out of index.ts, P8).
 */
export const ruleMcpTools = createRuleMcpTools({ ruleRunner: () => state.ruleRunner, workerClient: () => state.workerClient });
