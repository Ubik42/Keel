import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { ResizablePanel } from "../../workbench/shell/panel-auto-hide";

export interface PaneResizeHandlesProps {
  leftOpen: boolean;
  t: TranslateFn;
  panelResizing: ResizablePanel | null;
  capturePanelResizeAnchor: (lock?: boolean) => void;
  resetPanelWidth: (panel: ResizablePanel) => void;
  beginPanelResize: (panel: ResizablePanel, clientX: number) => void;
  navPanelWidth: number;
  beginPanelEdgeRestore: (panel: ResizablePanel, clientX: number) => void;
  rightOpen: boolean;
  inspectorPanelWidth: number;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function PaneResizeHandles({ leftOpen, t, panelResizing, capturePanelResizeAnchor, resetPanelWidth, beginPanelResize, navPanelWidth, beginPanelEdgeRestore, rightOpen, inspectorPanelWidth }: PaneResizeHandlesProps) {

  return (
<>
{/* REQ-SHELL-007 / REQ-SHELL-011 pane resize + edge restore handles. */}
      {leftOpen ? (
        <div
          aria-label={t("shell.resizeNav")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeNav")}
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("nav");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ left: navPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreNavEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "nav" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreNavEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("nav", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ left: 0 }}
        />
      )}
      {rightOpen ? (
        <div
          aria-label={t("shell.resizeInspector")}
          aria-orientation="vertical"
          className={`panel-resizer${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.resizeInspector")}
          onDoubleClick={() => {
            capturePanelResizeAnchor(false);
            resetPanelWidth("inspector");
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelResize("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ right: inspectorPanelWidth - 3 }}
        />
      ) : (
        <div
          aria-label={t("shell.restoreInspectorEdge")}
          aria-orientation="vertical"
          className={`panel-resizer panel-resizer-edge${panelResizing === "inspector" ? " is-active" : ""}`}
          data-hover-tip={t("shell.restoreInspectorEdge")}
          onPointerDown={(event) => {
            event.preventDefault();
            capturePanelResizeAnchor();
            beginPanelEdgeRestore("inspector", event.clientX);
          }}
          onMouseDown={() => capturePanelResizeAnchor()}
          role="separator"
          style={{ right: 0 }}
        />
      )}
</>
  );
}
