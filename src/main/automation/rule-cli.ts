import { writeSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { waitForDesktop } from '../mcp/mcp-stdio-launcher';

/**
 * `Keel.exe --rule <command>` (docs/进度.md 3.5): the rule tools on the
 * command line. It connects to the running desktop (starting it in the
 * background when needed) and calls the same MCP tools as an agent, so runs,
 * approvals and history stay in the desktop.
 */
export const RULE_CLI_FLAG = '--rule';

const USAGE = `用法：Keel.exe --rule <命令> [规则 id] [选项]

命令：
  list                 列出规则（按优先级）
  validate <规则>      检查 rule.json 与脚本（Schema、权限、语法）
  dry-run <规则>       试运行，列出将要发生的改动，不写入
  run <规则>           立即运行（新规则或改过的规则需先在桌面确认一次）
  history <规则>       触发历史
  enable <规则>        开启
  disable <规则>       关闭

<规则> 可以是规则 id，也可以是 .keel/rules/<id> 目录的路径。

选项：
  --library <名称或 id>  资源库；只打开一个资源库时可省略
  --limit <数量>         history 的条数（1–200）
  --json                 输出 JSON
`;

const RULE_COMMANDS: Record<string, string> = {
  validate: 'keel_rule_validate',
  'dry-run': 'keel_rule_dry_run',
  run: 'keel_rule_run',
  history: 'keel_rule_history',
  enable: 'keel_rule_enable',
  disable: 'keel_rule_disable',
};

class CliUsageError extends Error {}

interface ParsedArgs {
  command: string;
  ruleId: string | undefined;
  library: string | undefined;
  limit: number | undefined;
  json: boolean;
}

export function parseRuleCliArgs(argv: readonly string[]): ParsedArgs {
  const start = argv.indexOf(RULE_CLI_FLAG);
  const args = start === -1 ? [...argv] : argv.slice(start + 1);
  const positional: string[] = [];
  let library: string | undefined;
  let limit: number | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--library') {
      library = args[++index];
      if (!library) throw new CliUsageError('--library 需要资源库名称或 id。');
    } else if (arg === '--limit') {
      limit = Number(args[++index]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CliUsageError('--limit 需要 1–200 的整数。');
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      throw new CliUsageError('');
    } else if (arg.startsWith('--')) {
      throw new CliUsageError(`未知选项：${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [command, rule] = positional;
  if (!command) throw new CliUsageError('');
  if (command !== 'list' && !(command in RULE_COMMANDS)) throw new CliUsageError(`未知命令：${command}`);
  if (command !== 'list' && !rule) throw new CliUsageError(`${command} 需要规则 id。`);
  // A rule directory path names the rule by its folder.
  const ruleId = rule && /[\\/]/u.test(rule) ? path.basename(path.resolve(rule)) : rule;
  return { command, ruleId, library, limit, json };
}

type ToolPayload = { ok: boolean; result?: unknown; code?: string; message?: string; error?: { code?: string; message?: string } };

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await client.callTool({ name, arguments: args });
  const structured = response.structuredContent as ToolPayload | undefined;
  const text = Array.isArray(response.content) && response.content[0]?.type === 'text' ? String(response.content[0].text) : '';
  const payload: ToolPayload | undefined = structured ?? (text ? JSON.parse(text) as ToolPayload : undefined);
  if (!payload?.ok) {
    // Host tools report code/message at the top level; registry tools in error.
    const error = payload?.error ?? payload;
    throw new Error(error?.message ? `${error.code ? `${error.code}：` : ''}${error.message}` : text || `${name} 失败。`);
  }
  return payload.result;
}

async function resolveLibraryId(client: Client, wanted: string | undefined): Promise<string> {
  const result = await callTool(client, 'keel_library_list_open', {}) as {
    libraries: Array<{ libraryId: string; displayName: string; active: boolean }>;
  };
  const libraries = result.libraries;
  if (wanted) {
    const match = libraries.find((library) => library.libraryId === wanted)
      ?? libraries.find((library) => library.displayName === wanted);
    if (!match) throw new Error(`没有打开名为“${wanted}”的资源库。已打开：${libraries.map((l) => l.displayName).join('、') || '无'}`);
    return match.libraryId;
  }
  if (libraries.length === 1) return libraries[0]!.libraryId;
  if (libraries.length === 0) throw new Error('Keel 中没有打开的资源库。');
  const active = libraries.find((library) => library.active);
  if (active) return active.libraryId;
  throw new Error(`打开了多个资源库，请用 --library 指定：${libraries.map((l) => l.displayName).join('、')}`);
}

type RunView = {
  status: string;
  trigger: string;
  startedAt: string;
  dryRun: boolean;
  filesProcessed: number;
  changes: Array<{ commandId: string; assetIds: string[]; summary: string }>;
  output: string[];
  error: { code: string; message: string; line?: number } | null;
};

function formatRun(run: RunView): string {
  const lines = [`${run.startedAt}  ${run.trigger}  ${run.status}  处理 ${run.filesProcessed} 个文件 · ${run.changes.length} 项改动`];
  for (const change of run.changes) lines.push(`  ${run.dryRun ? '将要：' : ''}${change.summary}（${change.commandId}，${change.assetIds.length} 个资源）`);
  for (const line of run.output) lines.push(`  | ${line}`);
  if (run.error) lines.push(`  错误 ${run.error.code}：${run.error.message}${run.error.line ? `（第 ${run.error.line} 行）` : ''}`);
  return lines.join('\n');
}

function formatResult(command: string, result: unknown): string {
  if (command === 'list') {
    const list = result as {
      rules: Array<{ id: string; name: string; purpose: string; trigger: { kind: string; everyMinutes?: number }; enabled: boolean; lastRun: RunView | null }>;
      problems: Array<{ directory: string; message: string }>;
      rulesDirectory?: string;
    };
    const lines = list.rules.map((rule) => {
      const trigger = rule.trigger.kind === 'schedule' ? `每 ${rule.trigger.everyMinutes} 分钟` : rule.trigger.kind;
      const last = rule.lastRun ? `  最近：${rule.lastRun.status}` : '';
      return `${rule.enabled ? '●' : '○'} ${rule.name}  [${trigger}]  ${rule.id}${last}\n    ${rule.purpose}`;
    });
    for (const problem of list.problems) lines.push(`! ${problem.directory}：${problem.message}`);
    return lines.length > 0 ? lines.join('\n') : '还没有规则。';
  }
  if (command === 'validate') {
    const value = result as { ok?: boolean; valid?: boolean; problems?: string[] };
    const problems = value.problems ?? [];
    return problems.length === 0 ? '检查通过。' : problems.map((problem) => `- ${problem}`).join('\n');
  }
  if (command === 'history') {
    const runs = (Array.isArray(result) ? result : (result as { runs?: RunView[] }).runs ?? []) as RunView[];
    return runs.length > 0 ? runs.map(formatRun).join('\n') : '还没有运行记录。';
  }
  if (command === 'run' || command === 'dry-run') return formatRun(result as RunView);
  return JSON.stringify(result);
}

/** Exit code 1 when the command worked but the rule did not: failed run, validation problems. */
function failed(command: string, result: unknown): boolean {
  if (command === 'run' || command === 'dry-run') return (result as RunView).status !== 'succeeded';
  if (command === 'validate') return ((result as { problems?: string[] }).problems ?? []).length > 0;
  return false;
}

function write(fd: 1 | 2, text: string): void {
  // Electron's process.stdout does not reach a pipe on Windows; write the fd.
  writeSync(fd, text.endsWith('\n') ? text : `${text}\n`);
}

export async function runRuleCli(input: {
  argv: readonly string[];
  userDataPath: string;
  executablePath: string;
}): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseRuleCliArgs(input.argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(2, `${error.message ? `${error.message}\n\n` : ''}${USAGE}`);
      return 2;
    }
    throw error;
  }
  const connection = await waitForDesktop(input.userDataPath, input.executablePath);
  const client = new Client({ name: 'keel-rule-cli', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
  });
  await client.connect(transport);
  try {
    const libraryId = await resolveLibraryId(client, args.library);
    const tool = args.command === 'list' ? 'keel_rule_list' : RULE_COMMANDS[args.command]!;
    const toolArgs: Record<string, unknown> = { libraryId };
    if (args.ruleId) toolArgs.ruleId = args.ruleId;
    if (args.command === 'history' && args.limit !== undefined) toolArgs.limit = args.limit;
    const available = await client.listTools();
    if (!available.tools.some((candidate) => candidate.name === tool)) {
      throw new Error(`${tool} 不可用：运行、开关规则需要在 Keel 设置 → MCP 中允许写入。`);
    }
    const result = await callTool(client, tool, toolArgs);
    write(1, args.json ? JSON.stringify(result, null, 2) : formatResult(args.command, result));
    return failed(args.command, result) ? 1 : 0;
  } finally {
    await client.close().catch(() => undefined);
  }
}
