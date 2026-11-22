import { ipcRenderer } from 'electron';

import { RULE_INVOKE_CHANNEL, RULE_RUN_RECORDED_CHANNEL } from '../../shared/protocol/channels';
import type { RuleIpcRequest, RuleIpcResult } from '../../shared/rules';

export type KeelRulesApi = {
  invoke(request: RuleIpcRequest): Promise<RuleIpcResult>;
  /** A rule run was recorded (any trigger); returns an unsubscribe function. */
  onRunRecorded(listener: (event: { libraryId: string; ruleId: string; runId: string }) => void): () => void;
};

export const rules: KeelRulesApi = Object.freeze({
  async invoke(request: RuleIpcRequest) {
    return (await ipcRenderer.invoke(RULE_INVOKE_CHANNEL, request)) as RuleIpcResult;
  },
  onRunRecorded(listener: (event: { libraryId: string; ruleId: string; runId: string }) => void) {
    const handler = (_event: unknown, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const { libraryId, ruleId, runId } = payload as Record<string, unknown>;
      if (typeof libraryId === 'string' && typeof ruleId === 'string' && typeof runId === 'string') listener({ libraryId, ruleId, runId });
    };
    ipcRenderer.on(RULE_RUN_RECORDED_CHANNEL, handler);
    return () => ipcRenderer.off(RULE_RUN_RECORDED_CHANNEL, handler);
  },
});
