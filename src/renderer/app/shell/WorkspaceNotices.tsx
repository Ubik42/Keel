import type { TransitionEvent } from "react";
import { useNavigationField } from "../../stores/navigation-store";
import { usePreviewField } from "../../stores/preview-store";
import { useSessionField } from "../../stores/session-store";
import type { ToastStackMessage } from "../../jobs/toast-notifications";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { WorkspaceTabsState } from "../../workspace/workspace-tabs";
import { FindSimilarBanner } from "../../ai/FindSimilarBanner";
import { Notice } from "../../workbench/ui/patterns";
import { WorkspaceNoticeBanner } from "../../workspace/WorkspaceNoticeBanner";
import { createPortal } from "react-dom";

export interface WorkspaceNoticesProps {
  renderedToastStack: readonly ToastStackMessage[];
  t: TranslateFn;
  topVisibleToastId: number | undefined;
  dismissToast: (id: number) => void;
  handleToastTransitionEnd: (event: TransitionEvent) => void;
  undoLastFileOp: (expectedHistoryEntryId?: string) => Promise<void>;
  workspaceTabsState: WorkspaceTabsState;
  goWorkspaceBack: () => Promise<void>;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function WorkspaceNotices({ renderedToastStack, t, topVisibleToastId, dismissToast, handleToastTransitionEnd, undoLastFileOp, workspaceTabsState, goWorkspaceBack }: WorkspaceNoticesProps) {
  const [workerRecoveryState] = useSessionField("workerRecoveryState");
  const [findSimilarSource] = useNavigationField("findSimilarSource");
  const [library] = useSessionField("library");
  const [previewAsset] = usePreviewField("previewAsset");
  return (
<>
{renderedToastStack.length > 0 || workerRecoveryState !== 'ready'
            ? createPortal(
                <div
                  aria-atomic="false"
                  aria-live="polite"
                  className="workspace-notice-stack workspace-notice"
                >
                  {workerRecoveryState !== 'ready' ? (
                    <Notice
                      className="workspace-notice-item"
                      message={t(workerRecoveryState === 'recovering' ? 'toast.workerRecovering' : 'toast.workerFailed')}
                      tone={workerRecoveryState === 'recovering' ? 'warning' : 'error'}
                    />
                  ) : null}
                  {renderedToastStack.map((message) => {
                    const isUndoTarget =
                      !message.closing &&
                      message.id === topVisibleToastId;
                    return (
                      <WorkspaceNoticeBanner
                        key={message.id}
                        closing={message.closing}
                        message={message}
                        onDismiss={() => dismissToast(message.id)}
                        onTransitionEnd={handleToastTransitionEnd}
                        onUndo={
                          message.kind === "notice" &&
                          isUndoTarget &&
                          message.historyEntryId
                            ? () => void undoLastFileOp(message.historyEntryId)
                            : undefined
                        }
                        toastId={message.id}
                        undoLabel={
                          message.kind === "notice" &&
                          isUndoTarget &&
                          message.historyEntryId
                            ? t("action.undo")
                            : undefined
                        }
                      />
                    );
                  })}
                </div>,
                document.body,
              )
            : null}
        {findSimilarSource
          && findSimilarSource.libraryId === library?.libraryId
          && findSimilarSource.workspaceTabId === workspaceTabsState.activeTabId
          && !previewAsset ? (
            <FindSimilarBanner
              coverUrl={findSimilarSource.coverUrl}
              displayName={findSimilarSource.displayName}
              onBack={() => void goWorkspaceBack()}
            />
          ) : null}
</>
  );
}
