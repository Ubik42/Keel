import { dialogsFields, useDialogField } from "../../stores/dialogs-store";
import { useEmbeddingField } from "../../stores/embedding-store";
import { useQueryField } from "../../stores/query-store";
import { useSessionField } from "../../stores/session-store";
import { transfersFields } from "../../stores/transfers-store";
import { useWorkspaceField } from "../../stores/workspace-store";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { TranslateFn } from "../../i18n/LocaleProvider";
import type { EmbeddingHttpServiceSummary, KeelLibraryApi } from "../../../shared/library-api";
import type { ImportMenuCopy } from "../../browse/browse-empty-state";
import type { MainMenuSection } from "../../shell/main-menu-items";
import type { WorkspaceTabsState } from "../../workspace/workspace-tabs";
import type { WorkspaceTabPresentation } from "../../workspace/workspace-tab-presentation";
import type { SelectWorkspaceTabOptions } from "../../workspace/use-workspace-tabs";
import type { ContextMenuDescriptor } from "../../workbench/menu/context-menu";
import type { KeelShellApi } from "../../../shared/external-url";
import { AppSettingsEntry } from "../../settings/AppSettingsEntry";
import { type CreateLibraryPhase } from "../../common/CreateDialog";
import { Icon } from "../../common/Icons";
import { LibrarySwitcher } from "../../library/LibrarySwitcher";
import { MainMenu } from "../../shell/MainMenu";
import { ScopeHistoryButtons } from "../../search/ScopeHistoryButtons";
import { parseSearchExpressionDetailed, searchExpressionReasonKey } from "../../search/search-expression";
import { clearSearchHistory, filterSearchHistory, moveSearchHistoryIndex, readVisibleSearchHistoryCount, rememberSearchQuery, searchHistoryNavigationDirection } from "../../search/search-history";
import { SearchHistoryPopover } from "../../search/SearchHistoryPopover";
import { loadSemanticSearchPreferences, saveSemanticSearchPreferences } from "../../ai/semantic-search-preferences";
import { isImeKeyboardEvent } from "../../workbench/overlay/ime-safe-dismiss";
import { WindowEdgeResizeHandles } from "../../workbench/shell/WindowEdgeResizeHandles";
import { WindowsWindowControls } from "../../workbench/shell/WindowsWindowControls";
import { WorkspaceTabs } from "../../workspace/WorkspaceTabs";
import { IS_WINDOWS_PLATFORM, ToolButton } from "../shared/app-shared";

export interface AppToolbarProps {
  leftOpen: boolean;
  t: TranslateFn;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  api: KeelLibraryApi | undefined;
  importMenuCopy: ImportMenuCopy;
  closeLibrary: () => Promise<void>;
  removeLibrary: () => Promise<void>;
  requestDeleteLibraryFromDisk: () => void;
  setDialogValue: Dispatch<SetStateAction<string>>;
  setCreateLibraryPhase: Dispatch<SetStateAction<CreateLibraryPhase>>;
  importAssets: (kind: "files" | "folder") => Promise<void>;
  importFolderAsLinked: (parentFolderId?: string | null) => Promise<void>;
  refreshRecentLibraries: (currentLibraryPath?: string | null) => Promise<void>;
  openRecentLibrary: (libraryPath: string) => Promise<void>;
  forgetRecentLibrary: (libraryPath: string) => Promise<void>;
  goWorkspaceBack: () => Promise<void>;
  goWorkspaceForward: () => Promise<void>;
  mainMenuSections: MainMenuSection[];
  workspaceTabsState: WorkspaceTabsState;
  workspaceTabPresentations: WorkspaceTabPresentation[];
  addWorkspaceTab: () => Promise<void>;
  closeWorkspaceTab: (tabId: string) => Promise<void>;
  selectWorkspaceTab: (tabId: string, options?: SelectWorkspaceTabOptions) => Promise<void>;
  moveWorkspaceTab: (tabId: string, toIndex: number) => void;
  openContextMenu: (descriptor: ContextMenuDescriptor, position: { x: number; y: number; }) => void;
  runSearch: (event?: FormEvent, opts?: { silent?: boolean; }) => Promise<void>;
  semanticSearchActive: boolean;
  searchHistory: string[];
  searchHistoryDismissedUntilInputRef: RefObject<boolean>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  publishSearchHistory: (queries: string[]) => void;
  embeddingSearchReady: boolean;
  embeddingService: EmbeddingHttpServiceSummary | null;
  rightOpen: boolean;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  shellApi: KeelShellApi | undefined;
}

/** Extracted from AppInner's returned tree (P4); renders the same elements. */
export function AppToolbar({ leftOpen, t, setLeftOpen, busy, api, importMenuCopy, closeLibrary, removeLibrary, requestDeleteLibraryFromDisk, setDialogValue, setCreateLibraryPhase, importAssets, importFolderAsLinked, refreshRecentLibraries, openRecentLibrary, forgetRecentLibrary, goWorkspaceBack, goWorkspaceForward, mainMenuSections, workspaceTabsState, workspaceTabPresentations, addWorkspaceTab, closeWorkspaceTab, selectWorkspaceTab, moveWorkspaceTab, openContextMenu, runSearch, semanticSearchActive, searchHistory, searchHistoryDismissedUntilInputRef, searchInputRef, publishSearchHistory, embeddingSearchReady, embeddingService, rightOpen, setRightOpen, shellApi }: AppToolbarProps) {
  const [library] = useSessionField("library");
  const setAppSettingsOpen = dialogsFields.setterFor("appSettingsOpen");
  const setLibrarySettingsOpen = dialogsFields.setterFor("librarySettingsOpen");
  const setDialog = dialogsFields.setterFor("dialog");
  const setExportDialogOpen = dialogsFields.setterFor("exportDialogOpen");
  const setOpenLibraryChooserOpen = dialogsFields.setterFor("openLibraryChooserOpen");
  const setImportLibraryChooserOpen = transfersFields.setterFor("importLibraryChooserOpen");
  const [navHistoryUi] = useWorkspaceField("navHistoryUi");
  const setAppSettingsCategory = dialogsFields.setterFor("appSettingsCategory");
  const [searchValue, setSearchValue] = useQueryField("searchValue");
  const [searchHistoryOpen, setSearchHistoryOpen] = useDialogField("searchHistoryOpen");
  const [searchHistoryActiveIndex, setSearchHistoryActiveIndex] = useQueryField("searchHistoryActiveIndex");
  const [embeddingIndex] = useEmbeddingField("embeddingIndex");
  return (
<header className="app-toolbar">
        <div className="toolbar-cluster toolbar-nav-cluster">
          <ToolButton
            icon={leftOpen ? "panel-left-close" : "panel-left"}
            label={leftOpen ? t("shell.collapseNav") : t("shell.expandNav")}
            onClick={() => setLeftOpen((v) => !v)}
            pressed={leftOpen}
          />
          <LibrarySwitcher
            busy={busy}
            disabled={!api}
            portaled
            importMenuCopy={importMenuCopy}
            libraryName={library?.displayName ?? null}
            libraryOpen={Boolean(library)}
            onCloseLibrary={() => void closeLibrary()}
            onRemoveLibrary={() => void removeLibrary()}
            onDeleteLibraryFromDisk={() => requestDeleteLibraryFromDisk()}
            onOpenLibrarySettings={() => {
              setAppSettingsOpen(false);
              setLibrarySettingsOpen(true);
            }}
            onCreateLibrary={() => {
              setDialogValue(t("shell.myLibrary"));
              setCreateLibraryPhase("form");
              setDialog("library");
            }}
            onExportLibrary={() => setExportDialogOpen(true)}
            onImportFolder={() => void importAssets("folder")}
            onImportLibrary={() => {
              setOpenLibraryChooserOpen(false);
              setImportLibraryChooserOpen(true);
            }}
            onImportLinkedFolder={() => void importFolderAsLinked()}
            onMenuOpen={() => void refreshRecentLibraries()}
            onOpenLibrary={() => {
              setImportLibraryChooserOpen(false);
              setOpenLibraryChooserOpen(true);
            }}
            onOpenRecent={(path) => void openRecentLibrary(path)}
            onForgetRecent={(path) => void forgetRecentLibrary(path)}
          />
        </div>
        <div className="toolbar-cluster toolbar-workspace-cluster">
          <div className="toolbar-workspace-main">
            <div className="toolbar-workspace-leading">
              <ScopeHistoryButtons
                // Serpent-b7e173：预览已是历史条目（打开查看器必压在某浏览 scope 上），
                // 所以后退/前进由纯历史驱动即可，无需对预览做任何特判。
                canBack={navHistoryUi.canBack}
                canForward={navHistoryUi.canForward}
                onBack={() => void goWorkspaceBack()}
                onForward={() => void goWorkspaceForward()}
              />
              {IS_WINDOWS_PLATFORM ? (
                <MainMenu disabled={busy} sections={mainMenuSections} />
              ) : (
                <AppSettingsEntry
                  disabled={busy}
                  onOpen={() => {
                    setAppSettingsCategory("general");
                    setAppSettingsOpen(true);
                  }}
                />
              )}
            </div>
            <WorkspaceTabs
              activeTabId={workspaceTabsState.activeTabId}
              disabled={!library || busy}
              tabs={workspaceTabPresentations}
              onAdd={() => void addWorkspaceTab()}
              onClose={(tabId) => void closeWorkspaceTab(tabId)}
              onSelect={(tabId) => {
                void selectWorkspaceTab(tabId);
              }}
              onReorder={(tabId, toIndex) => moveWorkspaceTab(tabId, toIndex)}
              onContextMenu={(tabId, position) => {
                const tab = workspaceTabPresentations.find(
                  (candidate) => candidate.id === tabId,
                );
                if (!tab) return;
                openContextMenu(
                  {
                    type: "workspace-tab",
                    tabId,
                    name: tab.title,
                    entity: tab.entity,
                    canClose: workspaceTabPresentations.length > 1,
                    canCloseOthers: workspaceTabPresentations.length > 1,
                  },
                  position,
                );
              }}
            />
          </div>
          <form
            className="toolbar-workspace-search"
            onSubmit={(event) => void runSearch(event)}
            role="search"
          >
            <div
              className={`search-control-wrap${searchValue.trim() ? " has-value" : ""}${semanticSearchActive ? " is-semantic" : ""}`}
            >
              <Icon name="search" size={15} />
              <input
                aria-activedescendant={
                  searchHistoryOpen && searchHistoryActiveIndex >= 0
                    ? `search-history-${searchHistoryActiveIndex}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls={searchHistoryOpen ? "search-history-list" : undefined}
                aria-expanded={
                  searchHistoryOpen &&
                  filterSearchHistory(searchHistory, searchValue).length > 0
                }
                aria-label={t("toolbar.searchLibrary")}
                className="search-control"
                disabled={!library}
                onBlur={() => {
                  setSearchHistoryOpen(false);
                  setSearchHistoryActiveIndex(-1);
                }}
                onChange={(event) => {
                  searchHistoryDismissedUntilInputRef.current = false;
                  setSearchValue(event.target.value);
                  setSearchHistoryActiveIndex(-1);
                  setSearchHistoryOpen(true);
                }}
                onFocus={() => {
                  if (searchHistoryDismissedUntilInputRef.current) return;
                  setSearchHistoryActiveIndex(-1);
                  setSearchHistoryOpen(true);
                }}
                onKeyDown={(event) => {
                  if (isImeKeyboardEvent(event)) return;
                  const matches = filterSearchHistory(searchHistory, searchValue);
                  const visibleCount = Math.min(
                    matches.length,
                    readVisibleSearchHistoryCount() ?? matches.length,
                  );
                  if (!searchHistoryOpen || visibleCount === 0) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    setSearchHistoryActiveIndex(-1);
                    return;
                  }
                  const direction = searchHistoryNavigationDirection(event.key);
                  if (direction) {
                    event.preventDefault();
                    setSearchHistoryActiveIndex((current) =>
                      moveSearchHistoryIndex(current, visibleCount, direction),
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                    return;
                  }
                  if (event.key === "Enter" && searchHistoryActiveIndex >= 0) {
                    const query = matches[searchHistoryActiveIndex];
                    if (!query) return;
                    event.preventDefault();
                    setSearchValue(query);
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                  }
                }}
                placeholder={t("toolbar.searchPlaceholder")}
                ref={searchInputRef}
                role="combobox"
                type="search"
                value={searchValue}
              />
              {searchHistoryOpen && library && (
                <SearchHistoryPopover
                  activeIndex={searchHistoryActiveIndex}
                  items={filterSearchHistory(searchHistory, searchValue)}
                  onClear={() => {
                    clearSearchHistory(window.localStorage, library.libraryId);
                    publishSearchHistory([]);
                    setSearchHistoryActiveIndex(-1);
                    setSearchHistoryOpen(false);
                  }}
                  onHighlight={setSearchHistoryActiveIndex}
                  onPick={(query) => {
                    setSearchValue(query);
                    setSearchHistoryOpen(false);
                    setSearchHistoryActiveIndex(-1);
                    publishSearchHistory(
                      rememberSearchQuery(window.localStorage, library.libraryId, query),
                    );
                  }}
                />
              )}
              <button
                aria-disabled={!library || !embeddingSearchReady}
                aria-label={t("toolbar.semanticSearch")}
                aria-pressed={semanticSearchActive}
                className={`search-semantic-toggle${semanticSearchActive ? " is-active" : ""}`}
                data-hover-tip={
                  !embeddingSearchReady
                    ? t("toolbar.semanticSearchNeedsSetup")
                    : embeddingIndex.phase === "starting" || embeddingIndex.phase === "indexing"
                      ? t("toolbar.semanticSearchIndexing")
                      : t(
                        embeddingService
                          ? "toolbar.semanticSearchHintText"
                          : "toolbar.semanticSearchHint",
                      )
                }
                disabled={!library}
                onClick={() => {
                  if (!embeddingSearchReady) return;
                  const current = loadSemanticSearchPreferences();
                  const active = current.searchMode === "semantic";
                  saveSemanticSearchPreferences({
                    version: 1,
                    enabled: current.enabled,
                    modelId: current.modelId,
                    searchMode: active ? "keyword" : "semantic",
                    pageSize: current.pageSize,
                  });
                  if (searchValue.trim()) void runSearch();
                }}
                type="button"
              >
                <Icon name="smart" size={13} />
              </button>
              <button
                aria-label={t("toolbar.searchSyntax")}
                className="search-syntax-help"
                data-hover-tip={t("toolbar.searchSyntaxHint")}
                data-hover-tip-variant="search-syntax"
                type="button"
              >
                ?
              </button>
              {searchValue.trim() !== "" && (
                <button
                  aria-label={t("toolbar.clearSearch")}
                  className="search-clear-btn"
                  disabled={!library}
                  onClick={() => setSearchValue("")}
                  type="button"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
              {searchValue.trim() !== "" && (() => {
                const result = parseSearchExpressionDetailed(searchValue);
                return result.ok ? null : (
                  <span className="search-expression-error" role="alert">
                    {t("toolbar.searchExpressionError", { position: result.diagnostic.start + 1, reason: t(`toolbar.searchExpressionReasons.${searchExpressionReasonKey(result.diagnostic.code)}`) })}
                  </span>
                );
              })()}
            </div>
          </form>
        </div>
        <div className="toolbar-cluster toolbar-inspector-cluster">
          <ToolButton
            icon={rightOpen ? "panel-right-close" : "panel-right"}
            label={
              rightOpen
                ? t("shell.collapseInspector")
                : t("shell.expandInspector")
            }
            onClick={() => setRightOpen((v) => !v)}
            pressed={rightOpen}
          />
        </div>
        {IS_WINDOWS_PLATFORM ? (
          <>
            <WindowsWindowControls shell={shellApi} />
            <WindowEdgeResizeHandles shell={shellApi} />
          </>
        ) : null}
      </header>
  );
}
