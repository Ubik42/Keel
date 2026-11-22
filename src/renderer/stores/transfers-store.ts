import { createFieldStore } from './create-field-store';
import { type ImportValidatedResult } from '../../shared/library-api';
import { type DeleteProgressEvent, type ExportProgressEvent, type ImageSequenceImportOffer, type ImportConflictPlan, type ImportProgressEvent, type ImportSourceFailurePlan, type SyncProgressEvent } from '../../shared/protocol/responses';
import { type BatchRelinkPreviewSession } from '../folders/RelinkPreview';
import { type ImageSequenceConfirmPurpose } from '../import/image-sequence-import-dialog';
import { type ImportConflictPhase } from '../import/import-conflict-flow';
import { type RememberedDuplicateDecision, type RememberedNameConflictDecision } from '../import/import-conflict-preferences';
import { type LibraryTransferKind } from '../library/library-transfer-progress';

export interface TransfersState {
  conflicts: ImportConflictPlan | null;
  importSourceFailurePlan: ImportSourceFailurePlan | null;
  importDecisionSubmitting: boolean;
  imageSequenceImportOffer: ImageSequenceImportOffer | null;
  imageSequenceImportIndex: number;
  imageSequenceImportError: string | null;
  imageSequenceImportSubmitting: boolean;
  imageSequenceConfirmPurpose: ImageSequenceConfirmPurpose;
  conflictPhase: ImportConflictPhase | null;
  duplicateDecision: RememberedDuplicateDecision;
  nameDecision: RememberedNameConflictDecision;
  rememberNameConflict: boolean;
  rememberDuplicate: boolean;
  batchRelinkPreview: BatchRelinkPreviewSession | null;
  batchRelinkKeepMetadata: boolean;
  exportProgress: ExportProgressEvent | null;
  importProgress: ImportProgressEvent | null;
  importRpcInFlight: boolean;
  importOverlayDismissed: boolean;
  importInterrupt: "abandon" | "stop" | null;
  deleteProgress: DeleteProgressEvent | null;
  libraryTransferKind: LibraryTransferKind;
  libraryTransferName: string;
  syncProgress: SyncProgressEvent | null;
  syncBindingStatus: "none" | "disabled" | "enabled";
  importValidated: ImportValidatedResult | null;
  importLibraryChooserOpen: boolean;
  // @fields
}

export const transfersFields = createFieldStore<TransfersState>(() => ({
    conflicts: null,
    importSourceFailurePlan: null,
    importDecisionSubmitting: false,
    imageSequenceImportOffer: null,
    imageSequenceImportIndex: 0,
    imageSequenceImportError: null,
    imageSequenceImportSubmitting: false,
    imageSequenceConfirmPurpose: "import",
    conflictPhase: null,
    duplicateDecision: "skip",
    nameDecision: "keep-both",
    rememberNameConflict: false,
    rememberDuplicate: false,
    batchRelinkPreview: null,
    batchRelinkKeepMetadata: true,
    exportProgress: null,
    importProgress: null,
    importRpcInFlight: false,
    importOverlayDismissed: false,
    importInterrupt: null,
    deleteProgress: null,
    libraryTransferKind: "import",
    libraryTransferName: "",
    syncProgress: null,
    syncBindingStatus: "none",
    importValidated: null,
    importLibraryChooserOpen: false,
    // @initial
}));

export const useTransfersField = transfersFields.useField;
