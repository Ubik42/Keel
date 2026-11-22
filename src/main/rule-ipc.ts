import path from 'node:path';
import { ipcMain, shell, clipboard } from 'electron';
import { RULE_INVOKE_CHANNEL } from '../shared/protocol/channels';
import { type RuleIpcResult, ruleIpcRequestSchema, ruleAiPrompt } from '../shared/rules';
import { state } from './main-state';
import type { LibraryWorkerClient } from './worker-client';
import { randomUUID } from 'node:crypto';

/**
 * IPC for the rule list and rule detail: list, switch, order, run, history, files and the AI prompt (split out of startApplication, P8).
 */
export function registerRuleIpc() {
  // PR: rule list, switch, order, run, history, files and the AI prompt.
  ipcMain.handle(RULE_INVOKE_CHANNEL, async (event, input: unknown): Promise<RuleIpcResult> => {
    if (!state.mainWindow || event.sender !== state.mainWindow.webContents) return { ok: false, message: "Unauthorized." };
    const parsed = ruleIpcRequestSchema.safeParse(input);
    if (!parsed.success || !state.workerClient || !state.ruleRunner) return { ok: false, message: "规则服务不可用。" };
    const request = parsed.data;
    const listResult = (response: Awaited<ReturnType<LibraryWorkerClient["request"]>>): RuleIpcResult =>
      response.ok && response.type === "rule.list.result"
        ? { ok: true, list: response.result }
        : { ok: false, message: response.ok ? "规则服务不可用。" : response.error.code };
    try {
      switch (request.action) {
        case "list":
          return listResult(await state.workerClient.request({ type: "rule.list", libraryId: request.libraryId }));
        case "set-enabled":
          return listResult(await state.workerClient.request({ type: "rule.set-enabled", libraryId: request.libraryId, ruleId: request.ruleId, enabled: request.enabled }));
        case "set-layout":
          return listResult(await state.workerClient.request({ type: "rule.layout.set", libraryId: request.libraryId, layout: request.layout }));
        case "delete":
          return listResult(await state.workerClient.request({ type: "rule.delete", libraryId: request.libraryId, ruleId: request.ruleId }));
        case "create": {
          const id = randomUUID();
          return listResult(await state.workerClient.request({
            type: "rule.save",
            libraryId: request.libraryId,
            manifest: {
              $schema: "../rule.schema.json",
              version: 1,
              id,
              name: request.name,
              purpose: "",
              trigger: { kind: "manual" },
              scope: { folderId: null, recursive: true },
              permissions: ["asset.search"],
              script: "rule.ts",
            },
            source: [
              "// 用 AI 编写这条规则：点规则详情中的“复制给 AI”。",
              "const page = await keel.assets.search({ query: null, scope: rule.scope, limit: 20 });",
              "return { count: page.total };",
              "",
            ].join("\n"),
          }));
        }
        case "run": {
          const run = await state.ruleRunner.run({
            libraryId: request.libraryId,
            ruleId: request.ruleId,
            reason: request.dryRun ? "dry-run" : "manual",
            interactive: true,
          });
          return run ? { ok: true, run } : { ok: false, message: "找不到这条规则。" };
        }
        case "history": {
          const response = await state.workerClient.request({ type: "rule.runs.list", libraryId: request.libraryId, ruleId: request.ruleId, limit: 50 });
          return response.ok && response.type === "rule.runs.result" ? { ok: true, runs: response.runs } : { ok: false, message: "无法读取运行历史。" };
        }
        case "reveal":
        case "copy-for-ai": {
          const response = await state.workerClient.request({ type: "rule.list", libraryId: request.libraryId });
          if (!response.ok || response.type !== "rule.list.result") return { ok: false, message: "规则服务不可用。" };
          const list = response.result;
          const rule = request.ruleId ? list.rules.find((r) => r.manifest.id === request.ruleId) ?? null : null;
          if (request.action === "reveal") {
            const target = rule ? path.join(list.rulesDirectory, rule.manifest.id) : list.rulesDirectory;
            const failure = await shell.openPath(target);
            return failure ? { ok: false, message: failure } : { ok: true };
          }
          clipboard.writeText(ruleAiPrompt({ rulesDirectory: list.rulesDirectory.replaceAll("\\", "/"), rule }));
          return { ok: true };
        }
      }
    } catch (error) {
      state.logger?.error("rule.ipc", error, { action: request.action });
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}
