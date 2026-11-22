import { state } from './main-state';
import { app, dialog, type MessageBoxOptions } from 'electron';
import { ensureRendererKeyboardFocus } from './renderer-keyboard-focus';
import { type DesktopAutomationFilePlanSummary } from './automation-file-plan-approval';
import { type AutomationSource } from '../automation/command-registry';
import type { RendererCriticalConfirmationBroker } from './critical-confirmation-prompt';
import { mcpFullAccessConfirmationCopy } from './mcp-full-access-confirmation-copy';
import { type RendererRequest } from '../shared/protocol/requests';
import { criticalConfirmationInitialFocusForOperation, criticalDiskDeleteConfirmLabel } from '../shared/critical-confirmation';

/**
 * Desktop confirmations for rules, automation writes, file plans and critical operations (split out of index.ts, P8).
 */
/** PR: first run of a new or edited rule. */
export async function confirmRuleRun(rule: { name: string; purpose: string; permissions: readonly string[] }): Promise<boolean> {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return false;
  if (!app.isPackaged && process.env.KEEL_E2E === '1' && process.env.KEEL_E2E_AUTOMATION_CONFIRM === '1') return true;
  const response = await dialog.showMessageBox(state.mainWindow, {
    type: 'warning',
    buttons: ['取消', '运行规则'],
    defaultId: 1,
    cancelId: 0,
    title: '运行规则',
    message: `运行规则“${rule.name}”？`,
    detail: [
      rule.purpose || '这条规则没有写用途。',
      '',
      `它可以使用：${rule.permissions.join('、') || '无'}。`,
      '确认后，这一版规则会按它的触发方式自动运行；规则文件改动后需要再确认一次。每次运行都记录在规则的触发历史中，改动可以撤销。',
    ].join('\n'),
  });
  ensureRendererKeyboardFocus(state.mainWindow, { reattachHwnd: true, reason: 'rule.confirm' });
  return response.response === 1;
}

export async function confirmDesktopAutomationWrite(): Promise<boolean> {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return false;
  // Native modal dialogs are not controllable through Playwright. Restrict
  // this deterministic test seam to an unpackaged, isolated E2E process; it
  // can never be enabled by a shipped build or normal `npm start` session.
  if (!app.isPackaged
    && process.env.KEEL_E2E === '1'
    && process.env.KEEL_E2E_AUTOMATION_CONFIRM === '1') {
    return true;
  }
  const response = await dialog.showMessageBox(state.mainWindow, {
    type: 'warning',
    buttons: ['取消', '运行脚本'],
    defaultId: 1,
    cancelId: 0,
    title: '运行自动化脚本',
    message: '此脚本可以读取资产、标签与合集，修改评分与元数据，创建标签或空文件夹，整理合集，入队 AI 分析，复制文件路径，以及重命名或移入回收站。',
    detail: '脚本只会获得受限自动化能力；新建资源库和批量导入仍需单独的本机计划确认，不会获得网络下载、磁盘直读、数据库或永久删除权限。每次运行都会记录到应用日志。',
  });
  ensureRendererKeyboardFocus(state.mainWindow, {
    reattachHwnd: true,
    reason: "native-dialog.message-box",
  });
  return response.response === 1;
}

export async function confirmDesktopAutomationFilePlan(
  plan: DesktopAutomationFilePlanSummary,
  context?: {
    source: AutomationSource;
    executionId: string;
    clientName?: string;
    libraryDisplayName?: string;
  },
): Promise<boolean> {
  // See confirmDesktopAutomationWrite: this is an isolated, unpackaged E2E
  // seam only. Production builds always display the fresh plan confirmation.
  if (!app.isPackaged
    && process.env.KEEL_E2E === '1'
    && process.env.KEEL_E2E_AUTOMATION_CANCEL_ONCE === '1') {
    state.e2eAutomationFilePlanConfirmationCount += 1;
    if (state.e2eAutomationFilePlanConfirmationCount === 1) return false;
  }
  if (!app.isPackaged
    && process.env.KEEL_E2E === '1'
    && process.env.KEEL_E2E_AUTOMATION_CONFIRM === '1') {
    return true;
  }
  const action = plan.operation === 'trash'
    ? '移入回收站'
    : plan.operation === 'replace-content'
      ? '原地替换文件内容'
    : plan.operation === 'move'
      ? '移动到文件夹'
      : plan.operation === 'rename-file' || plan.operation === 'rename-files'
        ? '重命名文件'
        : plan.operation === 'import'
          ? '导入文件'
          : plan.operation === 'create'
            ? '创建资源库'
            : '恢复回原始位置';
  const dialogOptions: MessageBoxOptions = {
    type: 'warning',
    buttons: ['取消', `确认${action}`],
    defaultId: 1,
    cancelId: 0,
    title: '确认文件操作',
    message: context?.source === 'mcp'
      ? `${context.clientName ?? 'MCP 客户端'} 请求${action} ${plan.executableCount} 项资产${context.libraryDisplayName ? `（资源库“${context.libraryDisplayName}”）` : ''}。`
      : `准备${action} ${plan.executableCount} 项资产。`,
    detail: [
      ...(context?.source === 'mcp'
        ? ['这是 MCP 客户端发起的文件操作；请确认目标和数量后再执行。']
        : []),
      `本次选中 ${plan.targetCount} 项；${plan.blockedCount} 项因当前状态或冲突不会处理。`,
      ...(plan.conflictCount !== undefined && plan.conflictCount > 0
        ? [`其中 ${plan.conflictCount} 项检测到目标冲突。`]
        : []),
      plan.undoSupported
        ? '移入回收站后可在回收站中恢复。'
        : plan.operation === 'replace-content'
          ? '原文件字节将被覆盖，且无法通过回收站撤销。'
        : '执行前会再次确认这些资产没有变化。',
      ...(plan.hookWarnings !== undefined && plan.hookWarnings.length > 0
        ? [`插件提示：${plan.hookWarnings.join('；')}`]
        : []),
    ].join('\n'),
  };
  const response = state.mainWindow && !state.mainWindow.isDestroyed()
    ? await dialog.showMessageBox(state.mainWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  ensureRendererKeyboardFocus(state.mainWindow, {
    reattachHwnd: true,
    reason: "native-dialog.message-box",
  });
  return response.response === 1;
}

export function askCriticalConfirmation(
  input: Parameters<RendererCriticalConfirmationBroker['request']>[0],
): Promise<boolean> {
  const broker = state.criticalConfirmationBroker;
  if (broker === undefined) return Promise.resolve(false);
  return broker.request(input);
}

export async function confirmCriticalLibraryDeletion(libraryId: string): Promise<boolean> {
  const client = state.workerClient;
  if (client === undefined) return false;
  const listed = await client.request({ type: 'library.list' });
  if (!listed.ok || listed.type !== 'library.list') return false;
  const library = listed.libraries.find((candidate) => candidate.libraryId === libraryId);
  if (library === undefined) return false;
  const english = state.appLocale === 'en';
  return askCriticalConfirmation({
    title: english ? 'Confirm critical operation' : '确认危险操作',
    heading: english ? 'Delete this library from disk?' : '从磁盘删除这个资源库？',
    message: english
      ? `The library “${library.displayName}” and its Serpent-managed directory will be permanently deleted.`
      : `资源库“${library.displayName}”及其 Keel 管理的目录将被永久删除。`,
    detail: english
      ? 'This cannot be undone. Linked-folder source directories are not included.'
      : '此操作无法撤销。关联文件夹的源目录不会被删除。',
    cancelLabel: english ? 'Cancel' : '取消',
    confirmLabel: english ? 'Delete from disk' : '从磁盘删除',
    initialFocus: 'cancel',
  });
}

export async function confirmEnableAllMcpPermissions(label: string): Promise<boolean> {
  const copy = mcpFullAccessConfirmationCopy(
    label,
    state.appLocale === 'en' ? 'en' : 'zh-CN',
  );
  return askCriticalConfirmation({
    ...copy,
    cancelLabel: state.appLocale === 'en' ? 'Cancel' : '取消',
    initialFocus: 'cancel',
  });
}

export function criticalRendererRequest(request: RendererRequest): boolean {
  return request.type === 'library.delete-from-disk.request'
    || request.type === 'folder.delete-from-disk.request'
    || request.type === 'asset.delete-from-disk.request'
    || request.type === 'asset.delete-permanent.request'
    || request.type === 'trash.purge.request'
    || (request.type === 'linked-folder.delete-subtree.request' && request.deleteFromDisk);
}

export type CriticalRendererOperation =
  | 'folder'
  | 'linked-folder'
  | 'linked-asset'
  | 'asset-permanent'
  | 'trash-purge'
  | 'asset';

/**
 * Linked assets are deleted permanently from their source folder (the file never
 * enters the application trash, and the previous implementation's trip through
 * the OS recycle bin is gone), so the confirmation must name that operation
 * instead of the generic "delete these assets" copy.  The renderer supplies
 * `locationKind` as a copy hint only; Main still has no database access.
 */
export function criticalRendererOperation(request: RendererRequest): CriticalRendererOperation {
  switch (request.type) {
    case 'folder.delete-from-disk.request':
      return 'folder';
    case 'linked-folder.delete-subtree.request':
      return 'linked-folder';
    case 'asset.delete-permanent.request':
      return 'asset-permanent';
    case 'trash.purge.request':
      return 'trash-purge';
    case 'asset.delete-from-disk.request':
      return request.locationKind === 'linked' ? 'linked-asset' : 'asset';
    default:
      return 'asset';
  }
}

export function criticalRendererCopy(
  operation: CriticalRendererOperation,
  count: number,
  english: boolean,
): { heading: string; message: string; detail: string } {
  switch (operation) {
    case 'folder':
      return {
        heading: english ? 'Delete this folder from disk?' : '从磁盘删除这个文件夹？',
        message: english
          ? 'The selected folder and its managed assets will be permanently deleted.'
          : '选定文件夹及其中的托管资产将被永久删除。',
        detail: english
          ? 'This cannot be undone and the files will not go to the application trash.'
          : '此操作无法撤销，文件不会进入应用回收站。',
      };
    case 'linked-folder':
      return {
        heading: english ? 'Delete linked-folder files from disk?' : '从磁盘删除链接文件夹内容？',
        message: english
          ? 'The selected linked-folder source files will be permanently deleted.'
          : '选定链接文件夹中的源文件将被永久删除。',
        detail: english
          ? 'This cannot be undone and the files will not go to the application trash.'
          : '此操作无法撤销，文件不会进入应用回收站。',
      };
    case 'linked-asset':
      return {
        heading: english ? 'Delete these linked assets from disk?' : '从磁盘删除这些链接资产的源文件？',
        message: english
          ? `The source files of ${count} selected linked asset(s) will be permanently deleted, and their library link records with them.`
          : `选定 ${count} 个链接资产的源文件将被永久删除，库内的链接记录也会一并移除。`,
        detail: english
          ? 'This cannot be undone; the source files are deleted from the linked folder and do not go to the recycle bin.'
          : '此操作无法撤销：链接文件夹中的源文件会被直接删除，不会进入系统回收站。',
      };
    case 'asset-permanent':
      return {
        heading: english ? 'Permanently delete these trash assets?' : '永久删除这些回收站资产？',
        message: english
          ? `${count} selected trash asset(s) will be permanently deleted.`
          : `选定的 ${count} 项回收站资产将被永久删除。`,
        detail: english
          ? 'This cannot be undone and the files will not go to the application trash.'
          : '此操作无法撤销，文件不会进入应用回收站。',
      };
    case 'trash-purge':
      return {
        heading: english ? 'Empty the Keel trash permanently?' : '永久清空 Keel 回收站？',
        message: english
          ? 'All assets currently in the Keel trash will be permanently deleted.'
          : 'Keel 回收站中的全部资产将被永久删除。',
        detail: english
          ? 'This cannot be undone and the files will not go to the application trash.'
          : '此操作无法撤销，文件不会进入应用回收站。',
      };
    case 'asset':
      return {
        heading: english ? 'Delete these assets from disk?' : '从磁盘删除这些资产？',
        message: english
          ? `${count} selected asset(s) will be permanently deleted.`
          : `选定的 ${count} 项资产将被永久删除。`,
        detail: english
          ? 'This cannot be undone and the files will not go to the application trash.'
          : '此操作无法撤销，文件不会进入应用回收站。',
      };
  }
}

export async function confirmCriticalRendererRequest(request: RendererRequest): Promise<boolean> {
  if (request.type === 'library.delete-from-disk.request') {
    return confirmCriticalLibraryDeletion(request.libraryId);
  }
  const english = state.appLocale === 'en';
  const count = request.type === 'asset.delete-from-disk.request'
    || request.type === 'asset.delete-permanent.request'
    ? request.assetIds.length
    : 0;
  const operation = criticalRendererOperation(request);
  const { heading, message, detail } = criticalRendererCopy(operation, count, english);
  const forceDelete = criticalConfirmationInitialFocusForOperation(operation) === 'confirm';
  return askCriticalConfirmation({
    title: english ? 'Confirm critical operation' : '确认危险操作',
    heading,
    message,
    detail,
    cancelLabel: english ? 'Cancel' : '取消',
    confirmLabel: forceDelete
      ? criticalDiskDeleteConfirmLabel(english)
      : (english ? 'Delete permanently' : '永久删除'),
    initialFocus: criticalConfirmationInitialFocusForOperation(operation),
  });
}
