import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { INSPECTOR_SECTION_IDS, type InspectorSectionId } from "../../shared/inspector-sections";

/**
 * Inspector sections for an asset selection (P4). Built-in sections are
 * listed by id and rendered in INSPECTOR_SECTION_IDS order; plugin sections
 * placed after a built-in section follow it. Each section has its own error
 * boundary, so one failing section (a plugin's included) leaves the rest of
 * the Inspector usable.
 */
export interface InspectorSectionEntry {
  id: InspectorSectionId;
  node: ReactNode;
  /** Rendered after the plugin sections placed after this one. */
  trailing?: ReactNode;
}

export function InspectorSectionList({
  entries,
  resetKey,
  renderPluginSections,
}: {
  entries: readonly InspectorSectionEntry[];
  /** A new selection clears a section's error state. */
  resetKey: string;
  renderPluginSections: (placement: InspectorSectionId) => ReactNode;
}): ReactNode {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return INSPECTOR_SECTION_IDS.map((id) => {
    const entry = byId.get(id);
    return (
      <Fragment key={id}>
        {entry ? <InspectorSectionBoundary id={id} resetKey={resetKey}>{entry.node}</InspectorSectionBoundary> : null}
        <InspectorSectionBoundary id={`plugins-after-${id}`} resetKey={resetKey}>{renderPluginSections(id)}</InspectorSectionBoundary>
        {entry?.trailing ? <InspectorSectionBoundary id={`${id}-trailing`} resetKey={resetKey}>{entry.trailing}</InspectorSectionBoundary> : null}
      </Fragment>
    );
  });
}

class InspectorSectionBoundary extends Component<
  { id: string; resetKey: string; children: ReactNode },
  { failedKey: string | null }
> {
  override state: { failedKey: string | null } = { failedKey: null };

  static getDerivedStateFromError(): Partial<{ failedKey: string | null }> {
    return { failedKey: "pending" };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("inspector-section-failed", this.props.id, error, info.componentStack);
    this.setState({ failedKey: this.props.resetKey });
  }

  override render(): ReactNode {
    const failed = this.state.failedKey !== null
      && (this.state.failedKey === "pending" || this.state.failedKey === this.props.resetKey);
    return failed ? null : this.props.children;
  }
}
