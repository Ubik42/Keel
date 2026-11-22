import { type PluginJobCheckpoint, type PluginJobHandlerCapabilities, type PluginJobItemResult, type PluginJobRecord, type PluginJobRecoveryStrategy } from "../../plugins/plugin-jobs";
import { type AssetMetadataResult, type AssetSummary, type FolderBrowseEntry, type GitignorePreview } from "../../shared/asset-types";
import { AUDIO_EXTENSION_NAMES, AUDIO_FORCED_WAVEFORM_GENERATOR_MARK, AUDIO_WAVEFORM_COVER_BACKGROUND, AUDIO_WAVEFORM_COVER_GENERATOR_TAG, AUDIO_WAVEFORM_COVER_HEIGHT, AUDIO_WAVEFORM_COVER_STROKE, AUDIO_WAVEFORM_COVER_WIDTH, AUDIO_WAVEFORM_VIEWER_HEIGHT, AUDIO_WAVEFORM_VIEWER_WIDTH, audioGridThumbnailNeedsRebuild, audioMimeForExtension, ffprobeHasAttachedPicture } from "../../shared/audio-media";
import { createAutomationFilePlanHash, createAutomationImportPlanHash } from "../../shared/automation-file-plan";
import { DOCUMENT_THUMBNAIL_GENERATOR_VERSION, DOCUMENT_THUMBNAIL_WIDTH, FONT_THUMBNAIL_GENERATOR_VERSION, FONT_THUMBNAIL_HEIGHT } from "../../shared/document-thumbnail-protocol";
import { type FontMetadata } from "../../shared/font-metadata";
import { gitignorePreviewCandidateKey, type GitignorePreviewCandidate } from "../../shared/gitignore-preview";
import { canOverrideImageColorSpace } from "../../shared/image-color-space";
import { DEFAULT_IMAGE_SEQUENCE_FPS, detectImageSequences, formatImageSequenceDisplayName, type ImageSequenceFrameCandidate } from "../../shared/image-sequence";
import { libraryMetaDir } from "../../shared/library-meta-dir";
import { collectLinkedDirectoryPrefixes } from "../../shared/linked-folder-tree";
import { DOCUMENT_EXTENSIONS, FONT_EXTENSIONS, IMAGE_EXTENSIONS, JPEG_IMAGE_EXTENSIONS, MODEL_EXTENSIONS, VIDEO_EXTENSIONS, directImageMimeForExtension, fontMimeForExtension, imageDecoderForExtension, imageViewerDecoderForExtension, isChromiumDirectPlayVideoExtension, isEmbeddedImageMetadataExtension, isRawImageExtension, modelMimeForExtension, videoMimeForExtension } from "../../shared/media-formats";
import { clampMediaJobListLimit, sliceMediaJobListPage, type MediaJobListCursor } from "../../shared/media-jobs";
import { MODEL_THUMBNAIL_GENERATOR_VERSION } from "../../shared/model-thumbnail-protocol";
import { mediaTypeSupportsAutoPalette } from "../../shared/palette-visibility";
import { SOURCE_DIRECT_IMAGE_EXTENSIONS, SOURCE_DIRECT_MAX_BYTES, SOURCE_DIRECT_MAX_LONG_EDGE_PX, SOURCE_DIRECT_MAX_PIXELS, isSourceDirectPreview, isSourceDirectPreviewCandidate } from "../../shared/preview-policy";
import { isDecoderMissingInputError } from "../../shared/protocol/errors";
import { type AutomationImportPlan, type ImageSequenceImportOffer, type ImportProgressEvent, type MissingAssetRecoveryProbe } from "../../shared/protocol/responses";
import { textMimeForExtension } from "../../shared/text-media";
import { VIEWPORT_CLAIM_ID_LIMIT, shouldFallbackViewportClaimToPersistentQueue, uniqueAssetIdsInOrder, viewportClaimRankOrderSql } from "../../shared/viewport-priority";
import { AUDIO_WAVEFORM_GENERATOR, EMBEDDED_IMAGE_METADATA_GENERATOR, FFMPEG_METADATA_GENERATOR, FFMPEG_VERSION, IMPORTED_ANIMATED_THUMBNAIL_GENERATOR, IMPORTED_THUMBNAIL_GENERATOR, JOB_SUMMARY_CACHE_ENABLED, KEEL_OCIO_CONFIG, LibraryService, LibraryServiceError, MEDIA_JOB_KINDS, MEDIA_JOB_LEASE_DURATION_MS, MEDIA_RESOURCE_RETRY_DELAY_MS, OIIO_VERSION, ORPHAN_ARTIFACT_GRACE_MS, OiioInvocationError, RAW_EMBEDDED_THUMBNAIL_GENERATOR, RAW_IMAGE_METADATA_MAX_ATTEMPTS, RAW_IMAGE_METADATA_RETRY_DELAY_MS, SHARP_THUMBNAIL_GENERATOR, SHARP_VERSION, StaleMediaRevisionError, THUMBNAIL_VISIBLE_PAGE_SIZE, VIDEO_PROXY_SCALE_FILTER, buildFileName, closeIgnoringFailure, databasePath, defaultMediaComponentProbe, embeddedImageMetadataExtensionMatchSql, hasRawMetadataBackfillStateSchema, inspectMediaNativeInput, isMissingPathError, isStaleMediaRevisionError, isTiffExtension, logMediaJobSummaryEvent, logMediaQueueEvent, oiioDecoderSemaphore, openConfiguredDatabase, pngBitDepth, rawImageExtensionMatchSql, readIcoPageSizesFromPath, readLibraryIdentity, realDirectoryExists, realFileExists, requireSharp, runSharpDecoder, safeMediaJobErrorDetail, serviceError, sha256FileAtPath, throwIfMediaExecutionAborted, type ArtifactDescriptor, type DatabaseConnection, type ExrPlaneDescriptor, type LibraryServiceOptions, type ManagedFolderRow, type MediaAutoRepairComponent, type MediaExecutionContext, type MediaJobKind, type MediaJobStatus, type ModelThumbnailRenderOutcome, type ModelThumbnailRenderer, type ModelThumbnailRendererInput, type OiioArtifactErrorCode, type OpenLibrary, type PaletteSharpModule, type RawMetadataBackfillAdmissionState, type SecondaryMediaJobKind, type SpawnResult, type VideoProbeResult, type VideoProxyProfile, waitForSharedMediaOperation, yieldBetweenMediaClaims } from "../library-service";
import { foldCatalogImageSequenceSummaries, readCatalogArtifactDescriptor, readCatalogThumbnailArtifacts } from "../library/catalog-read";
import { parseGitignore } from "../library/gitignore";
import { diffGitignoreHits } from "../library/gitignore-preview";
import { discoverSelectedImageSequenceFrames } from "../library/image-sequence-import-discovery";
import { ImportDestinationDirectoryCache } from "../library/import-destination-directory-cache";
import { columnsFor, hasTable, selectColumns } from "../library/lenient-columns";
import { normalizeAbsolutePath, normalizeAssetFileBaseName, portablePathIdentity, portablePathSegmentIdentity } from "../library/library-rules";
import { LibraryWriteCoordinator, LibraryWriteCoordinatorError, type AcquireLibraryWriteLeaseOptions, type LibraryChangeSubscription, type LibraryJobLease } from "../library/library-write-coordinator";
import { cancelPluginJobRecord, claimNextPluginJobRecord, completePluginJobRecord, enqueuePluginJobRecord, listPluginJobRecords, pausePluginJobRecord, pausePluginJobsForOwners as pausePluginJobRowsForOwners, reportPluginJobProgress as reportPluginJobProgressRow, resumePluginJobRecord, retryPluginJobRecord } from "../library/plugin-job-repository";
import { sqliteAllInChunks, sqliteInPlaceholders, sqliteRunInChunks, withSqliteInPredicate } from "../library/sqlite-in";
import { ArtifactDescriptorCache, type ArtifactDescriptorCacheMetrics } from "./artifact-descriptor-cache";
import { EXPLICIT_PROXY_FALLBACK_MARKER, admitArtifactJob, artifactIdentityForPersistedRow, artifactKindForJob, type ArtifactJobKind } from "./artifact-policy";
import { extractAuthorFromExif } from "./author-from-exif";
import { resolveFfmpegPath, resolveFfprobePath, resolveOiiotoolPath } from "./binary-resolver";
import { requeueRetryableFailedArtifacts } from "./derived-artifact-repair";
import { embeddedMetadataSearchText, normalizeProbeEmbeddedMetadata } from "./embedded-metadata";
import { fontSampleQuerySuffix, readFontMetadata } from "./font-file-metadata";
import { buildGifExtractedMetadata, type GifExtractedMetadata } from "./gif-metadata";
import { GIF_GOOD_PAGE_SCORE_THRESHOLD, GIF_THUMBNAIL_PROBE_SIZE, pickBestGifPage, sampleGifPageIndices, scoreRawRgbFrame } from "./gif-thumbnail-page";
import { pickLargestIcoPage } from "./ico-page";
import { hasPdfCompatibleIllustratorHeader } from "./illustrator-ai-format";
import { COMMON_IMAGE_COLOR_SPACE_OPTIONS, colorSpaceInfoFromName, defaultImageColorSpace, parseIccProfileDescription, parseOiioColorSpaceInfo, type ImageColorSpaceInfo, type ImageColorSpaceOption } from "./image-color-space";
import { readImageDimensions, readImageDimensionsSync } from "./image-dimensions";
import { IMPORTED_THUMBNAIL_GENERATOR_PREFIX, IMPORTED_THUMBNAIL_MAX_BYTES, IMPORTED_THUMBNAIL_MAX_EDGE, IMPORTED_THUMBNAIL_NORMALIZATION_JOB, IMPORTED_THUMBNAIL_PRESERVED_GENERATOR, importedThumbnailNeedsNormalization, isImportedThumbnailGenerator, isLegacyImportedThumbnailGenerator } from "./imported-thumbnail-policy";
import { workerMediaDecodeConcurrency, workerMediaDecodeWaveSize, workerMediaInteractiveDecodeConcurrency } from "./media-concurrency";
import { mediaJobCountTotal, mediaJobCountsFromRows } from "./media-job-status-summary";
import { estimateMediaNativeMemoryBytes, mediaNativeMemoryBudget, type MediaNativeMemoryEstimate } from "./media-memory-budget";
import { MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE, MediaResourceExhaustedError, asMediaResourceExhaustedError, mediaResourceFailureFromSpawnResult, mediaResourceGuard } from "./media-resource-guard";
import { resolveModelPreviewResolution } from "./model-resolution";
import { OIIO_LITERAL_PATHS_MARK, literalOiioArgs, oiioFailureCode, requeueLegacyOiioPathFailures } from "./oiio-invocation";
import { dominantColorMetrics, extractRepresentativePalette, type RepresentativeColor } from "./palette-extractor";
import { extractRawEmbeddedJpegThumbnail } from "./raw-embedded-thumbnail";
import { extractRawImageMetadata, extractRawImageMetadataDetailed, normalizeRawImageMetadata, resolvedExtractedPixelSize, type RawImageMetadata } from "./raw-image-metadata";
import { type RawMetadataBackfillProbeOutcome } from "./raw-metadata-backfill-gate";
import { VIDEO_POSTER_GENERATOR_TAG, durationSecondsFromProbeStdout, videoPosterGeneratorVersion, videoPosterSeekSeconds } from "./video-poster-seek";
import { encoderUsesHardwareName, ffmpegOneFrameEncodeArgs, listedH264ProxyEncoders, parseFfmpegEncoderTokens } from "./video-proxy-encoder";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { lstat as lstatAsync, opendir as opendirAsync, realpath as realpathAsync, rm as rmAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isBakeableStillImageFile } from "../../shared/bakeable-still-image";
import { isSupportedModelExtension } from "../../shared/media-formats";
import { type ModelCompanionAsset } from "../../shared/model-companions";
import { constrainFfmpegDecoderArgs, escapeFfmpegFilterPath, parseExrPlaneDescriptors } from "../library-service";
import { resolveBundledFontPath } from "./binary-resolver";
import { mediaFfmpegConcurrencyLimit, systemAvailablePhysicalMemoryBytes } from "./media-memory-concurrency";
import { queryModelCompanionAssets } from "./model-resolution";
import { rotateStillImageFile } from "./rotate-still-image-file";
import { extractedVideoMetadataSchema, type ExtractedMetadataResult, type ExtractedVideoMetadata } from "../../shared/asset-types";
import { fontMetadataToExtractedFields } from "./font-file-metadata";
import { listZipArchiveFiles, readZipArchiveEntry } from "./zip-archive-preview";

/** LibraryService methods defined in this module (PL). */
export interface MediaMethods {
  invalidateArtifactPathCache(...args: Parameters<typeof invalidateArtifactPathCache>): ReturnType<typeof invalidateArtifactPathCache>;
  mediaComponentAvailable(...args: Parameters<typeof mediaComponentAvailable>): ReturnType<typeof mediaComponentAvailable>;
  runOiio(...args: Parameters<typeof runOiio>): ReturnType<typeof runOiio>;
  probeCatalogIdentity(...args: Parameters<typeof probeCatalogIdentity>): ReturnType<typeof probeCatalogIdentity>;
  acquireJobLease(...args: Parameters<typeof acquireJobLease>): ReturnType<typeof acquireJobLease>;
  getChangeSequence(...args: Parameters<typeof getChangeSequence>): ReturnType<typeof getChangeSequence>;
  getBrowseChangeSequence(...args: Parameters<typeof getBrowseChangeSequence>): ReturnType<typeof getBrowseChangeSequence>;
  getRawMetadataBackfillAdmissionState(...args: Parameters<typeof getRawMetadataBackfillAdmissionState>): ReturnType<typeof getRawMetadataBackfillAdmissionState>;
  rawMetadataBackfillToken(...args: Parameters<typeof rawMetadataBackfillToken>): ReturnType<typeof rawMetadataBackfillToken>;
  rawMetadataBackfillPostTokenMatchesOwnWrites(...args: Parameters<typeof rawMetadataBackfillPostTokenMatchesOwnWrites>): ReturnType<typeof rawMetadataBackfillPostTokenMatchesOwnWrites>;
  persistRawMetadataBackfillAdmissionState(...args: Parameters<typeof persistRawMetadataBackfillAdmissionState>): ReturnType<typeof persistRawMetadataBackfillAdmissionState>;
  subscribeToChangeSequence(...args: Parameters<typeof subscribeToChangeSequence>): ReturnType<typeof subscribeToChangeSequence>;
  previewAutomationFileOperation(...args: Parameters<typeof previewAutomationFileOperation>): ReturnType<typeof previewAutomationFileOperation>;
  expandImageSequenceSourcePaths(...args: Parameters<typeof expandImageSequenceSourcePaths>): ReturnType<typeof expandImageSequenceSourcePaths>;
  probeImageSequenceImportOffer(...args: Parameters<typeof probeImageSequenceImportOffer>): ReturnType<typeof probeImageSequenceImportOffer>;
  linkedDirectoryCoverArtifactIds(...args: Parameters<typeof linkedDirectoryCoverArtifactIds>): ReturnType<typeof linkedDirectoryCoverArtifactIds>;
  withSequenceFolderCovers(...args: Parameters<typeof withSequenceFolderCovers>): ReturnType<typeof withSequenceFolderCovers>;
  folderCoverArtifactMap(...args: Parameters<typeof folderCoverArtifactMap>): ReturnType<typeof folderCoverArtifactMap>;
  insertImageSequence(...args: Parameters<typeof insertImageSequence>): ReturnType<typeof insertImageSequence>;
  cancelHiddenSequenceMemberMediaJobs(...args: Parameters<typeof cancelHiddenSequenceMemberMediaJobs>): ReturnType<typeof cancelHiddenSequenceMemberMediaJobs>;
  repairUndisplayablePngThumbnails(...args: Parameters<typeof repairUndisplayablePngThumbnails>): ReturnType<typeof repairUndisplayablePngThumbnails>;
  cancelQueuedHiddenSequenceMemberJobs(...args: Parameters<typeof cancelQueuedHiddenSequenceMemberJobs>): ReturnType<typeof cancelQueuedHiddenSequenceMemberJobs>;
  dissolveImageSequencesForAssets(...args: Parameters<typeof dissolveImageSequencesForAssets>): ReturnType<typeof dissolveImageSequencesForAssets>;
  createDetectedImageSequences(...args: Parameters<typeof createDetectedImageSequences>): ReturnType<typeof createDetectedImageSequences>;
  imageDimensionsForAsset(...args: Parameters<typeof imageDimensionsForAsset>): ReturnType<typeof imageDimensionsForAsset>;
  imageDimensionsForAssetAsync(...args: Parameters<typeof imageDimensionsForAssetAsync>): ReturnType<typeof imageDimensionsForAssetAsync>;
  withImageSequenceSummaries(...args: Parameters<typeof withImageSequenceSummaries>): ReturnType<typeof withImageSequenceSummaries>;
  createImageSequence(...args: Parameters<typeof createImageSequence>): ReturnType<typeof createImageSequence>;
  dissolveImageSequence(...args: Parameters<typeof dissolveImageSequence>): ReturnType<typeof dissolveImageSequence>;
  dissolveImageSequences(...args: Parameters<typeof dissolveImageSequences>): ReturnType<typeof dissolveImageSequences>;
  setImageSequenceFps(...args: Parameters<typeof setImageSequenceFps>): ReturnType<typeof setImageSequenceFps>;
  resolvedPaletteFields(...args: Parameters<typeof resolvedPaletteFields>): ReturnType<typeof resolvedPaletteFields>;
  aggregateRecentAssetPalette(...args: Parameters<typeof aggregateRecentAssetPalette>): ReturnType<typeof aggregateRecentAssetPalette>;
  setAssetColorSpaceOverride(...args: Parameters<typeof setAssetColorSpaceOverride>): ReturnType<typeof setAssetColorSpaceOverride>;
  backfillAuthorFromExif(...args: Parameters<typeof backfillAuthorFromExif>): ReturnType<typeof backfillAuthorFromExif>;
  getPluginMediaProviderAsset(...args: Parameters<typeof getPluginMediaProviderAsset>): ReturnType<typeof getPluginMediaProviderAsset>;
  recoverInterruptedThumbnailJobs(...args: Parameters<typeof recoverInterruptedThumbnailJobs>): ReturnType<typeof recoverInterruptedThumbnailJobs>;
  retireLegacyGifProxyJobs(...args: Parameters<typeof retireLegacyGifProxyJobs>): ReturnType<typeof retireLegacyGifProxyJobs>;
  pauseJobs(...args: Parameters<typeof pauseJobs>): ReturnType<typeof pauseJobs>;
  resumeJobs(...args: Parameters<typeof resumeJobs>): ReturnType<typeof resumeJobs>;
  cancelJobs(...args: Parameters<typeof cancelJobs>): ReturnType<typeof cancelJobs>;
  retryJobs(...args: Parameters<typeof retryJobs>): ReturnType<typeof retryJobs>;
  _updateJobStatus(...args: Parameters<typeof _updateJobStatus>): ReturnType<typeof _updateJobStatus>;
  enqueuePluginJob(...args: Parameters<typeof enqueuePluginJob>): ReturnType<typeof enqueuePluginJob>;
  listPluginJobs(...args: Parameters<typeof listPluginJobs>): ReturnType<typeof listPluginJobs>;
  claimNextPluginJob(...args: Parameters<typeof claimNextPluginJob>): ReturnType<typeof claimNextPluginJob>;
  completePluginJob(...args: Parameters<typeof completePluginJob>): ReturnType<typeof completePluginJob>;
  controlPluginJob(...args: Parameters<typeof controlPluginJob>): ReturnType<typeof controlPluginJob>;
  reportPluginJobProgress(...args: Parameters<typeof reportPluginJobProgress>): ReturnType<typeof reportPluginJobProgress>;
  pausePluginJobsForOwners(...args: Parameters<typeof pausePluginJobsForOwners>): ReturnType<typeof pausePluginJobsForOwners>;
  mediaJobSummaryToken(...args: Parameters<typeof mediaJobSummaryToken>): ReturnType<typeof mediaJobSummaryToken>;
  hasMediaJobStatusCountsTable(...args: Parameters<typeof hasMediaJobStatusCountsTable>): ReturnType<typeof hasMediaJobStatusCountsTable>;
  readMediaJobStatusCountsTable(...args: Parameters<typeof readMediaJobStatusCountsTable>): ReturnType<typeof readMediaJobStatusCountsTable>;
  hasQueuedPrimaryPreviewJobs(...args: Parameters<typeof hasQueuedPrimaryPreviewJobs>): ReturnType<typeof hasQueuedPrimaryPreviewJobs>;
  listMediaJobs(...args: Parameters<typeof listMediaJobs>): ReturnType<typeof listMediaJobs>;
  pauseMediaJobs(...args: Parameters<typeof pauseMediaJobs>): ReturnType<typeof pauseMediaJobs>;
  resumeMediaJobs(...args: Parameters<typeof resumeMediaJobs>): ReturnType<typeof resumeMediaJobs>;
  cancelMediaJobs(...args: Parameters<typeof cancelMediaJobs>): ReturnType<typeof cancelMediaJobs>;
  retryMediaJobs(...args: Parameters<typeof retryMediaJobs>): ReturnType<typeof retryMediaJobs>;
  updateMediaJobStatus(...args: Parameters<typeof updateMediaJobStatus>): ReturnType<typeof updateMediaJobStatus>;
  abortActiveMediaJobs(...args: Parameters<typeof abortActiveMediaJobs>): ReturnType<typeof abortActiveMediaJobs>;
  interruptThumbnailJobsOutsideViewport(...args: Parameters<typeof interruptThumbnailJobsOutsideViewport>): ReturnType<typeof interruptThumbnailJobsOutsideViewport>;
  cancelMediaJobsForAssets(...args: Parameters<typeof cancelMediaJobsForAssets>): ReturnType<typeof cancelMediaJobsForAssets>;
  drainLibraryMedia(...args: Parameters<typeof drainLibraryMedia>): ReturnType<typeof drainLibraryMedia>;
  mediaJobState(...args: Parameters<typeof mediaJobState>): ReturnType<typeof mediaJobState>;
  mediaArtifactSnapshot(...args: Parameters<typeof mediaArtifactSnapshot>): ReturnType<typeof mediaArtifactSnapshot>;
  discardLateMediaArtifacts(...args: Parameters<typeof discardLateMediaArtifacts>): ReturnType<typeof discardLateMediaArtifacts>;
  assetBelongsToImageSequence(...args: Parameters<typeof assetBelongsToImageSequence>): ReturnType<typeof assetBelongsToImageSequence>;
  artifactsDir(...args: Parameters<typeof artifactsDir>): ReturnType<typeof artifactsDir>;
  setPluginThumbnailExtensions(...args: Parameters<typeof setPluginThumbnailExtensions>): ReturnType<typeof setPluginThumbnailExtensions>;
  claimsPluginThumbnail(...args: Parameters<typeof claimsPluginThumbnail>): ReturnType<typeof claimsPluginThumbnail>;
  thumbnailEligible(...args: Parameters<typeof thumbnailEligible>): ReturnType<typeof thumbnailEligible>;
  filterVisibleThumbnailAssetIds(...args: Parameters<typeof filterVisibleThumbnailAssetIds>): ReturnType<typeof filterVisibleThumbnailAssetIds>;
  generateThumbnail(...args: Parameters<typeof generateThumbnail>): ReturnType<typeof generateThumbnail>;
  processModelThumbnailJob(...args: Parameters<typeof processModelThumbnailJob>): ReturnType<typeof processModelThumbnailJob>;
  writeModelThumbnailArtifact(...args: Parameters<typeof writeModelThumbnailArtifact>): ReturnType<typeof writeModelThumbnailArtifact>;
  writeModelThumbnailFailure(...args: Parameters<typeof writeModelThumbnailFailure>): ReturnType<typeof writeModelThumbnailFailure>;
  generatePdfThumbnail(...args: Parameters<typeof generatePdfThumbnail>): ReturnType<typeof generatePdfThumbnail>;
  readAssetFontMetadata(...args: Parameters<typeof readAssetFontMetadata>): ReturnType<typeof readAssetFontMetadata>;
  generateHtmlThumbnail(...args: Parameters<typeof generateHtmlThumbnail>): ReturnType<typeof generateHtmlThumbnail>;
  normalizeImportedThumbnailArtifact(...args: Parameters<typeof normalizeImportedThumbnailArtifact>): ReturnType<typeof normalizeImportedThumbnailArtifact>;
  generateImageThumbnail(...args: Parameters<typeof generateImageThumbnail>): ReturnType<typeof generateImageThumbnail>;
  tryGenerateTruncatedJpegThumbnail(...args: Parameters<typeof tryGenerateTruncatedJpegThumbnail>): ReturnType<typeof tryGenerateTruncatedJpegThumbnail>;
  backfillMissingImageDimensions(...args: Parameters<typeof backfillMissingImageDimensions>): ReturnType<typeof backfillMissingImageDimensions>;
  persistVisibleWindowImageDimensions(...args: Parameters<typeof persistVisibleWindowImageDimensions>): ReturnType<typeof persistVisibleWindowImageDimensions>;
  persistVisibleWindowImageDimensionsAsync(...args: Parameters<typeof persistVisibleWindowImageDimensionsAsync>): ReturnType<typeof persistVisibleWindowImageDimensionsAsync>;
  persistSourceImageDimensionsForAssets(...args: Parameters<typeof persistSourceImageDimensionsForAssets>): ReturnType<typeof persistSourceImageDimensionsForAssets>;
  persistSourceImageDimensions(...args: Parameters<typeof persistSourceImageDimensions>): ReturnType<typeof persistSourceImageDimensions>;
  persistExtractedImageDimensions(...args: Parameters<typeof persistExtractedImageDimensions>): ReturnType<typeof persistExtractedImageDimensions>;
  persistGifExtractedMetadata(...args: Parameters<typeof persistGifExtractedMetadata>): ReturnType<typeof persistGifExtractedMetadata>;
  setAudioPreviewPrefersCover(...args: Parameters<typeof setAudioPreviewPrefersCover>): ReturnType<typeof setAudioPreviewPrefersCover>;
  generateAudioArtifacts(...args: Parameters<typeof generateAudioArtifacts>): ReturnType<typeof generateAudioArtifacts>;
  generateAudioAlbumCoverThumbnail(...args: Parameters<typeof generateAudioAlbumCoverThumbnail>): ReturnType<typeof generateAudioAlbumCoverThumbnail>;
  generateAudioWaveformPng(...args: Parameters<typeof generateAudioWaveformPng>): ReturnType<typeof generateAudioWaveformPng>;
  generateVideoArtifacts(...args: Parameters<typeof generateVideoArtifacts>): ReturnType<typeof generateVideoArtifacts>;
  enqueueVideoMetadataJob(...args: Parameters<typeof enqueueVideoMetadataJob>): ReturnType<typeof enqueueVideoMetadataJob>;
  requeueRawImageMetadataJobs(...args: Parameters<typeof requeueRawImageMetadataJobs>): ReturnType<typeof requeueRawImageMetadataJobs>;
  requeueRawImageMetadataBackfillRetries(...args: Parameters<typeof requeueRawImageMetadataBackfillRetries>): ReturnType<typeof requeueRawImageMetadataBackfillRetries>;
  requeueNonPositiveExtractedImageDimensions(...args: Parameters<typeof requeueNonPositiveExtractedImageDimensions>): ReturnType<typeof requeueNonPositiveExtractedImageDimensions>;
  enqueueRawImageMetadataJobs(...args: Parameters<typeof enqueueRawImageMetadataJobs>): ReturnType<typeof enqueueRawImageMetadataJobs>;
  enqueueRawImageMetadataBackfill(...args: Parameters<typeof enqueueRawImageMetadataBackfill>): ReturnType<typeof enqueueRawImageMetadataBackfill>;
  rawImageMetadataRetryDelayMs(...args: Parameters<typeof rawImageMetadataRetryDelayMs>): ReturnType<typeof rawImageMetadataRetryDelayMs>;
  enqueuePaletteJob(...args: Parameters<typeof enqueuePaletteJob>): ReturnType<typeof enqueuePaletteJob>;
  isPaletteEligibleAsset(...args: Parameters<typeof isPaletteEligibleAsset>): ReturnType<typeof isPaletteEligibleAsset>;
  generateQueuedPaletteArtifact(...args: Parameters<typeof generateQueuedPaletteArtifact>): ReturnType<typeof generateQueuedPaletteArtifact>;
  ensureVideoContactSheet(...args: Parameters<typeof ensureVideoContactSheet>): ReturnType<typeof ensureVideoContactSheet>;
  generateQueuedVideoArtifact(...args: Parameters<typeof generateQueuedVideoArtifact>): ReturnType<typeof generateQueuedVideoArtifact>;
  generateQueuedVideoMetadata(...args: Parameters<typeof generateQueuedVideoMetadata>): ReturnType<typeof generateQueuedVideoMetadata>;
  readReadyVideoMetadataForRevision(...args: Parameters<typeof readReadyVideoMetadataForRevision>): ReturnType<typeof readReadyVideoMetadataForRevision>;
  probeVideoMetadataForRevision(...args: Parameters<typeof probeVideoMetadataForRevision>): ReturnType<typeof probeVideoMetadataForRevision>;
  generateQueuedRawImageMetadata(...args: Parameters<typeof generateQueuedRawImageMetadata>): ReturnType<typeof generateQueuedRawImageMetadata>;
  generateQueuedAudioProxy(...args: Parameters<typeof generateQueuedAudioProxy>): ReturnType<typeof generateQueuedAudioProxy>;
  probeVideoAsset(...args: Parameters<typeof probeVideoAsset>): ReturnType<typeof probeVideoAsset>;
  probeVideoDurationSeconds(...args: Parameters<typeof probeVideoDurationSeconds>): ReturnType<typeof probeVideoDurationSeconds>;
  generateVideoPoster(...args: Parameters<typeof generateVideoPoster>): ReturnType<typeof generateVideoPoster>;
  countVideoKeyframes(...args: Parameters<typeof countVideoKeyframes>): ReturnType<typeof countVideoKeyframes>;
  h264VideoProxyProfile(...args: Parameters<typeof h264VideoProxyProfile>): ReturnType<typeof h264VideoProxyProfile>;
  probeVideoProxyEncoder(...args: Parameters<typeof probeVideoProxyEncoder>): ReturnType<typeof probeVideoProxyEncoder>;
  resolveVideoProxyProfiles(...args: Parameters<typeof resolveVideoProxyProfiles>): ReturnType<typeof resolveVideoProxyProfiles>;
  generateVideoProxy(...args: Parameters<typeof generateVideoProxy>): ReturnType<typeof generateVideoProxy>;
  generateAudioProxy(...args: Parameters<typeof generateAudioProxy>): ReturnType<typeof generateAudioProxy>;
  tryGenerateRawEmbeddedThumbnail(...args: Parameters<typeof tryGenerateRawEmbeddedThumbnail>): ReturnType<typeof tryGenerateRawEmbeddedThumbnail>;
  generateOiiOThumbnail(...args: Parameters<typeof generateOiiOThumbnail>): ReturnType<typeof generateOiiOThumbnail>;
  persistRawImageMetadata(...args: Parameters<typeof persistRawImageMetadata>): ReturnType<typeof persistRawImageMetadata>;
  writeFailedArtifact(...args: Parameters<typeof writeFailedArtifact>): ReturnType<typeof writeFailedArtifact>;
  getThumbnailArtifact(...args: Parameters<typeof getThumbnailArtifact>): ReturnType<typeof getThumbnailArtifact>;
  writePluginMediaArtifact(...args: Parameters<typeof writePluginMediaArtifact>): ReturnType<typeof writePluginMediaArtifact>;
  writeDerivedArtifact(...args: Parameters<typeof writeDerivedArtifact>): ReturnType<typeof writeDerivedArtifact>;
  getCurrentArtifact(...args: Parameters<typeof getCurrentArtifact>): ReturnType<typeof getCurrentArtifact>;
  getArtifactDescriptorCacheMetrics(...args: Parameters<typeof getArtifactDescriptorCacheMetrics>): ReturnType<typeof getArtifactDescriptorCacheMetrics>;
  resetArtifactDescriptorCacheMetrics(...args: Parameters<typeof resetArtifactDescriptorCacheMetrics>): ReturnType<typeof resetArtifactDescriptorCacheMetrics>;
  ensureRawViewerImage(...args: Parameters<typeof ensureRawViewerImage>): ReturnType<typeof ensureRawViewerImage>;
  generateIcoViewerImage(...args: Parameters<typeof generateIcoViewerImage>): ReturnType<typeof generateIcoViewerImage>;
  ensureIcoViewerImage(...args: Parameters<typeof ensureIcoViewerImage>): ReturnType<typeof ensureIcoViewerImage>;
  getImageColorSpace(...args: Parameters<typeof getImageColorSpace>): ReturnType<typeof getImageColorSpace>;
  getColorSpaceOverride(...args: Parameters<typeof getColorSpaceOverride>): ReturnType<typeof getColorSpaceOverride>;
  resolvePreviewArtifact(...args: Parameters<typeof resolvePreviewArtifact>): ReturnType<typeof resolvePreviewArtifact>;
  getPreviewArtifact(...args: Parameters<typeof getPreviewArtifact>): ReturnType<typeof getPreviewArtifact>;
  enqueueArtifactRetry(...args: Parameters<typeof enqueueArtifactRetry>): ReturnType<typeof enqueueArtifactRetry>;
  getArtifactAbsolutePath(...args: Parameters<typeof getArtifactAbsolutePath>): ReturnType<typeof getArtifactAbsolutePath>;
  getArtifactAbsolutePaths(...args: Parameters<typeof getArtifactAbsolutePaths>): ReturnType<typeof getArtifactAbsolutePaths>;
  assertArtifactUsage(...args: Parameters<typeof assertArtifactUsage>): ReturnType<typeof assertArtifactUsage>;
  validateCachedArtifactPath(...args: Parameters<typeof validateCachedArtifactPath>): ReturnType<typeof validateCachedArtifactPath>;
  artifactFilePathFromRow(...args: Parameters<typeof artifactFilePathFromRow>): ReturnType<typeof artifactFilePathFromRow>;
  artifactRootPath(...args: Parameters<typeof artifactRootPath>): ReturnType<typeof artifactRootPath>;
  artifactRootPathAsync(...args: Parameters<typeof artifactRootPathAsync>): ReturnType<typeof artifactRootPathAsync>;
  artifactFilePathFromRoot(...args: Parameters<typeof artifactFilePathFromRoot>): ReturnType<typeof artifactFilePathFromRoot>;
  artifactFilePathFromRootAsync(...args: Parameters<typeof artifactFilePathFromRootAsync>): ReturnType<typeof artifactFilePathFromRootAsync>;
  getCurrentMediaSource(...args: Parameters<typeof getCurrentMediaSource>): ReturnType<typeof getCurrentMediaSource>;
  getCurrentVideoSource(...args: Parameters<typeof getCurrentVideoSource>): ReturnType<typeof getCurrentVideoSource>;
  enqueueReadyPaletteJobs(...args: Parameters<typeof enqueueReadyPaletteJobs>): ReturnType<typeof enqueueReadyPaletteJobs>;
  reconcileMissingArtifactFiles(...args: Parameters<typeof reconcileMissingArtifactFiles>): ReturnType<typeof reconcileMissingArtifactFiles>;
  reconcileOrphanArtifactFiles(...args: Parameters<typeof reconcileOrphanArtifactFiles>): ReturnType<typeof reconcileOrphanArtifactFiles>;
  networkMetadataBrowseChangeSequence(...args: Parameters<typeof networkMetadataBrowseChangeSequence>): ReturnType<typeof networkMetadataBrowseChangeSequence>;
  enqueueFailedMediaRepairs(...args: Parameters<typeof enqueueFailedMediaRepairs>): ReturnType<typeof enqueueFailedMediaRepairs>;
  primaryArtifactGeneratorIsCurrent(...args: Parameters<typeof primaryArtifactGeneratorIsCurrent>): ReturnType<typeof primaryArtifactGeneratorIsCurrent>;
  invalidateStalePrimaryArtifacts(...args: Parameters<typeof invalidateStalePrimaryArtifacts>): ReturnType<typeof invalidateStalePrimaryArtifacts>;
  enqueueImportedThumbnailNormalizationJob(...args: Parameters<typeof enqueueImportedThumbnailNormalizationJob>): ReturnType<typeof enqueueImportedThumbnailNormalizationJob>;
  enqueueImportedThumbnailNormalizationJobs(...args: Parameters<typeof enqueueImportedThumbnailNormalizationJobs>): ReturnType<typeof enqueueImportedThumbnailNormalizationJobs>;
  enqueueThumbnailJobs(...args: Parameters<typeof enqueueThumbnailJobs>): ReturnType<typeof enqueueThumbnailJobs>;
  requeueLegacyRawColorTransformFailures(...args: Parameters<typeof requeueLegacyRawColorTransformFailures>): ReturnType<typeof requeueLegacyRawColorTransformFailures>;
  processThumbnailQueue(...args: Parameters<typeof processThumbnailQueue>): ReturnType<typeof processThumbnailQueue>;
  thumbnailArtifactMap(...args: Parameters<typeof thumbnailArtifactMap>): ReturnType<typeof thumbnailArtifactMap>;
  thumbnailStatusMap(...args: Parameters<typeof thumbnailStatusMap>): ReturnType<typeof thumbnailStatusMap>;
  probeMissingAssetRecovery(...args: Parameters<typeof probeMissingAssetRecovery>): ReturnType<typeof probeMissingAssetRecovery>;
  textAssetPreviewCacheKey(...args: Parameters<typeof textAssetPreviewCacheKey>): ReturnType<typeof textAssetPreviewCacheKey>;
  readCachedTextAssetPreview(...args: Parameters<typeof readCachedTextAssetPreview>): ReturnType<typeof readCachedTextAssetPreview>;
  cacheTextAssetPreview(...args: Parameters<typeof cacheTextAssetPreview>): ReturnType<typeof cacheTextAssetPreview>;
  invalidateTextAssetPreviewCache(...args: Parameters<typeof invalidateTextAssetPreviewCache>): ReturnType<typeof invalidateTextAssetPreviewCache>;
  clearTextAssetPreviewCache(...args: Parameters<typeof clearTextAssetPreviewCache>): ReturnType<typeof clearTextAssetPreviewCache>;
  expandAssetIdsToSequenceMembers(...args: Parameters<typeof expandAssetIdsToSequenceMembers>): ReturnType<typeof expandAssetIdsToSequenceMembers>;
  previewRestoreAssets(...args: Parameters<typeof previewRestoreAssets>): ReturnType<typeof previewRestoreAssets>;
  trashedFolderCoverArtifactMap(...args: Parameters<typeof trashedFolderCoverArtifactMap>): ReturnType<typeof trashedFolderCoverArtifactMap>;
  relinkBatchPreview(...args: Parameters<typeof relinkBatchPreview>): ReturnType<typeof relinkBatchPreview>;
  previewGitignore(...args: Parameters<typeof previewGitignore>): ReturnType<typeof previewGitignore>;
  collectGitignorePreviewCandidates(...args: Parameters<typeof collectGitignorePreviewCandidates>): ReturnType<typeof collectGitignorePreviewCandidates>;
  previewAutomationImport(...args: Parameters<typeof previewAutomationImport>): ReturnType<typeof previewAutomationImport>;
  nextImportProgressSequence(...args: Parameters<typeof nextImportProgressSequence>): ReturnType<typeof nextImportProgressSequence>;

  runFfmpeg(...args: Parameters<typeof runFfmpeg>): ReturnType<typeof runFfmpeg>;
  availablePhysicalMemoryBytes(...args: Parameters<typeof availablePhysicalMemoryBytes>): ReturnType<typeof availablePhysicalMemoryBytes>;
  rotateImageContent(...args: Parameters<typeof rotateImageContent>): ReturnType<typeof rotateImageContent>;
  generateContactSheet(...args: Parameters<typeof generateContactSheet>): ReturnType<typeof generateContactSheet>;
  getExrPlanes(...args: Parameters<typeof getExrPlanes>): ReturnType<typeof getExrPlanes>;
  resolveModelCompanions(...args: Parameters<typeof resolveModelCompanions>): ReturnType<typeof resolveModelCompanions>;

  getExtractedMetadata(...args: Parameters<typeof getExtractedMetadata>): ReturnType<typeof getExtractedMetadata>;

  listZipEntries(...args: Parameters<typeof listZipEntries>): ReturnType<typeof listZipEntries>;
  readZipEntry(...args: Parameters<typeof readZipEntry>): ReturnType<typeof readZipEntry>;
}

export function invalidateArtifactPathCache(this: LibraryService, libraryId: string): void {
  const prefix = `${libraryId}\u0000`;
  for (const key of this.artifactPathCache.keys()) {
    if (key.startsWith(prefix)) this.artifactPathCache.delete(key);
  }
}

export function mediaComponentAvailable(this: LibraryService, component: MediaAutoRepairComponent): boolean {
  try {
    return this.options.mediaComponentProbe?.(component)
      ?? defaultMediaComponentProbe(component);
  } catch (error) {
    this.diagnose('media-component.probe', error, { component });
    return false;
  }
}

export function runOiio(this: LibraryService, command: string, args: string[], options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      memory?: Omit<MediaNativeMemoryEstimate, 'decoder'>;
    } = {}): Promise<SpawnResult> {
  const { memory, ...spawnOptions } = options;
  const memoryBytes = estimateMediaNativeMemoryBytes({ decoder: 'oiio', ...memory });
  return mediaNativeMemoryBudget.run(
    spawnOptions.signal,
    memoryBytes,
    () => oiioDecoderSemaphore.run(
      spawnOptions.signal,
      async () => {
        try {
          const result = await this.spawnFn(command, literalOiioArgs(args), spawnOptions);
          if (mediaResourceFailureFromSpawnResult(result)) {
            throw asMediaResourceExhaustedError(result, 'oiio')
              ?? new Error('OpenImageIO reported native resource pressure.');
          }
          return result;
        } catch (error) {
          throw asMediaResourceExhaustedError(error, 'oiio') ?? error;
        }
      },
    ),
  );
}

export function probeCatalogIdentity(this: LibraryService, canonicalPath: string): string | undefined {
  let probe: DatabaseConnection | undefined;
  try {
    probe = openConfiguredDatabase(
      databasePath(canonicalPath),
      this.options.sqliteBusyTimeoutMsForTests,
      { readonly: true },
    );
    return readLibraryIdentity(probe, { skipQuickCheck: true }).library_id;
  } catch {
    return undefined;
  } finally {
    closeIgnoringFailure(probe);
  }
}

/**
* Claim a long-running Job with a durable owner/fencing token. The caller
* must heartbeat while external work is in progress and assert ownership
* before every persisted state transition.
*/
export function acquireJobLease(this: LibraryService, libraryId: string, jobId: string, options?: AcquireLibraryWriteLeaseOptions): Promise<LibraryJobLease> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return new LibraryWriteCoordinator(openLibrary.writeConnection, libraryId).claimJob(jobId, options);
}

/** Return the durable mutation sequence for cross-process refresh cursors. */
export function getChangeSequence(this: LibraryService, libraryId: string): number {
  const openLibrary = this.requireOpenLibrary(libraryId);
  try {
    return new LibraryWriteCoordinator(openLibrary.writeConnection, libraryId).currentChangeSequence();
  } catch (error) {
    throw serviceError(error, 'LIBRARY_CORRUPT');
  }
}

/**
* Browse-only invalidation fence. Job progress and artifact commits use the
* broad library sequence, but they must not make an active BrowseSession
* stale while the user is scrolling through the same ordered scope.
*/
export function getBrowseChangeSequence(this: LibraryService, libraryId: string): number {
  const openLibrary = this.requireOpenLibrary(libraryId);
  try {
    const row = openLibrary.connection
      .prepare(
        'SELECT sequence FROM browse_change_sequence WHERE library_id = ?',
      )
      .get(libraryId) as { sequence: number } | undefined;
    if (!row || !Number.isSafeInteger(row.sequence) || row.sequence < 0) {
      throw new Error('The browse change sequence is missing or invalid.');
    }
    return row.sequence;
  } catch (error) {
    throw serviceError(error, 'LIBRARY_CORRUPT');
  }
}

/**
* Return the durable RAW metadata admission cursor for Worker restart
* recovery.  Older/leniently opened libraries simply have no state row and
* fall back to the bounded probe path.
*/
export function getRawMetadataBackfillAdmissionState(this: LibraryService, libraryId: string): RawMetadataBackfillAdmissionState | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (!hasRawMetadataBackfillStateSchema(openLibrary.connection)) {
    return null;
  }
  const row = openLibrary.connection
    .prepare(
      `SELECT token, cursor_asset_id, exhausted, updated_at
         FROM raw_metadata_backfill_state
        WHERE library_id = ?`,
    )
    .get(libraryId) as {
      token: string;
      cursor_asset_id: string | null;
      exhausted: number;
      updated_at: string;
    } | undefined;
  if (!row || row.token.length === 0) return null;
  return {
    token: row.token,
    cursorAssetId: row.cursor_asset_id,
    exhausted: row.exhausted === 1,
    updatedAt: row.updated_at,
  };
}

export function rawMetadataBackfillToken(this: LibraryService, openLibrary: OpenLibrary): string | null {
  try {
    const browse = openLibrary.connection
      .prepare('SELECT sequence FROM browse_change_sequence WHERE library_id = ?')
      .get(openLibrary.summary.libraryId) as { sequence: number } | undefined;
    if (
      !browse
      || !Number.isSafeInteger(browse.sequence)
      || browse.sequence < 0
    ) return null;
    return String(browse.sequence);
  } catch {
    return null;
  }
}

export function rawMetadataBackfillPostTokenMatchesOwnWrites(this: LibraryService, beforeToken: string | null, afterToken: string): boolean {
  // Job status/insert writes do not advance browse_change_sequence. An exact
  // equality check therefore accepts our own queue writes while rejecting a
  // concurrent catalog or ignore-rule mutation.
  return beforeToken !== null && beforeToken === afterToken;
}

export function persistRawMetadataBackfillAdmissionState(this: LibraryService, openLibrary: OpenLibrary, state: RawMetadataBackfillAdmissionState): void {
  if (!hasRawMetadataBackfillStateSchema(openLibrary.connection)) return;
  openLibrary.connection
    .prepare(
      `INSERT INTO raw_metadata_backfill_state
         (library_id, token, cursor_asset_id, exhausted, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(library_id) DO UPDATE SET
         token = excluded.token,
         cursor_asset_id = excluded.cursor_asset_id,
         exhausted = excluded.exhausted,
         updated_at = excluded.updated_at`,
    )
    .run(
      openLibrary.summary.libraryId,
      state.token,
      state.cursorAssetId,
      state.exhausted ? 1 : 0,
      new Date().toISOString(),
    );
}

/**
* Polls the durable sequence from the open library connection so a Worker
* can observe commits made by another Keel process. The subscription
* owns no write lease and must be stopped when the library closes.
*/
export function subscribeToChangeSequence(this: LibraryService, libraryId: string, onChange: (sequence: number) => void, intervalMs = 250): LibraryChangeSubscription {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return new LibraryWriteCoordinator(openLibrary.writeConnection, libraryId)
    .subscribeToChangeSequence({ intervalMs, onChange });
}

/**
* Side-effect-free preflight for an Automation Gateway file-operation plan.
* The result contains only opaque state tokens; source paths and filenames
* remain inside the Worker. The execution command later validates both the
* durable change sequence and every token before touching the filesystem.
*/
export function previewAutomationFileOperation(this: LibraryService, input: {
    libraryId: string;
    operation: 'trash' | 'replace-content' | 'move' | 'rename-file' | 'rename-files' | 'restore-if-original-vacant';
    assetIds: string[];
    newBaseName?: string;
    newFileName?: string;
    renameItems?: Array<{ assetId: string; newBaseName: string }>;
    targetFolderId?: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): {
    libraryId: string;
    operation: 'trash' | 'replace-content' | 'move' | 'rename-file' | 'rename-files' | 'restore-if-original-vacant';
    planHash: string;
    changeSequence: number;
    targetCount: number;
    executableCount: number;
    blockedCount: number;
    conflictCount: number;
    undoSupported: boolean;
    assetStates: Array<{ assetId: string; stateToken: string }>;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  if (input.operation === 'move') {
    // Validate target folder exists when moving into a non-root folder.
    if (input.targetFolderId) {
      const folder = openLibrary.connection.prepare(
        'SELECT folder_id FROM managed_folders WHERE folder_id = ?',
      ).get(input.targetFolderId);
      if (!folder) throw new LibraryServiceError('INVALID_SELECTION');
    }
  }
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    current_revision_id: string;
    relative_file_path: string;
    deleted_at: string | null;
    availability: 'available' | 'missing';
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
  }>({
    connection: openLibrary.connection,
    values: input.assetIds,
    buildSql: (placeholders) =>
      `SELECT asset_id, current_revision_id, relative_file_path, deleted_at,
              availability, location_kind, linked_folder_id
         FROM assets
        WHERE asset_id IN (${placeholders})`,
  });
  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  const assetStates: Array<{ assetId: string; stateToken: string }> = [];
  const resolutionFacts: Array<{
    assetId: string;
    outcome: 'execute' | 'blocked' | 'no-op';
    destination?: string;
    conflict?: boolean;
  }> = [];
  let executableCount = 0;
  let conflictCount = 0;
  const plannedDestinations = new Set<string>();
  const selectedIds = new Set(input.assetIds);
  const moveStrategy = input.conflictStrategy ?? 'keep-both';
  const renameItems = new Map(
    (input.renameItems ?? []).map((item) => [item.assetId, item.newBaseName]),
  );
  for (const assetId of input.assetIds) {
    const row = rowById.get(assetId);
    if (!row) {
      assetStates.push({
        assetId,
        stateToken: createHash('sha256').update(`missing:${assetId}`, 'utf8').digest('hex'),
      });
      resolutionFacts.push({ assetId, outcome: 'blocked' });
      continue;
    }
    assetStates.push({
      assetId,
      stateToken: this.automationAssetStateToken(row),
    });
    let outcome: 'execute' | 'blocked' | 'no-op' = 'blocked';
    let destination: string | undefined;
    let hasConflict = false;
    if (input.operation === 'trash') {
      if (row.location_kind === 'managed' && row.deleted_at === null) outcome = 'execute';
    } else if (input.operation === 'replace-content') {
      if (
        row.deleted_at === null
        && row.availability === 'available'
      ) {
        if (row.location_kind === 'linked') {
          const linkedFolder = openLibrary.connection
            .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
            .get(row.linked_folder_id) as {
              absolute_root_path: string;
              status: 'available' | 'offline';
            } | undefined;
          if (
            linkedFolder
            && linkedFolder.status === 'available'
            && !this.linkedRootIsGone(linkedFolder.absolute_root_path)
          ) {
            outcome = 'execute';
          }
        } else if (row.location_kind === 'managed') {
          outcome = 'execute';
        }
      }
    } else if (input.operation === 'restore-if-original-vacant') {
      if (row.location_kind === 'managed' && row.deleted_at !== null) outcome = 'execute';
    } else if (input.operation === 'move') {
      const movable = row.location_kind === 'managed'
        && row.deleted_at === null
        && row.availability === 'available';
      if (movable) {
        if (!realFileExists(this.folderPath(openLibrary, row.relative_file_path))) {
          resolutionFacts.push({ assetId, outcome: 'blocked' });
          continue;
        }
        const targetPrefix = input.targetFolderId
          ? (openLibrary.connection.prepare('SELECT relative_path FROM managed_folders WHERE folder_id = ?')
            .get(input.targetFolderId) as { relative_path: string } | undefined)?.relative_path ?? ''
          : '';
        const filename = path.posix.basename(row.relative_file_path);
        destination = targetPrefix ? path.posix.join(targetPrefix, filename) : filename;
        let identity = portablePathIdentity(destination);
        if (identity === portablePathIdentity(row.relative_file_path)) {
          plannedDestinations.add(identity);
          outcome = 'no-op';
        } else {
          const conflict = this.managedMoveConflict(
            openLibrary,
            'automation-plan',
            String(resolutionFacts.length),
            destination,
            assetId,
          );
          const selectedConflict = conflict?.assetId ? selectedIds.has(conflict.assetId) : false;
          const batchConflict = plannedDestinations.has(identity) || selectedConflict;
          if (conflict || batchConflict) {
            hasConflict = true;
            conflictCount += 1;
            if (moveStrategy === 'skip') {
              outcome = 'blocked';
            } else if (moveStrategy === 'keep-both' || batchConflict) {
              destination = this.availableMoveDestination(openLibrary, destination, plannedDestinations);
              identity = portablePathIdentity(destination);
              plannedDestinations.add(identity);
              outcome = 'execute';
            } else {
              plannedDestinations.add(identity);
              outcome = 'execute';
            }
          } else {
            plannedDestinations.add(identity);
            outcome = 'execute';
          }
        }
      }
    } else if (input.operation === 'rename-file' || input.operation === 'rename-files') {
      const requestedBaseName = input.operation === 'rename-file'
        ? input.newBaseName
        : renameItems.get(assetId);
      const requestedFileName = input.operation === 'rename-file'
        ? input.newFileName
        : undefined;
      if (
        row.deleted_at === null
        && row.availability === 'available'
        && (requestedBaseName !== undefined || requestedFileName !== undefined)
      ) {
        try {
          const currentFileName = path.posix.basename(row.relative_file_path);
          const extension = path.posix.extname(currentFileName);
          const newFileName = requestedFileName !== undefined
            ? normalizeAssetFileBaseName(requestedFileName)
            : `${normalizeAssetFileBaseName(requestedBaseName!)}${extension}`;
          const currentDirectory = path.posix.dirname(row.relative_file_path);
          destination = currentDirectory === '.'
            ? newFileName
            : path.posix.join(currentDirectory, newFileName);
          if (Buffer.byteLength(newFileName, 'utf8') > 255) throw new Error('filename too long');
          if (newFileName === currentFileName) {
            outcome = 'no-op';
          } else {
            const newIdentity = portablePathIdentity(destination);
            const dbConflict = row.location_kind === 'managed'
              ? openLibrary.connection.prepare(
                `SELECT asset_id FROM assets
                  WHERE path_identity = ? AND location_kind = 'managed'
                    AND deleted_at IS NULL AND asset_id != ?`,
              ).get(newIdentity, row.asset_id)
              : openLibrary.connection.prepare(
                `SELECT asset_id FROM assets
                  WHERE linked_folder_id = ? AND path_identity = ?
                    AND location_kind = 'linked' AND deleted_at IS NULL AND asset_id != ?`,
              ).get(row.linked_folder_id, newIdentity, row.asset_id);
            const sourcePath = row.location_kind === 'managed'
              ? this.folderPath(openLibrary, row.relative_file_path)
              : this.linkedAssetPath(openLibrary, row.linked_folder_id, row.relative_file_path);
            if (!realFileExists(sourcePath)) throw new Error('source missing');
            let diskConflict = false;
            try {
              const entries = readdirSync(path.dirname(sourcePath), { withFileTypes: true });
              const targetSegmentIdentity = portablePathSegmentIdentity(newFileName);
              diskConflict = entries.some((entry) => (
                entry.name !== currentFileName
                && portablePathSegmentIdentity(entry.name) === targetSegmentIdentity
              ));
            } catch {
              diskConflict = true;
            }
            hasConflict = Boolean(dbConflict) || diskConflict;
            if (hasConflict) {
              conflictCount += 1;
            } else {
              outcome = 'execute';
            }
          }
        } catch {
          outcome = 'blocked';
        }
      }
    }
    if (outcome === 'execute' || outcome === 'no-op') executableCount += 1;
    resolutionFacts.push({
      assetId,
      outcome,
      ...(destination === undefined ? {} : { destination }),
      ...(hasConflict ? { conflict: true } : {}),
    });
  }
  const changeSequence = this.getChangeSequence(input.libraryId);
  return {
    libraryId: input.libraryId,
    operation: input.operation,
    planHash: createAutomationFilePlanHash({
      operation: input.operation,
      assetIds: input.assetIds,
      ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
      ...(input.newBaseName === undefined ? {} : { newBaseName: input.newBaseName }),
      ...(input.renameItems === undefined ? {} : { renameItems: input.renameItems }),
      ...(input.conflictStrategy === undefined ? {} : { conflictStrategy: input.conflictStrategy }),
      expectedChangeSequence: changeSequence,
      assetStates,
      resolutionFacts,
    }),
    changeSequence,
    targetCount: input.assetIds.length,
    executableCount,
    blockedCount: resolutionFacts.filter((fact) => fact.outcome === 'blocked').length,
    conflictCount,
    undoSupported: input.operation === 'trash' || input.operation === 'move',
    assetStates,
  };
}

export function expandImageSequenceSourcePaths(this: LibraryService, sourcePaths: readonly string[]): string[] {
  const expanded = new Map<string, string>();
  const selectedPaths: string[] = [];
  const selectedPathSet = new Set<string>();
  for (const rawPath of sourcePaths) {
    let selectedPath: string;
    try {
      selectedPath = normalizeAbsolutePath(rawPath);
    } catch {
      expanded.set(rawPath, rawPath);
      continue;
    }
    expanded.set(selectedPath, selectedPath);
    if (!selectedPathSet.has(selectedPath)) {
      selectedPathSet.add(selectedPath);
      selectedPaths.push(selectedPath);
    }
  }

  const sequencesBySelectedPath = discoverSelectedImageSequenceFrames(selectedPaths);
  for (const selectedPath of selectedPaths) {
    const sequence = sequencesBySelectedPath.get(selectedPath)?.candidate;
    if (!sequence) continue;
    for (const frame of sequence.frames) {
      expanded.set(frame.value, frame.value);
    }
  }
  return [...expanded.values()];
}

/**
* Probe disk siblings for numbered image runs covering the selection.
* Frames must share one pixel size (sharp metadata). A candidate is offered
* only when every frame in the numbered run is readable and has the same
* dimensions; a mismatched frame rejects the complete candidate.
*/
export async function probeImageSequenceImportOffer(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourcePaths: string[];
  }): Promise<ImageSequenceImportOffer | null> {
  this.requireOpenLibrary(input.libraryId);

  const selectedPaths: string[] = [];
  const selectedPathSet = new Set<string>();
  for (const rawPath of input.sourcePaths) {
    try {
      const selectedPath = normalizeAbsolutePath(rawPath);
      if (selectedPathSet.has(selectedPath)) continue;
      selectedPathSet.add(selectedPath);
      selectedPaths.push(selectedPath);
    } catch {
      // Invalid selection paths are ignored for probing.
    }
  }
  if (selectedPaths.length === 0) return null;

  const sharp = requireSharp();
  const sequencesBySelectedPath = discoverSelectedImageSequenceFrames(selectedPaths);
  const metadataCache = new Map<string, { width: number; height: number } | null>();
  const sequences: ImageSequenceImportOffer['sequences'] = [];
  const seenRunKeys = new Set<string>();

  const readSize = async (
    absolutePath: string,
  ): Promise<{ width: number; height: number } | null> => {
    if (metadataCache.has(absolutePath)) {
      return metadataCache.get(absolutePath) ?? null;
    }
    try {
      const metadata = await runSharpDecoder(
        undefined,
        'background',
        () => sharp(absolutePath).metadata(),
      );
      const width = metadata.width;
      const height = metadata.height;
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0
      ) {
        metadataCache.set(absolutePath, null);
        return null;
      }
      const size = { width, height };
      metadataCache.set(absolutePath, size);
      return size;
    } catch {
      metadataCache.set(absolutePath, null);
      return null;
    }
  };

  for (const selectedPath of selectedPaths) {
    const candidate = sequencesBySelectedPath.get(selectedPath)?.candidate;
    if (!candidate) continue;
    const runKey = candidate.frames.map((frame) => frame.value).join('\0');
    if (seenRunKeys.has(runKey)) continue;
    seenRunKeys.add(runKey);

    await Promise.all(
      candidate.frames.map(async (frame) => {
        try {
          await readSize(normalizeAbsolutePath(frame.value));
        } catch {
          // Cached as null inside readSize on failure paths.
        }
      }),
    );

    const referenceSize = await readSize(selectedPath);
    if (!referenceSize) continue;

    const matching: ImageSequenceFrameCandidate[] = [];
    let complete = true;
    for (const frame of candidate.frames) {
      let absolutePath: string;
      try {
        absolutePath = normalizeAbsolutePath(frame.value);
      } catch {
        complete = false;
        continue;
      }
      const size = metadataCache.get(absolutePath);
      if (
        !size ||
        size.width !== referenceSize.width ||
        size.height !== referenceSize.height
      ) {
        complete = false;
        continue;
      }
      matching.push({ ...frame, value: absolutePath });
    }
    if (!complete || matching.length !== candidate.frames.length) continue;
    if (!matching.some((frame) => selectedPathSet.has(frame.value))) continue;
    const firstFrame = matching[0]!.frameNumber;
    const lastFrame = matching.at(-1)!.frameNumber;
    sequences.push({
      displayName: formatImageSequenceDisplayName({
        prefix: candidate.prefix,
        firstFrame,
        lastFrame,
        numberStyle: candidate.numberStyle,
        numericWidth: candidate.numericWidth,
      }),
      extension: candidate.extension,
      firstFrame,
      frameCount: matching.length,
      framePaths: matching.map((frame) => frame.value),
      height: referenceSize.height,
      lastFrame,
      numberStyle: candidate.numberStyle,
      numericWidth: candidate.numericWidth,
      prefix: candidate.prefix,
      width: referenceSize.width,
    });
  }

  if (sequences.length === 0) return null;
  return {
    defaultFps: DEFAULT_IMAGE_SEQUENCE_FPS,
    libraryId: input.libraryId,
    selectedPaths,
    sequences,
    ...(input.targetFolderId ? { targetFolderId: input.targetFolderId } : {}),
  };
}

export function linkedDirectoryCoverArtifactIds(this: LibraryService, openLibrary: OpenLibrary, linkedFolderId: string, relativePath: string, showIgnored: boolean, childDirs: string[] = []): string[] {
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return [];
  }
  const prefix = relativePath === '' ? '' : `${relativePath}/`;
  const rows = openLibrary.connection
    .prepare(
      `SELECT ra.artifact_id, a.relative_file_path
         FROM assets a
         JOIN revision_artifacts ra
           ON ra.revision_id = a.current_revision_id
          AND ra.kind IN ('thumbnail', 'video_poster')
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL
        WHERE a.linked_folder_id = ?
          AND a.location_kind = 'linked'
          AND a.deleted_at IS NULL
          ${this._showMissingLinkedFiles ? '' : "AND a.availability <> 'missing'"}
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
          AND (
            ? = ''
            OR a.relative_file_path = ?
            OR (? != '' AND substr(a.relative_file_path, 1, ?) = ?)
          )
        ORDER BY a.relative_file_path`,
    )
    .all(
      linkedFolderId,
      relativePath,
      relativePath,
      prefix,
      [...prefix].length,
      prefix,
    ) as Array<{ artifact_id: string; relative_file_path: string }>;

  const scopedRows = relativePath === '' && childDirs.length === 0
    ? rows.filter((row) => !row.relative_file_path.includes('/'))
    : rows;

  if (childDirs.length === 0) {
    return scopedRows.slice(0, 3).map((row) => row.artifact_id);
  }

  // Pure linked folder — round-robin across direct child directories
  const childPrefixes = childDirs.map((d) => (d === '' ? '' : `${d}/`));
  const byChild: string[][] = childDirs.map(() => []);
  for (const row of rows) {
    for (let i = 0; i < childDirs.length; i++) {
      const cPrefix = childPrefixes[i]!;
      if (row.relative_file_path === childDirs[i] || row.relative_file_path.startsWith(cPrefix)) {
        byChild[i]!.push(row.artifact_id);
        break;
      }
    }
  }

  const picked: string[] = [];
  let round = 0;
  while (picked.length < 4) {
    let addedInRound = false;
    for (let c = 0; c < childDirs.length && picked.length < 4; c++) {
      const list = byChild[c];
      if (list && round < list.length) {
        picked.push(list[round]!);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }
  return picked;
}

/**
* Sequence frames shown from the original file have no thumbnail artifact,
* so a folder that only contains a sequence would otherwise stay on the
* default folder glyph. Point the cover at the sequence's first frame.
*/
export function withSequenceFolderCovers(this: LibraryService, openLibrary: OpenLibrary, entries: FolderBrowseEntry[]): FolderBrowseEntry[] {
  if (!hasTable(openLibrary.connection, 'asset_sequence_frames')) {
    return this.withCustomFolderCovers(openLibrary, entries);
  }
  const pending = entries.filter((entry) => entry.coverArtifactIds.length === 0);
  if (pending.length === 0) return this.withCustomFolderCovers(openLibrary, entries);
  const previews = new Map<string, { assetId: string; revisionId: string }>();
  const managedIds = pending
    .filter((entry) => entry.locationKind === 'managed')
    .map((entry) => entry.folderId);
  if (managedIds.length > 0) {
    const rows = sqliteAllInChunks<string, {
      folder_id: string;
      asset_id: string;
      revision_id: string;
    }>({
      connection: openLibrary.connection,
      values: managedIds,
      buildSql: (placeholders) =>
        `SELECT a.managed_folder_id AS folder_id,
                a.asset_id,
                a.current_revision_id AS revision_id
           FROM assets a
           JOIN asset_sequence_frames frame
             ON frame.asset_id = a.asset_id
            AND frame.position = 0
          WHERE a.managed_folder_id IN (${placeholders})
            AND a.deleted_at IS NULL
            AND a.current_revision_id IS NOT NULL
          ORDER BY a.relative_file_path`,
    });
    for (const row of rows) {
      if (!previews.has(row.folder_id)) {
        previews.set(row.folder_id, {
          assetId: row.asset_id,
          revisionId: row.revision_id,
        });
      }
    }
  }
  const linkedIds = [...new Set(
    pending
      .filter((entry) => entry.locationKind === 'linked' && entry.linkedFolderId)
      .map((entry) => entry.linkedFolderId!),
  )];
  if (linkedIds.length > 0) {
    const rows = sqliteAllInChunks<string, {
      linked_folder_id: string;
      relative_file_path: string;
      asset_id: string;
      revision_id: string;
    }>({
      connection: openLibrary.connection,
      values: linkedIds,
      buildSql: (placeholders) =>
        `SELECT a.linked_folder_id,
                a.relative_file_path,
                a.asset_id,
                a.current_revision_id AS revision_id
           FROM assets a
           JOIN asset_sequence_frames frame
             ON frame.asset_id = a.asset_id
            AND frame.position = 0
          WHERE a.linked_folder_id IN (${placeholders})
            AND a.deleted_at IS NULL
            AND a.current_revision_id IS NOT NULL
          ORDER BY a.relative_file_path`,
    });
    for (const entry of pending) {
      if (entry.locationKind !== 'linked' || !entry.linkedFolderId) continue;
      const prefix = entry.relativePath === '' ? '' : `${entry.relativePath}/`;
      const match = rows.find((row) => {
        if (row.linked_folder_id !== entry.linkedFolderId) return false;
        const parent = row.relative_file_path.includes('/')
          ? row.relative_file_path.slice(0, row.relative_file_path.lastIndexOf('/'))
          : '';
        return parent === entry.relativePath
          || (prefix !== '' && row.relative_file_path.startsWith(prefix) && parent === entry.relativePath);
      });
      if (match) {
        previews.set(entry.folderId, {
          assetId: match.asset_id,
          revisionId: match.revision_id,
        });
      }
    }
  }
  if (previews.size === 0) return this.withCustomFolderCovers(openLibrary, entries);
  return this.withCustomFolderCovers(openLibrary, entries.map((entry) => {
    const preview = previews.get(entry.folderId);
    if (!preview || entry.coverArtifactIds.length > 0) return entry;
    return { ...entry, coverSourcePreviews: [preview] };
  }));
}

export function folderCoverArtifactMap(this: LibraryService, openLibrary: OpenLibrary, folderIds: string[], showIgnored = false): Map<string, string[]> {
  const covers = new Map<string, string[]>();
  if (folderIds.length === 0) return covers;
  // review fix: libraries predating revision_artifacts.status
  // (v9) or linked_ignored_assets have no covers to map.
  if (
    !columnsFor(openLibrary.connection, 'revision_artifacts').has('status') ||
    !hasTable(openLibrary.connection, 'linked_ignored_assets')
  ) {
    return covers;
  }
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.managed_folder_id',
    folderIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.managed_folder_id AS folder_id, ra.artifact_id AS artifact_id
             FROM assets a
             JOIN revision_artifacts ra
               ON ra.revision_id = a.current_revision_id
              AND ra.invalidated_at IS NULL
              AND ra.status = 'ready'
              AND ra.kind = CASE
                WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                  OR LOWER(a.relative_file_path) LIKE '%.webm'
                  OR LOWER(a.relative_file_path) LIKE '%.mov'
                  OR LOWER(a.relative_file_path) LIKE '%.avi'
                  OR LOWER(a.relative_file_path) LIKE '%.wmv'
                  OR LOWER(a.relative_file_path) LIKE '%.mkv'
                  OR LOWER(a.relative_file_path) LIKE '%.m4v'
                  OR LOWER(a.relative_file_path) LIKE '%.flv'
                THEN 'video_poster'
                ELSE 'thumbnail'
              END
            WHERE ${sql}
              AND a.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id
              )
              AND ${this.explicitIgnoreSql(openLibrary.connection, 'a', showIgnored)}
            ORDER BY a.managed_folder_id, a.relative_file_path`,
        )
        .all(...params) as Array<{ folder_id: string; artifact_id: string }>,
  );

  for (const row of rows) {
    const existing = covers.get(row.folder_id) ?? [];
    if (existing.length >= 3) continue;
    existing.push(row.artifact_id);
    covers.set(row.folder_id, existing);
  }

  // For pure folders (folders with directAssetCount === 0),
  // pick up to 4 covers from their child folders in round-robin order so
  // the folder card displays a 2x2 collage preview of its subfolder contents.
  const missingFolderIds = folderIds.filter((id) => (covers.get(id)?.length ?? 0) === 0);
  if (missingFolderIds.length > 0) {
    this.populateChildFolderCovers(openLibrary, missingFolderIds, covers, showIgnored);
  }

  return covers;
}

export function insertImageSequence(this: LibraryService, openLibrary: OpenLibrary, frames: readonly { assetId: string; frameNumber: number }[], fps: number): string {
  const sequenceId = randomUUID();
  const now = new Date().toISOString();
  openLibrary.connection.prepare(
    `INSERT INTO asset_sequences
       (sequence_id, primary_asset_id, fps, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sequenceId, frames[0]!.assetId, fps, now, now);
  const insertFrame = openLibrary.connection.prepare(
    `INSERT INTO asset_sequence_frames
       (sequence_id, asset_id, frame_number, position)
     VALUES (?, ?, ?, ?)`,
  );
  frames.forEach((frame, position) => {
    insertFrame.run(sequenceId, frame.assetId, frame.frameNumber, position);
  });
  this.cancelHiddenSequenceMemberMediaJobs(
    openLibrary,
    frames.slice(1).map((frame) => frame.assetId),
  );
  return sequenceId;
}

/**
* Hidden sequence frames are not browse cards. Cancel leftover primary and
* palette jobs so they cannot occupy the background queue.
*/
export function cancelHiddenSequenceMemberMediaJobs(this: LibraryService, openLibrary: OpenLibrary, hiddenAssetIds: readonly string[]): void {
  const uniqueIds = [...new Set(hiddenAssetIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const jobIds = sqliteAllInChunks<string, { job_id: string }>({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `SELECT job_id
         FROM jobs
        WHERE library_id = ?
          AND kind IN ('generate_thumbnail', 'extract_palette')
          AND status IN ('queued', 'paused', 'running')
          AND asset_id IN (${placeholders})`,
    bind: (chunk) => [openLibrary.summary.libraryId, ...chunk],
  }).map((row) => row.job_id);
  if (jobIds.length === 0) return;
  const now = new Date().toISOString();
  sqliteRunInChunks({
    connection: openLibrary.connection,
    values: jobIds,
    buildSql: (placeholders) =>
      `UPDATE jobs
          SET status = 'cancelled', error_code = 'SEQUENCE_MEMBER', updated_at = ?
        WHERE library_id = ?
          AND status IN ('queued', 'paused', 'running')
          AND job_id IN (${placeholders})`,
    bind: (chunk) => [now, openLibrary.summary.libraryId, ...chunk],
  });
  this.abortActiveMediaJobs(openLibrary.summary.libraryId, jobIds);
  this.mediaJobSummaryCache.invalidate(openLibrary.summary.libraryId);
}

/**
* Chromium cannot paint a 16-bit PNG card. Stamp 8-bit OIIO thumbnails so
* they are not scanned again, and replace 16-bit ones with a new 8-bit job.
*/
export function repairUndisplayablePngThumbnails(this: LibraryService, openLibrary: OpenLibrary): void {
  const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  if (!artifactColumns.has('status') || !artifactColumns.has('generator_version')) return;
  const rows = openLibrary.connection.prepare(
    `SELECT ra.artifact_id, ra.file_path, a.asset_id
       FROM revision_artifacts ra
       JOIN assets a ON a.current_revision_id = ra.revision_id
      WHERE ra.kind = 'thumbnail'
        AND ra.status = 'ready'
        AND ra.mime_type = 'image/png'
        AND ra.invalidated_at IS NULL
        AND ra.generator_version LIKE 'oiio@%'
        AND ra.generator_version NOT LIKE '%display-uint8%'
      LIMIT 24`,
  ).all() as Array<{ artifact_id: string; file_path: string; asset_id: string }>;
  if (rows.length === 0) return;
  const artifactsDir = this.artifactsDir(openLibrary);
  const eightBitIds: string[] = [];
  const rebuildArtifactIds: string[] = [];
  const rebuildAssetIds: string[] = [];
  for (const row of rows) {
    const depth = pngBitDepth(path.join(artifactsDir, row.file_path));
    if (depth === 8) eightBitIds.push(row.artifact_id);
    else if (depth === 16) {
      rebuildArtifactIds.push(row.artifact_id);
      rebuildAssetIds.push(row.asset_id);
    }
  }
  if (eightBitIds.length > 0) {
    sqliteRunInChunks({
      connection: openLibrary.connection,
      values: eightBitIds,
      buildSql: (placeholders) =>
        `UPDATE revision_artifacts
            SET generator_version = generator_version || ';display-uint8'
          WHERE artifact_id IN (${placeholders})
            AND generator_version NOT LIKE '%display-uint8%'`,
    });
  }
  if (rebuildArtifactIds.length === 0) return;
  const now = new Date().toISOString();
  sqliteRunInChunks({
    connection: openLibrary.connection,
    values: rebuildArtifactIds,
    buildSql: (placeholders) =>
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE artifact_id IN (${placeholders})
          AND invalidated_at IS NULL`,
    bind: (chunk) => [now, ...chunk],
  });
  this.enqueueThumbnailJobs(openLibrary.summary.libraryId, {
    assetIds: [...new Set(rebuildAssetIds)],
    priority: 200,
  });
}

export function cancelQueuedHiddenSequenceMemberJobs(this: LibraryService, openLibrary: OpenLibrary): void {
  if (!hasTable(openLibrary.connection, 'asset_sequence_frames')) return;
  const now = new Date().toISOString();
  const result = openLibrary.connection
    .prepare(
      `UPDATE jobs
          SET status = 'cancelled', error_code = 'SEQUENCE_MEMBER', updated_at = ?
        WHERE library_id = ?
          AND kind IN ('generate_thumbnail', 'extract_palette', 'extract_metadata')
          AND status IN ('queued', 'paused')
          AND EXISTS (
            SELECT 1
              FROM asset_sequence_frames hidden_sequence_frame
             WHERE hidden_sequence_frame.asset_id = jobs.asset_id
               AND hidden_sequence_frame.position > 0
          )`,
    )
    .run(now, openLibrary.summary.libraryId);
  if (result.changes > 0) {
    this.mediaJobSummaryCache.invalidate(openLibrary.summary.libraryId);
  }
}

export function dissolveImageSequencesForAssets(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): void {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length === 0) return;
  sqliteRunInChunks({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `DELETE FROM asset_sequences
        WHERE sequence_id IN (
          SELECT sequence_id
            FROM asset_sequence_frames
           WHERE asset_id IN (${placeholders})
        )`,
  });
}

export function createDetectedImageSequences(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[], fps = 30): string[] {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length === 0) return [];
  const triggerRows = sqliteAllInChunks<string, { relative_file_path: string }>({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `SELECT a.relative_file_path
         FROM assets a
        WHERE a.asset_id IN (${placeholders})
          AND a.deleted_at IS NULL`,
  });
  const directories = new Set(
    triggerRows.map((row) => path.posix.dirname(row.relative_file_path)),
  );
  const rowsByDirectory = new Map<
    string,
    Array<{
      asset_id: string;
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
    }>
  >();
  for (const directory of directories) {
    const directoryRows = (
      directory === "."
        ? openLibrary.connection.prepare(
            `SELECT a.asset_id, a.relative_file_path, a.location_kind, a.linked_folder_id
               FROM assets a
              WHERE a.deleted_at IS NULL
                AND instr(a.relative_file_path, '/') = 0
                AND NOT EXISTS (
                  SELECT 1
                    FROM asset_sequence_frames sf
                   WHERE sf.asset_id = a.asset_id
                )`,
          ).all()
        : openLibrary.connection.prepare(
            `SELECT a.asset_id, a.relative_file_path, a.location_kind, a.linked_folder_id
               FROM assets a
              WHERE a.deleted_at IS NULL
                AND a.relative_file_path LIKE ? ESCAPE '\\'
                AND NOT EXISTS (
                  SELECT 1
                    FROM asset_sequence_frames sf
                   WHERE sf.asset_id = a.asset_id
                )`,
          ).all(
            `${directory.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}/%`,
          )
    ) as Array<{
      asset_id: string;
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
    }>;
    rowsByDirectory.set(
      directory,
      directoryRows.filter(
        (row) => path.posix.dirname(row.relative_file_path) === directory,
      ),
    );
  }
  const created: string[] = [];
  openLibrary.connection.transaction(() => {
    for (const rows of rowsByDirectory.values()) {
      const rowsByPath = new Map(
        rows.map((row) => [row.relative_file_path, row]),
      );
      for (const candidate of detectImageSequences(
        rows.map((row) => row.relative_file_path),
      )) {
        const candidateRows = candidate.frames.map((frame) => rowsByPath.get(frame.value));
        if (candidateRows.some((row) => row === undefined)) continue;
        const reference = this.imageDimensionsForAsset(openLibrary, candidateRows[0]!);
        if (!reference) continue;
        const dimensionsMatch = candidateRows.every((row) => {
          const size = this.imageDimensionsForAsset(openLibrary, row!);
          return size?.width === reference.width && size.height === reference.height;
        });
        if (!dimensionsMatch) continue;
        const frames = candidate.frames.map((frame, index) => ({
          assetId: candidateRows[index]!.asset_id,
          frameNumber: frame.frameNumber,
        }));
        created.push(this.insertImageSequence(openLibrary, frames, fps));
      }
    }
  })();
  return created;
}

export function imageDimensionsForAsset(this: LibraryService, openLibrary: OpenLibrary, asset: {
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
    }): { width: number; height: number } | null {
  const filePath = asset.location_kind === 'linked'
    ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path)
    : this.folderPath(openLibrary, asset.relative_file_path);
  return readImageDimensionsSync(filePath);
}

export async function imageDimensionsForAssetAsync(this: LibraryService, openLibrary: OpenLibrary, asset: {
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
    }): Promise<{ width: number; height: number } | null> {
  const filePath = asset.location_kind === 'linked'
    ? await this.linkedAssetPathAsync(openLibrary, asset.linked_folder_id, asset.relative_file_path)
    : await this.folderPathAsync(openLibrary, asset.relative_file_path);
  return readImageDimensions(filePath);
}

export function withImageSequenceSummaries(this: LibraryService, openLibrary: OpenLibrary, assets: readonly AssetSummary[]): AssetSummary[] {
  if (assets.length === 0) return [];
  // lenient read (0031 §1): libraries predating the
  // sequence tables have no memberships; return assets unchanged.
  if (
    !hasTable(openLibrary.connection, 'asset_sequence_frames') ||
    !hasTable(openLibrary.connection, 'asset_sequences')
  ) {
    return assets.map((asset) => ({ ...asset, sequence: null }));
  }
  const assetIds = [...new Set(assets.map((asset) => asset.assetId))];
  const memberships = sqliteAllInChunks<
    string,
    { asset_id: string; position: number; sequence_id: string }
  >({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT sf.asset_id, sf.position, sf.sequence_id
         FROM asset_sequence_frames sf
        WHERE sf.asset_id IN (${placeholders})`,
  });
  const hiddenIds = new Set(
    memberships
      .filter((membership) => membership.position > 0)
      .map((membership) => membership.asset_id),
  );
  const primaryMembershipIds = new Set(
    memberships
      .filter((membership) => membership.position === 0)
      .map((membership) => membership.asset_id),
  );
  const visible = assets.filter((asset) => !hiddenIds.has(asset.assetId));
  const primaryIds = visible
    .filter((asset) => primaryMembershipIds.has(asset.assetId))
    .map((asset) => asset.assetId);
  if (primaryIds.length === 0) {
    return foldCatalogImageSequenceSummaries({
      assets,
      memberships,
      frameRows: [],
      artifacts: new Map(),
    });
  }
  const sequenceArtifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const sequenceSourceDimensionColumns = sequenceArtifactColumns.has('width') && sequenceArtifactColumns.has('height')
    ? `,
            (SELECT source_metadata.width
               FROM revision_artifacts source_metadata
              WHERE source_metadata.revision_id = a.current_revision_id
                AND source_metadata.kind = 'extracted_metadata'
                AND source_metadata.status = 'ready'
                AND source_metadata.invalidated_at IS NULL
              ORDER BY source_metadata.generated_at DESC
              LIMIT 1) AS source_width,
            (SELECT source_metadata.height
               FROM revision_artifacts source_metadata
              WHERE source_metadata.revision_id = a.current_revision_id
                AND source_metadata.kind = 'extracted_metadata'
                AND source_metadata.status = 'ready'
                AND source_metadata.invalidated_at IS NULL
              ORDER BY source_metadata.generated_at DESC
              LIMIT 1) AS source_height`
    : ', NULL AS source_width, NULL AS source_height';
  const frameRows = sqliteAllInChunks<string, {
    sequence_id: string;
    primary_asset_id: string;
    fps: number;
    asset_id: string;
    frame_number: number;
    position: number;
    relative_file_path: string;
    current_revision_id: string;
    availability: 'available' | 'missing';
    deleted_at: string | null;
    byte_size: number;
    source_width: number | null;
    source_height: number | null;
  }>({
    connection: openLibrary.connection,
    values: primaryIds,
    buildSql: (placeholders) =>
      `SELECT s.sequence_id, s.primary_asset_id, s.fps,
              sf.asset_id, sf.frame_number, sf.position,
              a.relative_file_path, a.current_revision_id, a.availability, a.deleted_at,
              r.byte_size
              ${sequenceSourceDimensionColumns}
         FROM asset_sequences s
         JOIN asset_sequence_frames sf ON sf.sequence_id = s.sequence_id
         JOIN assets a ON a.asset_id = sf.asset_id
         JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE s.primary_asset_id IN (${placeholders})
        ORDER BY s.sequence_id, sf.position`,
  });
  const artifacts = this.thumbnailArtifactMap(
    openLibrary.summary.libraryId,
    frameRows.map((row) => row.asset_id),
  );
  return foldCatalogImageSequenceSummaries({
    assets,
    memberships,
    frameRows,
    artifacts,
  });
}

export function createImageSequence(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    fps: number;
  }): AssetSummary {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (!Number.isFinite(input.fps) || input.fps < 1 || input.fps > 240) {
    throw new LibraryServiceError('INTERNAL_ERROR');
  }
  const uniqueIds = [...new Set(input.assetIds)];
  if (uniqueIds.length < 3 || uniqueIds.length !== input.assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }
  const rows = sqliteAllInChunks<string, { asset_id: string; relative_file_path: string }>({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.relative_file_path
         FROM assets a
        WHERE a.asset_id IN (${placeholders})
          AND a.deleted_at IS NULL
          AND a.availability = 'available'
          AND NOT EXISTS (
            SELECT 1 FROM asset_sequence_frames sf WHERE sf.asset_id = a.asset_id
          )`,
  });
  if (rows.length !== uniqueIds.length) {
    throw new LibraryServiceError('ASSET_STATE_CONFLICT');
  }
  const directories = new Set(rows.map((row) => path.posix.dirname(row.relative_file_path)));
  if (directories.size !== 1) throw new LibraryServiceError('INVALID_SELECTION', { reason: 'IMAGE_SEQUENCE_SELECTION' });
  const candidate = detectImageSequences(rows.map((row) => row.relative_file_path))
    .find((item) => item.frames.length === rows.length);
  if (!candidate) throw new LibraryServiceError('INVALID_SELECTION', { reason: 'IMAGE_SEQUENCE_SELECTION' });
  const byPath = new Map(rows.map((row) => [row.relative_file_path, row.asset_id]));
  const frames = candidate.frames.map((frame) => ({
    assetId: byPath.get(frame.value)!,
    frameNumber: frame.frameNumber,
  }));
  openLibrary.connection.transaction(() => {
    this.insertImageSequence(openLibrary, frames, input.fps);
  })();
  const asset = this.listAssets({ libraryId: input.libraryId, recursive: true })
    .find((item) => item.assetId === frames[0]!.assetId);
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  return asset;
}

export function dissolveImageSequence(this: LibraryService, input: {
    libraryId: string;
    sequenceId: string;
  }): string {
  const result = this.dissolveImageSequences({
    libraryId: input.libraryId,
    sequenceIds: [input.sequenceId],
  });
  return result.sequenceIds[0]!;
}

export function dissolveImageSequences(this: LibraryService, input: {
    libraryId: string;
    sequenceIds: string[];
  }): { sequenceIds: string[] } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const sequenceIds = [...new Set(input.sequenceIds)];
  if (sequenceIds.length === 0) throw new LibraryServiceError('ASSET_NOT_FOUND');
  const existing = withSqliteInPredicate(
    openLibrary.connection,
    'sequence_id',
    sequenceIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(`SELECT sequence_id FROM asset_sequences WHERE ${sql}`)
        .all(...params) as Array<{ sequence_id: string }>,
  );
  if (existing.length !== sequenceIds.length) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  sqliteRunInChunks({
    connection: openLibrary.connection,
    values: sequenceIds,
    buildSql: (placeholders) =>
      `DELETE FROM asset_sequences WHERE sequence_id IN (${placeholders})`,
  });
  return { sequenceIds };
}

export function setImageSequenceFps(this: LibraryService, input: {
    libraryId: string;
    sequenceId: string;
    fps: number;
  }): { sequenceId: string; fps: number } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (!Number.isFinite(input.fps) || input.fps < 1 || input.fps > 240) {
    throw new LibraryServiceError('INTERNAL_ERROR');
  }
  const result = openLibrary.connection
    .prepare(
      `UPDATE asset_sequences
          SET fps = ?, updated_at = ?
        WHERE sequence_id = ?`,
    )
    .run(input.fps, new Date().toISOString(), input.sequenceId);
  if (result.changes !== 1) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  return { sequenceId: input.sequenceId, fps: input.fps };
}

// ── Asset Metadata ──────────────────────────────────────────────────

export function resolvedPaletteFields(this: LibraryService, openLibrary: OpenLibrary, assetId: string): Pick<AssetMetadataResult, 'automaticPalette' | 'effectivePalette' | 'paletteSource'> {
  let automaticPalette: RepresentativeColor[] = [];
  // lenient read (0031 §1): libraries predating the
  // artifact status column have no palette artifact to resolve.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return { automaticPalette: [], effectivePalette: [], paletteSource: null };
  }
  const artifact = openLibrary.connection.prepare(
    `SELECT ra.artifact_id
       FROM assets a
       JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
      WHERE a.asset_id = ?
        AND ra.kind = 'extracted_palette'
        AND ra.status = 'ready'
        AND ra.invalidated_at IS NULL
      LIMIT 1`,
  ).get(assetId) as { artifact_id: string } | undefined;
  if (artifact) {
    try {
      const parsed = JSON.parse(
        readFileSync(
          this.getArtifactAbsolutePath(openLibrary.summary.libraryId, artifact.artifact_id),
          'utf-8',
        ),
      ) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Palette artifact must contain an array.');
      automaticPalette = parsed.map((entry) => {
        if (
          typeof entry !== 'object' || entry === null ||
          !('hex' in entry) || typeof entry.hex !== 'string' ||
          !/^#[0-9A-F]{6}$/u.test(entry.hex) ||
          !('ratio' in entry) || typeof entry.ratio !== 'number' ||
          !Number.isFinite(entry.ratio) || entry.ratio < 0 || entry.ratio > 1
        ) {
          throw new Error('Palette artifact contains an invalid colour entry.');
        }
        return { hex: entry.hex, ratio: entry.ratio };
      });
    } catch (error) {
      this.diagnose('palette.artifact-read', error, {
        assetId,
        artifactId: artifact.artifact_id,
      });
    }
  }

  // stored manual palette is ignored; effective palette is automatic-only.
  if (automaticPalette.length > 0) {
    return {
      automaticPalette,
      effectivePalette: automaticPalette.map((color) => color.hex),
      paletteSource: 'automatic',
    };
  }
  return { automaticPalette: [], effectivePalette: [], paletteSource: null };
}

/**
* Produce a compact, deterministic palette for assets added during a recent
* time window. This is intentionally a read-only aggregation over completed
* `extracted_palette` artifacts: the request never schedules extraction or
* mutates metadata, so an automation script cannot create hidden background
* work merely by asking for a colour summary.
*/
export function aggregateRecentAssetPalette(this: LibraryService, input: {
    libraryId: string;
    days: number;
    limit: number;
  }): {
    days: number;
    assetCount: number;
    paletteAssetCount: number;
    colors: Array<{ hex: string; weight: number; assetCount: number }>;
  } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const days = Math.max(1, Math.min(3_650, Math.floor(input.days)));
  const limit = Math.max(1, Math.min(24, Math.floor(input.limit)));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const assetCount = (openLibrary.connection.prepare(
    `SELECT COUNT(*) AS count
       FROM assets
      WHERE deleted_at IS NULL AND created_at >= ?`,
  ).get(cutoff) as { count: number }).count;
  const rows = openLibrary.connection.prepare(
    `SELECT a.asset_id, ra.artifact_id
       FROM assets a
       JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL
        AND a.created_at >= ?
        AND ra.kind = 'extracted_palette'
        AND ra.status = 'ready'
        AND ra.invalidated_at IS NULL
      ORDER BY a.asset_id ASC, ra.artifact_id ASC`,
  ).all(cutoff) as Array<{ asset_id: string; artifact_id: string }>;

  const totals = new Map<string, { weight: number; assetIds: Set<string> }>();
  const paletteAssetIds = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(readFileSync(
        this.getArtifactAbsolutePath(input.libraryId, row.artifact_id),
        'utf8',
      )) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Palette artifact must contain an array.');
      let validEntries = 0;
      for (const entry of parsed) {
        if (
          typeof entry !== 'object' || entry === null
          || !('hex' in entry) || typeof entry.hex !== 'string'
          || !/^#[0-9A-F]{6}$/u.test(entry.hex)
          || !('ratio' in entry) || typeof entry.ratio !== 'number'
          || !Number.isFinite(entry.ratio) || entry.ratio < 0 || entry.ratio > 1
        ) {
          throw new Error('Palette artifact contains an invalid colour entry.');
        }
        const existing = totals.get(entry.hex) ?? { weight: 0, assetIds: new Set<string>() };
        existing.weight += entry.ratio;
        existing.assetIds.add(row.asset_id);
        totals.set(entry.hex, existing);
        validEntries++;
      }
      if (validEntries > 0) paletteAssetIds.add(row.asset_id);
    } catch (error) {
      this.diagnose('palette.aggregate-recent.artifact-read', error, {
        assetId: row.asset_id,
        artifactId: row.artifact_id,
      });
    }
  }
  const totalWeight = [...totals.values()].reduce((sum, entry) => sum + entry.weight, 0);
  const colors = [...totals.entries()]
    .map(([hex, entry]) => ({
      hex,
      weight: totalWeight === 0 ? 0 : entry.weight / totalWeight,
      assetCount: entry.assetIds.size,
    }))
    .sort((left, right) => right.weight - left.weight || right.assetCount - left.assetCount || left.hex.localeCompare(right.hex))
    .slice(0, limit);
  return { days, assetCount, paletteAssetCount: paletteAssetIds.size, colors };
}

export function setAssetColorSpaceOverride(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    colorSpace: string | null;
  }): { assetId: string; colorSpaceOverride: string | null } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const asset = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(input.assetId) as { current_revision_id: string | null } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');

  const normalized = input.colorSpace?.trim() || null;
  if (normalized && !colorSpaceInfoFromName(normalized, 'metadata')) {
    throw new LibraryServiceError('INVALID_ASSET_METADATA');
  }
  const now = new Date().toISOString();
  if (normalized) {
    openLibrary.connection.prepare(
      `INSERT INTO asset_color_space_overrides(asset_id, color_space, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET color_space = excluded.color_space,
         updated_at = excluded.updated_at`,
    ).run(input.assetId, normalized, now);
  } else {
    openLibrary.connection
      .prepare('DELETE FROM asset_color_space_overrides WHERE asset_id = ?')
      .run(input.assetId);
  }

  const isImage = LibraryService.detectMediaType(this.resolveAssetPath(input.libraryId, input.assetId)) === 'image';
  if (asset.current_revision_id && isImage) {
    openLibrary.connection.prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE revision_id = ?
          AND kind = 'thumbnail'
          AND invalidated_at IS NULL`,
    ).run(now, asset.current_revision_id);
    this.imageColorSpaceByRevision.delete(asset.current_revision_id);
  }
  this.options.onAssetsChanged?.({
    type: 'asset.changed',
    libraryId: input.libraryId,
    changedCount: 1,
    missingCount: 0,
    source: 'client',
    nativeDragPathsChanged: true,
  });
  return { assetId: input.assetId, colorSpaceOverride: normalized };
}

/**
* Best-effort EXIF/IPTC/XMP author auto-extract. Runs after
* the first successful thumbnail decode for an image asset. Never
* overwrites a non-empty author (user edits and prior extractions both
* win), and — like {@link setAssetsRating} — does not touch entity_version
* so it never invalidates a Renderer's in-flight optimistic-lock token.
*/
export async function backfillAuthorFromExif(this: LibraryService, openLibrary: OpenLibrary, assetId: string, absoluteFilePath: string): Promise<void> {
  let author: string | null;
  try {
    author = await extractAuthorFromExif(absoluteFilePath);
  } catch (error) {
    this.diagnose('metadata.author-exif-extract', error, { assetId });
    return;
  }
  if (!author) return;

  const now = new Date().toISOString();
  openLibrary.connection
    .prepare(
      `INSERT INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, author, entity_version, updated_at)
       VALUES (?, NULL, 0, 0, NULL, NULL, ?, 1, ?)
       ON CONFLICT(asset_id) DO UPDATE SET author = excluded.author
         WHERE asset_metadata.author IS NULL OR asset_metadata.author = ''`,
    )
    .run(assetId, author, now);
  this.syncAssetSearchContent(openLibrary.connection, assetId);
}

/**
* Return the small, path-free asset descriptor consumed by a plugin media
* provider. This is intentionally a point lookup: viewer opens must not
* materialize the recursive asset list merely to decide whether an opt-in
* provider can handle one asset.
*/
export function getPluginMediaProviderAsset(this: LibraryService, libraryId: string, assetId: string): Pick<AssetSummary, 'assetId' | 'displayName' | 'relativeFilePath' | 'currentRevisionId'> | undefined {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path,
              current_revision_id
         FROM assets
        WHERE asset_id = ?
          AND deleted_at IS NULL
          AND current_revision_id IS NOT NULL`,
    )
    .get(assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string;
    } | undefined;
  const linkedIgnored = row && row.location_kind === 'linked'
    && hasTable(openLibrary.connection, 'linked_ignored_assets')
    && openLibrary.connection
      .prepare('SELECT 1 FROM linked_ignored_assets WHERE asset_id = ?')
      .get(row.asset_id) !== undefined;
  if (!row || linkedIgnored || this.isExplicitlyIgnored(
    openLibrary,
    row.location_kind,
    row.linked_folder_id,
    row.relative_file_path,
    'asset',
  )) {
    return undefined;
  }
  return {
    assetId: row.asset_id,
    displayName: buildFileName(row.relative_file_path),
    relativeFilePath: row.relative_file_path,
    currentRevisionId: row.current_revision_id,
  };
}

export function recoverInterruptedThumbnailJobs(this: LibraryService, openLibrary: OpenLibrary): void {
  const nowMs = Date.now();
  openLibrary.connection.prepare(
    `UPDATE jobs SET status = 'queued', progress = 0.0,
      error_code = CASE
        WHEN kind = 'generate_thumbnail'
          AND error_code = '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
        THEN '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
        WHEN kind IN ('generate_webm_proxy', 'generate_audio_proxy')
          AND error_code = '${EXPLICIT_PROXY_FALLBACK_MARKER}'
        THEN '${EXPLICIT_PROXY_FALLBACK_MARKER}'
        ELSE 'PROCESS_INTERRUPTED'
      END,
      error_detail = NULL, updated_at = ?
      WHERE library_id = ? AND status = 'running'
        AND kind IN ('generate_thumbnail', 'generate_video_poster',
                     'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy',
                     'extract_palette')
        AND NOT EXISTS (
          SELECT 1 FROM library_job_leases
           WHERE library_job_leases.library_id = jobs.library_id
             AND library_job_leases.job_id = jobs.job_id
             AND library_job_leases.expires_at_ms > ?
        )`,
  ).run(new Date().toISOString(), openLibrary.summary.libraryId, nowMs);
}

/**
* cancel queued/paused WebM-proxy jobs for GIF assets that
* older builds scheduled proactively. Nothing consumes GIF
* proxies anymore, so draining them after an upgrade would only burn one
* doomed FFmpeg transcode per GIF. Runs after
* {@link recoverInterruptedThumbnailJobs} so recovered rows are covered too;
* jobs still running under a live lease finish on their own.
*/
export function retireLegacyGifProxyJobs(this: LibraryService, openLibrary: OpenLibrary): void {
  openLibrary.connection.prepare(
    `UPDATE jobs SET status = 'cancelled', error_code = 'GIF_PROXY_RETIRED', updated_at = ?
      WHERE library_id = ? AND kind = 'generate_webm_proxy'
        AND status IN ('queued', 'paused')
        AND asset_id IN (
          SELECT asset_id FROM assets WHERE lower(relative_file_path) LIKE '%.gif'
        )`,
  ).run(new Date().toISOString(), openLibrary.summary.libraryId);
}

// ── AI Job Queue Management ──────────────────────────────────────

/**
* Pause AI analysis jobs. If no jobIds provided, pauses all
* queued/running AI jobs for the library.
*/
export function pauseJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { pausedCount: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const result = this._updateJobStatus(
    openLibrary.connection,
    openLibrary.summary.libraryId,
    ['queued', 'running'],
    'paused',
    jobIds,
  );
  return { pausedCount: result.count };
}

/**
* Resume paused AI jobs.
*/
export function resumeJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { resumedCount: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const result = this._updateJobStatus(
    openLibrary.connection,
    openLibrary.summary.libraryId,
    ['paused'],
    'queued',
    jobIds,
  );
  return { resumedCount: result.count };
}

/**
* Cancel AI analysis jobs. If no jobIds provided, cancels all
* queued/paused/running AI jobs for the library.
*/
export function cancelJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { cancelledCount: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // ADR-0028: a SQLite-readonly handle cannot accept job-status writes.
  // Closing or switching away from a read-only library must still succeed.
  if (openLibrary.readOnly) return { cancelledCount: 0 };
  const result = this._updateJobStatus(
    openLibrary.connection,
    openLibrary.summary.libraryId,
    ['queued', 'paused', 'running'],
    'cancelled',
    jobIds,
  );
  return { cancelledCount: result.count };
}

/**
* Retry failed AI analysis jobs. Resets attempt_count and re-enqueues.
*/
export function retryJobs(this: LibraryService, libraryId: string, jobIds: string[]): { retriedCount: number } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const libId = openLibrary.summary.libraryId;

  const retriedCount = sqliteRunInChunks({
    connection: openLibrary.connection,
    values: jobIds,
    buildSql: (placeholders) =>
      `UPDATE jobs
          SET status = 'queued',
              attempt_count = 0,
              error_code = NULL,
              error_detail = NULL,
              updated_at = ?
        WHERE library_id = ?
          AND kind IN ('ai.image.analysis', 'ai.video.analysis')
          AND status = 'failed'
          AND job_id IN (${placeholders})`,
    bind: (chunk) => [new Date().toISOString(), libId, ...chunk],
  });

  return { retriedCount };
}

export function _updateJobStatus(this: LibraryService, conn: { prepare(sql: string): { run(...params: unknown[]): { changes: number }; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] } }, libId: string, fromStatuses: string[], toStatus: string, jobIds?: string[]): { count: number } {
  const statusPlaceholders = fromStatuses.map(() => '?').join(',');
  const aiKinds = ['ai.image.analysis', 'ai.video.analysis'];
  const now = new Date().toISOString();

  if (jobIds && jobIds.length > 0) {
    return {
      count: sqliteRunInChunks({
        connection: conn,
        values: jobIds,
        buildSql: (placeholders) =>
          `UPDATE jobs
              SET status = ?, updated_at = ?
            WHERE library_id = ?
              AND kind IN (?, ?)
              AND status IN (${statusPlaceholders})
              AND job_id IN (${placeholders})`,
        bind: (chunk) => [toStatus, now, libId, ...aiKinds, ...fromStatuses, ...chunk],
      }),
    };
  }
  const query = `UPDATE jobs
               SET status = ?, updated_at = ?
             WHERE library_id = ?
               AND kind IN (?, ?)
               AND status IN (${statusPlaceholders})`;
  const params = [toStatus, now, libId, ...aiKinds, ...fromStatuses];
  const result = conn.prepare(query).run(...params);
  return { count: result.changes as number };
}

// ── Media Job Queue Management ────────────────────────────────────

export function enqueuePluginJob(this: LibraryService, input: {
    libraryId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
    pluginHandlerId: string;
    payload?: Record<string, unknown>;
    recoveryStrategy: PluginJobRecoveryStrategy;
    priority?: number;
  }): PluginJobRecord {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.ownerLibraryId === '__serpent_global_runtime__'
    || input.ownerLibraryId !== openLibrary.summary.libraryId) {
    throw new Error('Plugin job owner library must be the concrete open library.');
  }
  return enqueuePluginJobRecord(openLibrary.connection, {
    libraryId: openLibrary.summary.libraryId,
    ownerPluginId: input.ownerPluginId,
    ownerPackageHash: input.ownerPackageHash,
    ownerPluginInstanceId: input.ownerPluginInstanceId,
    ownerScope: input.ownerScope,
    ownerLibraryId: input.ownerLibraryId,
    applicationSessionId: this.applicationSessionId,
    pluginHandlerId: input.pluginHandlerId,
    payload: input.payload,
    recoveryStrategy: input.recoveryStrategy,
    priority: input.priority,
  });
}

export function listPluginJobs(this: LibraryService, libraryId: string): PluginJobRecord[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return listPluginJobRecords(openLibrary.connection, openLibrary.summary.libraryId);
}

export function claimNextPluginJob(this: LibraryService, input: {
    libraryId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
  }): PluginJobRecord | null {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.ownerLibraryId === '__serpent_global_runtime__'
    || input.ownerLibraryId !== openLibrary.summary.libraryId) {
    throw new Error('Plugin job owner library must be the concrete open library.');
  }
  return claimNextPluginJobRecord(openLibrary.connection, {
    libraryId: openLibrary.summary.libraryId,
    ownerPluginId: input.ownerPluginId,
    ownerPackageHash: input.ownerPackageHash,
    ownerPluginInstanceId: input.ownerPluginInstanceId,
    ownerScope: input.ownerScope,
    ownerLibraryId: input.ownerLibraryId,
  });
}

export function completePluginJob(this: LibraryService, input: {
    libraryId: string;
    jobId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    errorCode?: string;
    errorDetail?: string;
    progress?: number;
    completed?: number;
    total?: number;
    phase?: string;
    message?: string;
    itemResults?: PluginJobItemResult[];
    failedAssetIds?: string[];
    retryInput?: Record<string, unknown>;
    checkpoint?: PluginJobCheckpoint;
  }): PluginJobRecord | null {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  return completePluginJobRecord(openLibrary.connection, {
    jobId: input.jobId,
    owner: {
      pluginId: input.ownerPluginId,
      packageHash: input.ownerPackageHash,
      pluginInstanceId: input.ownerPluginInstanceId,
      scope: input.ownerScope,
      libraryId: input.ownerLibraryId,
    },
    status: input.status,
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    progress: input.progress,
    completed: input.completed,
    total: input.total,
    phase: input.phase,
    message: input.message,
    itemResults: input.itemResults,
    failedAssetIds: input.failedAssetIds,
    retryInput: input.retryInput,
    checkpoint: input.checkpoint,
  });
}

export function controlPluginJob(this: LibraryService, input: {
    libraryId: string;
    jobId: string;
    action: 'cancel' | 'pause' | 'resume' | 'retry';
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
    reason?: string;
    retryInput?: Record<string, unknown>;
    capabilities?: PluginJobHandlerCapabilities;
    checkpoint?: PluginJobCheckpoint;
  }): PluginJobRecord | null {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.ownerLibraryId === '__serpent_global_runtime__'
    || input.ownerLibraryId !== openLibrary.summary.libraryId) {
    throw new Error('Plugin job owner library must be the concrete open library.');
  }
  const owner = {
    pluginId: input.ownerPluginId,
    packageHash: input.ownerPackageHash,
    pluginInstanceId: input.ownerPluginInstanceId,
    scope: input.ownerScope,
    libraryId: input.ownerLibraryId,
  } as const;
  switch (input.action) {
    case 'cancel':
      return cancelPluginJobRecord(openLibrary.connection, { jobId: input.jobId, owner, reason: input.reason });
    case 'pause':
      if (input.capabilities === undefined || input.checkpoint === undefined) {
        throw new Error('Pausing a plugin job requires handler capabilities and a checkpoint.');
      }
      return pausePluginJobRecord(openLibrary.connection, {
        jobId: input.jobId,
        owner,
        capabilities: input.capabilities,
        checkpoint: input.checkpoint,
      });
    case 'resume':
      if (input.capabilities === undefined) {
        throw new Error('Resuming a plugin job requires handler capabilities.');
      }
      return resumePluginJobRecord(openLibrary.connection, {
        jobId: input.jobId,
        owner,
        capabilities: input.capabilities,
      });
    case 'retry':
      return retryPluginJobRecord(openLibrary.connection, {
        jobId: input.jobId,
        owner,
        retryInput: input.retryInput,
        applicationSessionId: this.applicationSessionId,
      });
  }
}

export function reportPluginJobProgress(this: LibraryService, input: {
    libraryId: string;
    jobId: string;
    ownerPluginId: string;
    ownerPackageHash: string;
    ownerPluginInstanceId: string;
    ownerScope: 'library' | 'global';
    ownerLibraryId: string;
    completed: number;
    total: number;
    phase: string;
    message: string;
    progress?: number;
  }): PluginJobRecord | null {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (input.ownerLibraryId === '__serpent_global_runtime__'
    || input.ownerLibraryId !== openLibrary.summary.libraryId) {
    throw new Error('Plugin job owner library must be the concrete open library.');
  }
  return reportPluginJobProgressRow(openLibrary.connection, {
    jobId: input.jobId,
    ownerPluginId: input.ownerPluginId,
    ownerPackageHash: input.ownerPackageHash,
    ownerPluginInstanceId: input.ownerPluginInstanceId,
    ownerScope: input.ownerScope,
    ownerLibraryId: input.ownerLibraryId,
    progress: {
      completed: input.completed,
      total: input.total,
      phase: input.phase,
      message: input.message,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
    },
  });
}

export function pausePluginJobsForOwners(this: LibraryService, input: {
    libraryId: string;
    owners: ReadonlyArray<{ pluginId: string; packageHash?: string }>;
    errorCode?: string;
    errorDetail?: string;
  }): number {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  return pausePluginJobRowsForOwners(openLibrary.connection, {
    libraryId: openLibrary.summary.libraryId,
    owners: input.owners,
    errorCode: input.errorCode ?? 'PLUGIN_UNAVAILABLE',
    errorDetail: input.errorDetail
      ?? 'The owning plugin is missing, disabled, or incompatible on this device.',
  });
}

/**
* 摘要内存缓存的有效性 token = 库变更序号 + 忽略规则序号。计数表路径不再做
* 忽略路径 JOIN，token 仍保留给 GROUP BY 回退路径：忽略规则变化时不得继续
* 使用带可见性过滤的陈旧 GROUP BY 结果。读路径不抛错。
*/
export function mediaJobSummaryToken(this: LibraryService, openLibrary: OpenLibrary): string | null {
  try {
    const libraryRow = openLibrary.connection
      .prepare('SELECT sequence FROM library_change_sequence WHERE library_id = ?')
      .get(openLibrary.summary.libraryId) as { sequence: number } | undefined;
    const ignoreRow = openLibrary.connection
      .prepare('SELECT sequence FROM browse_change_sequence WHERE library_id = ?')
      .get(openLibrary.summary.libraryId) as { sequence: number } | undefined;
    if (
      !libraryRow || !Number.isSafeInteger(libraryRow.sequence)
      || !ignoreRow || !Number.isSafeInteger(ignoreRow.sequence)
    ) {
      return null;
    }
    return `${libraryRow.sequence}:${ignoreRow.sequence}`;
  } catch {
    return null;
  }
}

export function hasMediaJobStatusCountsTable(this: LibraryService, openLibrary: OpenLibrary): boolean {
  return columnsFor(openLibrary.connection, 'media_job_status_counts').has('count');
}

export function readMediaJobStatusCountsTable(this: LibraryService, openLibrary: OpenLibrary): ReturnType<typeof mediaJobCountsFromRows> {
  const rows = openLibrary.connection.prepare(
    'SELECT status, count FROM media_job_status_counts WHERE library_id = ?',
  ).all(openLibrary.summary.libraryId) as Array<{ status: string; count: number }>;
  return mediaJobCountsFromRows(rows);
}

export function hasQueuedPrimaryPreviewJobs(this: LibraryService, libraryId: string): boolean {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return openLibrary.connection.prepare(
    `SELECT 1 FROM jobs
      WHERE library_id = ? AND status = 'queued'
        AND kind IN ('generate_thumbnail', 'generate_video_poster')
      LIMIT 1`,
  ).get(libraryId) !== undefined;
}

export function listMediaJobs(this: LibraryService, libraryId: string, options: {
    summaryOnly?: boolean;
    cursor?: MediaJobListCursor;
    limit?: number;
  } = {}): {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    paused: number;
    cancelled: number;
    nextCursor: MediaJobListCursor | null;
    hasMore: boolean;
    jobs: Array<{
      jobId: string;
      assetId: string;
      assetName: string | null;
      revisionId: string | null;
      kind: MediaJobKind;
      status: MediaJobStatus;
      progress: number;
      attemptCount: number;
      errorCode: string | null;
      errorDetail: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const kindPlaceholders = MEDIA_JOB_KINDS.map(() => '?').join(',');
  // Ignored assets are outside the user's working set.  Do not surface
  // stale rows that were queued before an ignore rule was added (or that
  // were cancelled by the claim-time guard) in the task panel.  The rows
  // stay in SQLite for diagnostics, but they are not actionable media work.
  const visibleJobFilter = `
        AND (j.error_code IS NULL OR j.error_code NOT IN ('ASSET_IGNORED', 'SEQUENCE_MEMBER'))
        AND (j.asset_id IS NULL OR ${this.explicitIgnoreSql(openLibrary.connection, 'a')})`;
  const summaryToken = this.mediaJobSummaryToken(openLibrary);
  const tableCounts = JOB_SUMMARY_CACHE_ENABLED && this.hasMediaJobStatusCountsTable(openLibrary)
    ? this.readMediaJobStatusCountsTable(openLibrary)
    : null;
  let folded = tableCounts;
  if (folded !== null) {
    logMediaJobSummaryEvent({
      source: 'table',
      totalJobs: mediaJobCountTotal(folded),
      epoch: summaryToken ?? 'unavailable',
    });
  } else {
    const summaryRead = JOB_SUMMARY_CACHE_ENABLED && summaryToken !== null
      ? this.mediaJobSummaryCache.read(openLibrary.summary.libraryId, summaryToken)
      : { counts: null, source: 'miss' as const, ageMs: 0, totalJobs: 0 };
    if (summaryRead.counts === null) {
      const countRows = openLibrary.connection.prepare(
        `SELECT status, COUNT(*) AS count FROM jobs
          LEFT JOIN assets a ON a.asset_id = jobs.asset_id
          WHERE jobs.library_id = ? AND jobs.kind IN (${kindPlaceholders})
            AND (jobs.error_code IS NULL OR jobs.error_code NOT IN ('ASSET_IGNORED', 'SEQUENCE_MEMBER'))
            AND (jobs.asset_id IS NULL OR ${this.explicitIgnoreSql(openLibrary.connection, 'a')})
          GROUP BY status`,
      ).all(openLibrary.summary.libraryId, ...MEDIA_JOB_KINDS) as Array<{
        status: string;
        count: number;
      }>;
      folded = mediaJobCountsFromRows(countRows);
      if (summaryToken !== null) {
        this.mediaJobSummaryCache.store(
          openLibrary.summary.libraryId,
          summaryToken,
          folded,
          mediaJobCountTotal(folded),
        );
      }
      logMediaJobSummaryEvent({
        source: summaryToken === null ? 'rebuild-uncached' : 'rebuild',
        totalJobs: mediaJobCountTotal(folded),
        epoch: summaryToken ?? 'unavailable',
      });
    } else {
      folded = summaryRead.counts;
      logMediaJobSummaryEvent({
        source: summaryRead.source,
        ageMs: Math.round(summaryRead.ageMs),
        totalJobs: summaryRead.totalJobs,
      });
    }
  }
  const pageLimit = clampMediaJobListLimit(options.limit);
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorJobId = options.cursor?.jobId ?? null;
  const rawRows = options.summaryOnly
    ? []
    : openLibrary.connection.prepare(
      `SELECT j.job_id, j.asset_id, a.relative_file_path AS asset_name, j.revision_id, j.kind, j.status, j.progress,
               j.attempt_count, j.error_code, j.error_detail, j.created_at, j.updated_at
          FROM jobs j
          LEFT JOIN assets a ON a.asset_id = j.asset_id
         WHERE j.library_id = ? AND j.kind IN (${kindPlaceholders})
           ${visibleJobFilter}
           AND (? IS NULL OR j.created_at < ? OR (j.created_at = ? AND j.job_id < ?))
         ORDER BY j.created_at DESC, j.job_id DESC
         LIMIT ?`,
    ).all(
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      cursorCreatedAt,
      cursorCreatedAt,
      cursorCreatedAt,
      cursorJobId,
      pageLimit + 1,
    ) as Array<{
      job_id: string;
      asset_id: string;
      asset_name: string | null;
      revision_id: string | null;
      kind: MediaJobKind;
      status: MediaJobStatus;
      progress: number;
      attempt_count: number;
      error_code: string | null;
      error_detail: string | null;
      created_at: string;
      updated_at: string;
    }>;
  const mapped = rawRows.map((row) => ({
    jobId: row.job_id,
    assetId: row.asset_id,
    assetName: row.asset_name ? buildFileName(row.asset_name) : null,
    revisionId: row.revision_id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const paged = options.summaryOnly
    ? { page: mapped, nextCursor: null, hasMore: false }
    : sliceMediaJobListPage(mapped, pageLimit);
  return {
    ...folded,
    nextCursor: paged.nextCursor,
    hasMore: paged.hasMore,
    jobs: paged.page,
  };
}

export function pauseMediaJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { pausedCount: number } {
  const count = this.updateMediaJobStatus(libraryId, ['queued', 'running'], 'paused', jobIds);
  if (count > 0) this.mediaJobSummaryCache.invalidate(libraryId);
  this.abortActiveMediaJobs(libraryId, jobIds);
  return { pausedCount: count };
}

export function resumeMediaJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { resumedCount: number } {
  const count = this.updateMediaJobStatus(libraryId, ['paused'], 'queued', jobIds);
  if (count > 0) this.mediaJobSummaryCache.invalidate(libraryId);
  return { resumedCount: count };
}

export function cancelMediaJobs(this: LibraryService, libraryId: string, jobIds?: string[]): { cancelledCount: number } {
  const count = this.updateMediaJobStatus(
    libraryId,
    ['queued', 'paused', 'running'],
    'cancelled',
    jobIds,
  );
  if (count > 0) this.mediaJobSummaryCache.invalidate(libraryId);
  this.abortActiveMediaJobs(libraryId, jobIds);
  return { cancelledCount: count };
}

export function retryMediaJobs(this: LibraryService, libraryId: string, jobIds: string[]): { retriedCount: number } {
  if (jobIds.length === 0) return { retriedCount: 0 };
  const openLibrary = this.requireOpenLibrary(libraryId);
  const retriedCount = sqliteRunInChunks({
    connection: openLibrary.connection,
    values: jobIds,
    buildSql: (placeholders) =>
      `UPDATE jobs SET status = 'queued', progress = 0.0, attempt_count = 0,
              error_code = CASE
                WHEN error_code = '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
                THEN '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
                ELSE NULL
              END,
              error_detail = NULL, updated_at = ?
        WHERE library_id = ?
          AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
          AND status = 'failed'
          AND job_id IN (${placeholders})`,
    bind: (chunk) => [
      new Date().toISOString(),
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      ...chunk,
    ],
  });
  if (retriedCount > 0) this.mediaJobSummaryCache.invalidate(libraryId);
  return { retriedCount };
}

export function updateMediaJobStatus(this: LibraryService, libraryId: string, fromStatuses: string[], toStatus: 'paused' | 'queued' | 'cancelled', jobIds?: string[]): number {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const selectedIds = jobIds && jobIds.length > 0 ? [...new Set(jobIds)] : undefined;
  if (selectedIds === undefined) {
    return openLibrary.connection.prepare(
      `UPDATE jobs SET status = ?, progress = 0.0, updated_at = ?
        WHERE library_id = ?
          AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
          AND status IN (${fromStatuses.map(() => '?').join(',')})`,
    ).run(
      toStatus,
      new Date().toISOString(),
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      ...fromStatuses,
    ).changes;
  }
  return sqliteRunInChunks({
    connection: openLibrary.connection,
    values: selectedIds,
    buildSql: (placeholders) =>
      `UPDATE jobs SET status = ?, progress = 0.0, updated_at = ?
        WHERE library_id = ?
          AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
          AND status IN (${fromStatuses.map(() => '?').join(',')})
          AND job_id IN (${placeholders})`,
    bind: (chunk) => [
      toStatus,
      new Date().toISOString(),
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      ...fromStatuses,
      ...chunk,
    ],
  });
}

export function abortActiveMediaJobs(this: LibraryService, libraryId: string, jobIds?: string[]): void {
  const selected = jobIds ? new Set(jobIds) : undefined;
  for (const [jobId, active] of this.activeMediaJobs) {
    if (active.libraryId !== libraryId || (selected && !selected.has(jobId))) continue;
    active.controller.abort();
  }
}

/**
* 收编 codex/large-library-performance@15f3325c：新视口使正在为
* 旧视口或 startup 回填解码的任务过时。把视口外的 running 预览任务重新排队
* （abort 让 visible 波立即抢到解码器），取消视口外的 queued 任务防止活动泵
* 在新视口之前认领它们。后台回填会把 cancelled 行视为可调度并重建——不删除
* 源文件也不删除 ready artifact。
*/
export function interruptThumbnailJobsOutsideViewport(this: LibraryService, libraryId: string, assetIds: readonly string[]): { interruptedCount: number } {
  const selectedIds = [...new Set(assetIds)].slice(0, 300);
  if (selectedIds.length === 0) return { interruptedCount: 0 };
  const openLibrary = this.requireOpenLibrary(libraryId);
  const placeholders = selectedIds.map(() => '?').join(',');
  // 回归修正（用户报告缩略图生成巨慢）：只中断正在解码的
  // running 任务——这是抢占的全部收益。旧版还 cancel 视口外的 queued 任务，
  // 但后台回填会立刻把它们重建（priority 50），滚动期间形成 cancel→重建→
  // 再 cancel 的写循环，Windows 上每次取消都是一次 journal fsync，吞吐暴跌。
  // queued 任务本就被可见波(350)的优先级压住，无需取消。
  const rows = openLibrary.connection
    .prepare(
      `SELECT job_id, status
         FROM jobs
        WHERE library_id = ?
          AND kind IN ('generate_thumbnail', 'generate_video_poster')
          AND status = 'running'
          AND asset_id NOT IN (${placeholders})`,
    )
    .all(libraryId, ...selectedIds) as Array<{ job_id: string; status: 'running' }>;
  if (rows.length === 0) return { interruptedCount: 0 };

  const now = new Date().toISOString();
  const requeue = openLibrary.connection.prepare(
    "UPDATE jobs SET status = 'queued', updated_at = ? WHERE job_id = ? AND status = 'running'",
  );
  let count = 0;
  openLibrary.connection.transaction(() => {
    for (const row of rows) {
      requeue.run(now, row.job_id);
      count += 1;
    }
  })();
  // Running jobs were requeued; abort their controllers so the decoders stop
  // immediately and the visible wave can claim the freed capacity.
  this.abortActiveMediaJobs(libraryId, rows.map((row) => row.job_id));
  return { interruptedCount: count };
}

/**
* Stop thumbnail/proxy work that may still hold a managed source file open.
* The queue is concurrent, so aborting the controller alone is not enough:
* wait for each active job's finally block to run before deleting on disk.
*/
export async function cancelMediaJobsForAssets(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): Promise<void> {
  const selectedAssetIds = [...new Set(assetIds)];
  if (selectedAssetIds.length === 0) return;
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'asset_id',
    selectedAssetIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT job_id FROM jobs
            WHERE library_id = ?
              AND ${sql}
              AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
              AND status IN ('queued', 'running', 'paused')`,
        )
        .all(
          openLibrary.summary.libraryId,
          ...params,
          ...MEDIA_JOB_KINDS,
        ) as Array<{ job_id: string }>,
  );
  if (rows.length === 0) return;

  const jobIds = rows.map((row) => row.job_id);
  this.updateMediaJobStatus(
    openLibrary.summary.libraryId,
    ['queued', 'running', 'paused'],
    'cancelled',
    jobIds,
  );
  this.abortActiveMediaJobs(openLibrary.summary.libraryId, jobIds);

  const active = jobIds
    .map((jobId) => this.activeMediaJobs.get(jobId))
    .filter(
      (job): job is {
        controller: AbortController;
        libraryId: string;
        assetId: string;
        settled: Promise<void>;
      } => Boolean(job),
    );
  await Promise.all(active.map((job) => job.settled));
}

/**
* Abort thumbnail/ffmpeg/sharp work that still holds files under the library
* root, then wait until those jobs drop their handles. Required before
* Windows can delete the library directory.
*/
export async function drainLibraryMedia(this: LibraryService, libraryId: string, timeoutMs?: number): Promise<void> {
  this.abortActiveMediaJobs(libraryId);
  const active = [...this.activeMediaJobs.values()].filter(
    (job) => job.libraryId === libraryId,
  );
  if (active.length === 0) return;
  const settled = Promise.allSettled(active.map((job) => job.settled)).then(() => undefined);
  if (timeoutMs === undefined) {
    // Closing SQLite before a media job's finally block releases its lease
    // can make the lease release touch a dead connection. A normal close is
    // therefore an unbounded safety boundary; callers that are deleting a
    // library may still opt into the existing bounded drain and retry path.
    await settled;
    return;
  }
  await Promise.race([
    settled,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function mediaJobState(this: LibraryService, libraryId: string, jobId: string): string | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const row = openLibrary.connection.prepare(
    `SELECT status FROM jobs WHERE library_id = ? AND job_id = ?
      AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})`,
  ).get(openLibrary.summary.libraryId, jobId, ...MEDIA_JOB_KINDS) as {
    status: string;
  } | undefined;
  return row?.status ?? null;
}

export function mediaArtifactSnapshot(this: LibraryService, openLibrary: OpenLibrary, revisionId: string): Set<string> {
  const rows = openLibrary.connection.prepare(
    'SELECT artifact_id FROM revision_artifacts WHERE revision_id = ?',
  ).all(revisionId) as Array<{ artifact_id: string }>;
  return new Set(rows.map((row) => row.artifact_id));
}

export function discardLateMediaArtifacts(this: LibraryService, openLibrary: OpenLibrary, revisionId: string, previousArtifactIds: Set<string>, context: {
      libraryId: string;
      jobId: string;
      assetId: string;
      /** The job may have committed an atomic replacement before cancellation. */
      preserveLateArtifacts?: boolean;
    }): void {
  if (context.preserveLateArtifacts) return;
  const rows = openLibrary.connection.prepare(
    'SELECT artifact_id, file_path FROM revision_artifacts WHERE revision_id = ?',
  ).all(revisionId) as Array<{ artifact_id: string; file_path: string }>;
  const lateRows = rows.filter((row) => !previousArtifactIds.has(row.artifact_id));
  if (lateRows.length === 0) return;
  openLibrary.connection.transaction(() => {
    const remove = openLibrary.connection.prepare(
      'DELETE FROM revision_artifacts WHERE artifact_id = ?',
    );
    for (const row of lateRows) remove.run(row.artifact_id);
  })();
  for (const row of lateRows) {
    try {
      rmSync(path.join(this.artifactsDir(openLibrary), row.file_path), { force: true });
    } catch (error) {
      this.diagnose('media-job.cancel-cleanup', error, {
        ...context,
        artifactId: row.artifact_id,
      });
    }
  }
}

export function assetBelongsToImageSequence(this: LibraryService, openLibrary: OpenLibrary, assetId: string): boolean {
  if (
    !hasTable(openLibrary.connection, 'asset_sequence_frames')
    || !hasTable(openLibrary.connection, 'asset_sequences')
  ) {
    return false;
  }
  const row = openLibrary.connection
    .prepare(
      `SELECT 1 AS hit FROM asset_sequence_frames WHERE asset_id = ?
       UNION ALL
       SELECT 1 FROM asset_sequences WHERE primary_asset_id = ?
       LIMIT 1`,
    )
    .get(assetId, assetId) as { hit: number } | undefined;
  return row !== undefined;
}

/**
* Return the .keel/artifacts directory for an open library.
*/
export function artifactsDir(this: LibraryService, openLibrary: OpenLibrary): string {
  return libraryMetaDir(openLibrary.summary.libraryPath, 'artifacts');
}

/** Extensions a thumbnail provider claimed for this library, without a leading dot. */
export function setPluginThumbnailExtensions(this: LibraryService, libraryId: string, extensions: readonly string[]): boolean {
  const previous = this._pluginThumbnailExtensions.get(libraryId);
  const normalized = new Set<string>();
  for (const value of extensions) {
    const extension = value.trim().replace(/^\./u, '').toLowerCase();
    if (/^[a-z0-9][a-z0-9+_-]*$/u.test(extension)) normalized.add(extension);
  }
  this._pluginThumbnailExtensions.set(libraryId, normalized);
  return [...normalized].some((extension) => !previous?.has(extension));
}

export function claimsPluginThumbnail(this: LibraryService, libraryId: string, relativePath: string): boolean {
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  return extension.length > 0
    && (this._pluginThumbnailExtensions.get(libraryId)?.has(extension) ?? false);
}

export function thumbnailEligible(this: LibraryService, libraryId: string, relativePath: string): boolean {
  return this.claimsPluginThumbnail(libraryId, relativePath)
    || LibraryService.supportsThumbnail(relativePath);
}

/**
* Keep the fast visible-thumbnail wave on media that can complete in the
* Worker. GPU models are rendered through Main's single-flight offscreen
* window and stay off this wave.
*/
export function filterVisibleThumbnailAssetIds(this: LibraryService, libraryId: string, assetIds: readonly string[]): string[] {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const selectedIds = [...new Set(assetIds)].slice(0, THUMBNAIL_VISIBLE_PAGE_SIZE);
  if (selectedIds.length === 0) return [];
  const rows = openLibrary.connection
    .prepare(
      `SELECT asset_id, relative_file_path
         FROM assets
        WHERE asset_id IN (${selectedIds.map(() => '?').join(',')})`,
    )
    .all(...selectedIds) as Array<{
      asset_id: string;
      relative_file_path: string;
    }>;
  const gpuModelIds = new Set(
    rows
      .filter((row) => LibraryService.detectMediaType(row.relative_file_path) === 'model')
      .map((row) => row.asset_id),
  );
  return selectedIds.filter((assetId) => !gpuModelIds.has(assetId));
}

// ── Thumbnail Generation Dispatch ─────────────────────────────────

/**
* Generate thumbnails/artifacts for an asset, dispatching by media type.
* Models return null here: their cards render offscreen in Main (slice E).
*/
export async function generateThumbnail(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
  }, execution: MediaExecutionContext = {}): Promise<{ artifactId: string } | null> {
  if (execution.signal?.aborted) {
    throw new DOMException('Media job cancelled before thumbnail generation.', 'AbortError');
  }
  if (mediaResourceGuard.isCoolingDown()) {
    throw new MediaResourceExhaustedError(
      'Native media work is temporarily paused after operating-system resource pressure.',
      'thumbnail',
    );
  }
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const assetPath = this.resolveAssetPath(input.libraryId, input.assetId);

  const mediaType = LibraryService.detectMediaType(assetPath);

  // Get the current revision for this asset
  const assetRow = openLibrary.connection
    .prepare(
      `SELECT a.current_revision_id, r.byte_size AS source_byte_size
         FROM assets a
         LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.asset_id = ?`,
    )
    .get(input.assetId) as {
      current_revision_id: string | null;
      source_byte_size: number | null;
    } | undefined;
  if (!assetRow?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  const revisionId = assetRow.current_revision_id;
  const ext = path.extname(assetPath).toLowerCase();
  const imageDecoder = imageDecoderForExtension(ext);
  const viewerDecoder = imageViewerDecoderForExtension(ext);
  if (mediaType === 'other' || (mediaType === 'image' && !imageDecoder)) {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }

  // Models render offscreen in Main (slice E). The explicit command path
  // stays a benign no-op so the card keeps the generic icon.
  if (mediaType === 'model') {
    return null;
  }

  // PDF thumbnails render the first page with pdfjs-dist in
  // the Worker (pure JS, no offscreen window). HTML thumbnails render
  // offscreen in Main through the injected documentThumbnailRenderer.
  // Both are enqueued like any other asset — the enqueue gate must list the
  // document extensions (see enqueueThumbnailJobs supportedExtensions).
  if (mediaType === 'document' && (ext === '.pdf' || ext === '.ai')) {
    return this.generatePdfThumbnail(input, openLibrary, assetPath, revisionId, execution);
  }
  if (mediaType === 'document') {
    const renderer = this.options.documentThumbnailRenderer;
    if (!renderer) return null;
    return this.generateHtmlThumbnail(
      input,
      openLibrary,
      assetPath,
      revisionId,
      execution,
      renderer,
    );
  }

  // font cards show a real sample line. Main serves a small
  // sample sheet for the font (`sample=font`) and the existing offscreen
  // capture turns it into an artifact, so the Renderer never touches paths.
  // The sheet's label follows the script the font actually covers, which the
  // Worker reads from the font's own `name`/`cmap` tables.
  if (mediaType === 'font') {
    const renderer = this.options.documentThumbnailRenderer;
    if (!renderer) return null;
    const fontMetadata = this.readAssetFontMetadata(assetPath);
    return this.generateHtmlThumbnail(
      input,
      openLibrary,
      assetPath,
      revisionId,
      execution,
      renderer,
      {
        sample: 'font',
        generatorVersion: FONT_THUMBNAIL_GENERATOR_VERSION,
        fontMetadata,
      },
    );
  }

  const isGifAsset = assetPath.toLowerCase().endsWith('.gif');
  const artifactKinds = mediaType === 'video'
    ? [
        ...(execution.includeVideoMetadata === false ? [] : ['extracted_metadata']),
        'video_poster',
      ]
    : mediaType === 'audio'
      // thumbnail = 4:3 grid cover; video_poster = wide viewer strip
      ? ['extracted_metadata', 'thumbnail', 'video_poster']
    : isGifAsset
      ? ['thumbnail', 'extracted_metadata']
      : ['thumbnail'];
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE revision_id = ?
          AND kind IN (${artifactKinds.map(() => '?').join(', ')})
          AND invalidated_at IS NULL`,
    )
    .run(new Date().toISOString(), revisionId, ...artifactKinds);

  const colorSpaceOverride = mediaType === 'image'
    ? this.getColorSpaceOverride(openLibrary.connection, input.assetId)
    : null;
  const hasSourceDimensions = Number.isSafeInteger(execution.sourceWidth)
    && Number.isSafeInteger(execution.sourceHeight)
    && execution.sourceWidth! > 0
    && execution.sourceHeight! > 0;
  // RAW files commonly use a TIFF-compatible header. Probe it once before
  // the card route so layout gets source dimensions without making the
  // embedded-JPEG path read the source a second time. A queued card already
  // carrying header dimensions skips this I/O entirely.
  const tiffHeaderSize = (isTiffExtension(ext) || isRawImageExtension(ext))
    && !hasSourceDimensions
    ? await readImageDimensions(assetPath)
    : null;
  const sourceExecution: MediaExecutionContext = {
    ...execution,
    sourceByteSize: execution.sourceByteSize ?? assetRow.source_byte_size,
    sourceWidth: execution.sourceWidth ?? tiffHeaderSize?.width,
    sourceHeight: execution.sourceHeight ?? tiffHeaderSize?.height,
  };
  if (
    mediaType === 'image' &&
    imageDecoder === 'sharp' &&
    viewerDecoder === 'sharp' &&
    (!colorSpaceOverride || !canOverrideImageColorSpace(ext))
  ) {
    return this.generateImageThumbnail(input, openLibrary, assetPath, revisionId, sourceExecution);
  }

  // OIIO owns containers that Chromium cannot open directly, including TGA
  // and TIFF. Decoder choice is format-based, never a guessed source-size
  // or pixel-size threshold; the native tool decides whether the content is
  // actually readable.
  if (mediaType === 'image' && viewerDecoder === 'oiio') {
    // RAW output is already LibRaw/OIIO's display-ready default sRGB and
    // the embedded-JPEG card path does not consume a source colour-space
    // override. Avoid an otherwise redundant native `--info` probe before
    // the bounded embedded preview can be served.
    const colorSpace = isRawImageExtension(ext)
      ? null
      : await this.getImageColorSpace(revisionId, assetPath, 'oiio');
    return this.generateOiiOThumbnail(
      input,
      openLibrary,
      assetPath,
      revisionId,
      { inputColorSpace: colorSpaceOverride ?? colorSpace?.id },
      sourceExecution,
    );
  }

  if (mediaType === 'image' && imageDecoder === 'sharp' && colorSpaceOverride) {
    return this.generateOiiOThumbnail(
      input,
      openLibrary,
      assetPath,
      revisionId,
      { inputColorSpace: colorSpaceOverride },
      sourceExecution,
    );
  }

  if (mediaType === 'video') {
    return this.generateVideoArtifacts(
      input,
      openLibrary,
      assetPath,
      revisionId,
      sourceExecution,
      sourceExecution.includeVideoMetadata !== false,
    );
  }

  if (mediaType === 'audio') {
    return this.generateAudioArtifacts(input, openLibrary, assetPath, revisionId, sourceExecution);
  }

  throw new LibraryServiceError('INTERNAL_ERROR');
}

/**
* Slice E: offscreen model thumbnail generation for a queue
* job. The actual GPU render happens in Main (shared offscreen window); the
* Worker performs the size guard (spec 3D-14), stores the returned PNG as
* the standard `thumbnail` artifact, and records typed failures so the
* queue dedupes and the card keeps the generic 3D icon (never a badge —
* MODEL_* and FBX_* codes are benign-suppressed in thumbnail-support.ts).
*/
export async function processModelThumbnailJob(this: LibraryService, openLibrary: OpenLibrary, input: {
      libraryId: string;
      assetId: string;
      revisionId: string;
      relativeFilePath: string;
      byteSize: number | null;
    }, options: { renderer?: ModelThumbnailRenderer; signal: AbortSignal }): Promise<{ artifactId: string } | null> {
  // No renderer wired (direct unit harness / legacy): keep the benign
  // no-op so thumbnailStatus stays null and nothing is written.
  if (!options.renderer) return null;

  const outcome = await options.renderer({
    libraryId: input.libraryId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    relativeFilePath: input.relativeFilePath,
    byteSize: input.byteSize,
    signal: options.signal,
  });
  if (options.signal.aborted) {
    throw new DOMException('Model thumbnail cancelled during render.', 'AbortError');
  }
  if (outcome.status === 'failed') {
    this.writeModelThumbnailFailure(openLibrary, input.revisionId, outcome.errorCode);
    // The typed code lives on the failed artifact (the job's error_code);
    // the throw only routes into the queue's failure path.
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
      ...(outcome.reason === undefined ? {} : { cause: new Error(outcome.reason) }),
    });
  }
  if ('frames' in outcome) {
    // Multi-view renders are consumed by the AI analysis path
    // (renderModelViewsSheet); a thumbnail job receiving frames is a bug.
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
    });
  }
  return this.writeModelThumbnailArtifact(
    openLibrary,
    input,
    outcome,
    MODEL_THUMBNAIL_GENERATOR_VERSION,
  );
}

/** Persist an offscreen-rendered model thumbnail as the standard artifact. */
export function writeModelThumbnailArtifact(this: LibraryService, openLibrary: OpenLibrary, input: { libraryId: string; assetId: string; revisionId: string }, frame: { pngBytes: Uint8Array; width: number; height: number }, generatorVersion: string = MODEL_THUMBNAIL_GENERATOR_VERSION): { artifactId: string } {
  const bytes = frame.pngBytes;
  if (
    bytes.byteLength < 8
    || !Number.isInteger(frame.width)
    || !Number.isInteger(frame.height)
  ) {
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
    });
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'MEDIA_PROCESSING_FAILED',
      });
    }
  }

  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.png`;
  const artifactAbsPath = path.join(this.artifactsDir(openLibrary), artifactRelPath);
  mkdirSync(this.artifactsDir(openLibrary), { recursive: true });
  writeFileSync(artifactAbsPath, bytes, { flag: 'wx' });
  const now = new Date().toISOString();
  openLibrary.connection.transaction(() => {
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ? AND kind = 'thumbnail' AND invalidated_at IS NULL`,
      )
      .run(now, input.revisionId);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'thumbnail', 'image/png', ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        input.revisionId,
        bytes.byteLength,
        artifactRelPath,
        frame.width,
        frame.height,
        generatorVersion,
        now,
      );
  })();
  return { artifactId };
}

/**
* Terminal failed-artifact row for a model (dedupes re-enqueue and feeds
* the thumbnailStatus map). No file is written; failed artifacts are never
* served.
*/
export function writeModelThumbnailFailure(this: LibraryService, openLibrary: OpenLibrary, revisionId: string, errorCode: string, generatorVersion: string = MODEL_THUMBNAIL_GENERATOR_VERSION): void {
  const artifactId = randomUUID();
  openLibrary.connection
    .prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, 'thumbnail', 'image/png', 0, ?, ?, 'failed', ?, ?)`,
    )
    .run(
      artifactId,
      revisionId,
      `${artifactId}.png`,
      generatorVersion,
      errorCode,
      new Date().toISOString(),
    );
}

/**
* Render the first page of a PDF, or PDF-compatible AI file, to a standard
* thumbnail artifact with pdfjs-dist + @napi-rs/canvas.
* The render result is written through the same revision_artifacts pipeline
* as image thumbnails, so cards/Inspector/hover work unchanged.
*/
export async function generatePdfThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext): Promise<{ artifactId: string }> {
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.jpg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

  try {
    if (
      path.extname(assetPath).toLowerCase() === '.ai'
      && !hasPdfCompatibleIllustratorHeader(assetPath)
    ) {
      throw new Error('Illustrator file has no PDF-compatible representation.');
    }
    const pdfBytes = readFileSync(assetPath);
    if (pdfBytes.length === 0) {
      throw new Error('PDF file is empty.');
    }
    if (execution.signal?.aborted) {
      throw new DOMException('Media job cancelled before PDF load.', 'AbortError');
    }
    // pdfjs-dist 6.x ships an ESM build; load lazily so Worker startup is
    // unaffected when no PDFs are queued. The legacy build runs in Node.
    // Electron's bundled Node predates DOMMatrix (added in Node 24), and
    // pdfjs instantiates `new DOMMatrix` at module scope — importing it
    // without a polyfill crashes the whole Library Worker.
    // @napi-rs/canvas ships matching geometry classes; install them as
    // globals before pdfjs loads.
    const {
      createCanvas,
      DOMMatrix,
      DOMPoint,
      DOMRect,
      Path2D,
      ImageData,
    } = await import('@napi-rs/canvas');
    const workerGlobal = globalThis as {
      DOMMatrix?: unknown;
      DOMPoint?: unknown;
      DOMRect?: unknown;
      Path2D?: unknown;
      ImageData?: unknown;
    };
    if (workerGlobal.DOMMatrix === undefined) {
      Object.assign(globalThis, { DOMMatrix, DOMPoint, DOMRect });
    }
    if (workerGlobal.Path2D === undefined) {
      Object.assign(globalThis, { Path2D });
    }
    if (workerGlobal.ImageData === undefined) {
      Object.assign(globalThis, { ImageData });
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // The bundled pdfjs defaults workerSrc to "./pdf.worker.mjs" relative to
    // its chunk, which does not exist in the build directory; the fake
    // worker then fails to load the worker module. Point at the real module
    // shipped next to the package (resolved from the bundle's location).
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const requireFromBundle = createRequire(__filename);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      requireFromBundle.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    // pdfjs 6.x 把 wasm（jbig2/openjpeg）、cmaps、standard_fonts 放在
    // pdfjs-dist 顶层资源目录，不在 pdf.worker.mjs 同目录；不显式提供
    // wasmUrl 时，含 JBIG2 压缩图片的 PDF（扫描论文常见）无法解码
    // （ERR_MODULE_NOT_FOUND nulljbig2_nowasm_fallback.js），缩略图生成
    // 失败 → 文件夹封面反复失效重试。getDocument 的 URL 需以 / 结尾。
    const pdfjsRoot = path.dirname(requireFromBundle.resolve('pdfjs-dist/package.json'));
    const wasmUrl = pathToFileURL(`${pdfjsRoot}/wasm/`).href;
    const cMapUrl = pathToFileURL(`${pdfjsRoot}/cmaps/`).href;
    const standardFontDataUrl = pathToFileURL(`${pdfjsRoot}/standard_fonts/`).href;
    // Vite bundling breaks pdfjs's own node_utils bootstrap (it calls
    // createRequire(import.meta.url), which is undefined in the CJS
    // bundle), so internal image painting would hit the DOM canvas factory
    // and crash. Provide an explicit @napi-rs/canvas-backed factory class;
    // pdfjs instantiates it with `new CanvasFactory({ ownerDocument,
    // enableHWA })`.
    class NapiCanvasFactory {
      constructor(options: { ownerDocument?: unknown; enableHWA?: boolean } = {}) {
        void options;
      }
      create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
      }
      reset(
        canvasAndContext: { canvas: { width: number; height: number }; context: unknown },
        width: number,
        height: number,
      ) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
      }
      destroy(canvasAndContext: { canvas: { width: number; height: number }; context: unknown }) {
        // @napi-rs/canvas canvases are garbage-collected; no explicit disposal.
        void canvasAndContext;
      }
    }
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBytes),
      CanvasFactory: NapiCanvasFactory,
      wasmUrl,
      cMapUrl,
      standardFontDataUrl,
    });
    const pdfDocument = await loadingTask.promise;
    try {
      const page = await pdfDocument.getPage(1);
      // Render at a fixed 1024px-longest-edge for a crisp 512 card after
      // sharp downscale (pdfjs viewport units are PDF points, 72dpi).
      const baseViewport = page.getViewport({ scale: 1 });
      const longestEdge = Math.max(baseViewport.width, baseViewport.height);
      const scale = longestEdge > 0 ? 1024 / longestEdge : 1;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const context = canvas.getContext('2d');
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport,
      }).promise;
      if (execution.signal?.aborted) {
        throw new DOMException('Media job cancelled after PDF render.', 'AbortError');
      }
      const pngBuffer = canvas.toBuffer('image/png');
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      await runSharpDecoder(
        execution.signal,
        execution.lane,
        async () => {
          const sharp = this.options.sharpFn ?? requireSharp();
          await sharp(pngBuffer)
            .rotate()
            .toColourspace('srgb')
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72 })
            .toFile(artifactAbsPath);
        },
        { sourceByteSize: pngBuffer.byteLength, width, height },
      );
      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, 'thumbnail', 'image/jpeg', ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          outputStat.size,
          artifactRelPath,
          width || null,
          height || null,
          `pdfjs@${pdfjs.version ?? '6'}`,
          new Date().toISOString(),
        );
      return { artifactId };
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    // Failed PDF artifacts must land in revision_artifacts so the card shows
    // the failure badge and repair can re-run, mirroring image failures.
    try {
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, error_code, generated_at)
           VALUES (?, ?, 'thumbnail', 'application/pdf', 0, ?, NULL, NULL, ?, 'failed', ?, ?)`,
        )
        .run(
          artifactId,
          revisionId,
          artifactRelPath,
          `pdfjs@failed`,
          'UNSUPPORTED_FORMAT',
          new Date().toISOString(),
        );
    } catch {
      // Preserve the original error if the failure record itself fails.
    }
    throw error;
  }
}

/**
* HTML thumbnail via the injected Main offscreen capture.
* The PNG is downscaled with sharp and stored as a standard thumbnail
* artifact; a null render or a failed record keeps the card on the generic
* file icon (never `failed` for a benign missing renderer).
*/
/**
* font metadata for an asset path, or null when the file is
* unreadable/not a font. Never throws: an unparsable font only costs the
* sample sheet its label.
*/
export function readAssetFontMetadata(this: LibraryService, assetPath: string): FontMetadata | null {
  return readFontMetadata(assetPath);
}

export async function generateHtmlThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext, renderer: NonNullable<LibraryServiceOptions['documentThumbnailRenderer']>, options?: {
      readonly sample?: 'font';
      readonly generatorVersion?: string;
      readonly fontMetadata?: FontMetadata | null;
    }): Promise<{ artifactId: string } | null> {
  const sampleQuery =
    options?.sample === 'font'
      ? `&sample=font${fontSampleQuerySuffix(options.fontMetadata ?? null)}`
      : '';
  const url = `keel://source/${encodeURIComponent(input.libraryId)}/${encodeURIComponent(input.assetId)}?revision=${encodeURIComponent(revisionId)}${sampleQuery}`;
  if (execution.signal?.aborted) {
    throw new DOMException('Media job cancelled before HTML render.', 'AbortError');
  }
  const rendered = await renderer({
    libraryId: input.libraryId,
    assetId: input.assetId,
    revisionId,
    url,
    width: DOCUMENT_THUMBNAIL_WIDTH,
    // 字体样张按 16:9 采集（用户反馈：卡片封面不要 4:3）。
    ...(options?.sample === 'font' ? { height: FONT_THUMBNAIL_HEIGHT } : {}),
    signal: execution.signal,
  });
  if (!rendered) return null;
  if (execution.signal?.aborted) {
    throw new DOMException('Media job cancelled after HTML render.', 'AbortError');
  }

  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.jpg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  await runSharpDecoder(
    execution.signal,
    execution.lane,
    async () => {
      const sharp = this.options.sharpFn ?? requireSharp();
      await sharp(Buffer.from(rendered.png))
        .rotate()
        .toColourspace('srgb')
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toFile(artifactAbsPath);
    },
    {
      sourceByteSize: rendered.png.byteLength,
      width: rendered.width,
      height: rendered.height,
    },
  );
  const outputStat = statSync(artifactAbsPath);
  openLibrary.connection
    .prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, 'thumbnail', 'image/jpeg', ?, ?, ?, ?, ?, 'ready', ?)`,
    )
    .run(
      artifactId,
      revisionId,
      outputStat.size,
      artifactRelPath,
      rendered.width || null,
      rendered.height || null,
      options?.generatorVersion ?? DOCUMENT_THUMBNAIL_GENERATOR_VERSION,
      new Date().toISOString(),
    );
  return { artifactId };
}

// ── Image thumbnail (sharp) ────────────────────────────────────────

/**
* Replace one legacy Eagle/Billfish card preview with a bounded 512px
* derivative. The old row stays ready throughout decoding and is swapped in
* one SQLite transaction, so a failed conversion cannot blank the card.
*/
export async function normalizeImportedThumbnailArtifact(this: LibraryService, openLibrary: OpenLibrary, input: { assetId: string; revisionId: string }, execution: MediaExecutionContext): Promise<{ artifactId: string } | null> {
  const asset = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, current_revision_id
         FROM assets
        WHERE asset_id = ?`,
    )
    .get(input.assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
    } | undefined;
  if (!asset) {
    throw new StaleMediaRevisionError('Imported thumbnail asset was deleted before normalization.');
  }
  if (asset.current_revision_id !== input.revisionId) {
    throw new StaleMediaRevisionError('Imported thumbnail revision is no longer current.');
  }
  const mediaType = LibraryService.detectMediaType(asset.relative_file_path);
  const artifactKind = mediaType === 'video' ? 'video_poster' : 'thumbnail';
  const legacy = openLibrary.connection
    .prepare(
      `SELECT artifact_id, file_path, mime_type, byte_size, generator_version
         FROM revision_artifacts
        WHERE revision_id = ?
          AND kind = ?
          AND status = 'ready'
          AND invalidated_at IS NULL
        LIMIT 1`,
    )
    .get(input.revisionId, artifactKind) as {
      artifact_id: string;
      file_path: string;
      mime_type: string;
      byte_size: number;
      generator_version: string;
    } | undefined;
  if (!legacy || !isLegacyImportedThumbnailGenerator(legacy.generator_version)) {
    return null;
  }

  const oldArtifactPath = this.artifactFilePathFromRow(openLibrary, legacy.file_path);
  const newArtifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  let temporaryPath: string | undefined;
  let finalPath: string | undefined;
  let replacementCommitted = false;
  const throwIfCancelled = (): void => {
    if (execution.signal?.aborted) {
      throw new DOMException('Imported thumbnail normalization was cancelled.', 'AbortError');
    }
  };
  const assertCurrentRevision = (): void => {
    const current = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    if (!current || current.current_revision_id !== input.revisionId) {
      throw new StaleMediaRevisionError('Imported thumbnail revision is no longer current.');
    }
  };
  const markCurrentArtifact = (
    generatorVersion: string,
    previewDimensions: { width: number; height: number },
  ): void => {
    throwIfCancelled();
    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      throwIfCancelled();
      assertCurrentRevision();
      const current = openLibrary.connection
        .prepare(
          `SELECT artifact_id
             FROM revision_artifacts
            WHERE revision_id = ?
              AND kind = ?
              AND status = 'ready'
              AND invalidated_at IS NULL
            LIMIT 1`,
        )
        .get(input.revisionId, artifactKind) as { artifact_id: string } | undefined;
      if (!current || current.artifact_id !== legacy.artifact_id) {
        throw new Error('Imported thumbnail became stale before marking complete.');
      }
      const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
      const identity = artifactIdentityForPersistedRow({
        assetId: input.assetId,
        revisionId: input.revisionId,
        kind: artifactKind,
        generatorVersion,
      });
      const hasIdentityColumns = [
        'artifact_role',
        'generator_id',
        'settings_hash',
        'artifact_key',
      ].every((column) => artifactColumns.has(column));
      if (hasIdentityColumns && identity === null) {
        throw new Error('Imported thumbnail has no artifact identity role.');
      }
      const updateColumns = ['generator_version = ?'];
      const updateParameters: unknown[] = [generatorVersion];
      if (artifactColumns.has('width') && artifactColumns.has('height')) {
        updateColumns.push('width = ?', 'height = ?');
        updateParameters.push(previewDimensions.width, previewDimensions.height);
      }
      if (hasIdentityColumns) {
        updateColumns.push(
          'artifact_role = ?',
          'generator_id = ?',
          'settings_hash = ?',
          'artifact_key = ?',
        );
        updateParameters.push(
          identity!.role,
          identity!.generatorId,
          identity!.settingsHash,
          identity!.key,
        );
      }
      updateColumns.push('generated_at = ?');
      updateParameters.push(
        now,
        legacy.artifact_id,
        input.revisionId,
        input.assetId,
        input.revisionId,
      );
      const result = openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET ${updateColumns.join(', ')}
            WHERE artifact_id = ?
              AND revision_id = ?
              AND invalidated_at IS NULL
              AND EXISTS (
                SELECT 1 FROM assets
                 WHERE asset_id = ?
                   AND current_revision_id = ?
              )`,
        )
        .run(...updateParameters);
      if (result.changes !== 1) {
        assertCurrentRevision();
        throw new Error('Imported thumbnail became stale before marking complete.');
      }
    })();
  };

  try {
    const output = await runSharpDecoder(
      execution.signal,
      execution.lane,
      async () => {
        const sharp = this.options.sharpFn ?? requireSharp();
        const probe = sharp(oldArtifactPath, {
          failOn: 'error',
          sequentialRead: true,
          // This is a user-provided media artifact. Do not impose a
          // product-side pixel limit; cancellation remains the only caller
          // controlled stop condition.
          limitInputPixels: false,
        });
        const metadata = await probe.metadata();
        throwIfCancelled();
        const inputWidth = metadata.width ?? 0;
        const inputHeight = metadata.height ?? 0;
        const pages = metadata.pages ?? 1;
        if (!Number.isSafeInteger(pages) || pages < 1) {
          throw new Error('Sharp returned invalid page metadata for the imported thumbnail.');
        }
        const extension = path.extname(oldArtifactPath).toLowerCase();
        const format = metadata.format?.toLowerCase();
        const animated = pages > 1
          && (format === 'gif' || format === 'webp' || extension === '.gif' || extension === '.webp');
        const needsNormalization = importedThumbnailNeedsNormalization({
          byteSize: legacy.byte_size,
          height: inputHeight,
          width: inputWidth,
        });
        const verifyDecodedPixels = async (): Promise<void> => {
          // metadata() only reads container headers. Decode each page one at
          // a time so a bounded preview is not marked preserved while its
          // compressed pixel stream is truncated, and never materialize all
          // animation frames in one native buffer.
          for (let page = 0; page < pages; page += 1) {
            throwIfCancelled();
            const pageDecoder = sharp(oldArtifactPath, {
              animated: pages > 1,
              failOn: 'error',
              page,
              pages: 1,
              sequentialRead: true,
              limitInputPixels: false,
            });
            const rawDecoder = pageDecoder.raw?.();
            if (!rawDecoder?.toBuffer) {
              throw new Error('Sharp cannot validate imported thumbnail pixels.');
            }
            await rawDecoder.toBuffer();
            throwIfCancelled();
          }
        };
        // An imported animated preview is already the user's chosen card
        // image. Flattening it into a JPEG/WEBP would silently change its
        // semantics, so leave the copied artifact in place after validating
        // every frame and persist a current-generator marker. Without that
        // marker every subsequent startup backfill would enqueue it again.
        if (animated) {
          await verifyDecodedPixels();
          markCurrentArtifact(IMPORTED_ANIMATED_THUMBNAIL_GENERATOR, {
            height: inputHeight,
            width: inputWidth,
          });
          // Keep the existing artifact publication path unchanged. The
          // durable generator marker above is the completion record; no
          // newly generated artifact needs to be published for an
          // animation that was intentionally preserved in its original
          // format.
          return null;
        }
        // A source asset can be 4K while its external card preview is
        // already bounded. These are the actual preview dimensions, and the
        // pixel stream has now been decoded rather than merely inspected.
        if (!needsNormalization) {
          await verifyDecodedPixels();
          markCurrentArtifact(IMPORTED_THUMBNAIL_PRESERVED_GENERATOR, {
            height: inputHeight,
            width: inputWidth,
          });
          return null;
        }
        const hasAlpha = metadata.hasAlpha === true || metadata.channels === 4;
        const extensionForOutput = hasAlpha ? 'webp' : 'jpg';
        const relativePath = `${newArtifactId}.${extensionForOutput}`;
        const tempRelativePath = `${newArtifactId}.tmp`;
        const outputPath = path.join(artifactsDir, relativePath);
        const tempPath = path.join(artifactsDir, tempRelativePath);
        temporaryPath = tempPath;
        finalPath = outputPath;
        const qualityLevels = hasAlpha ? [80, 60, 40, 25] : [72, 56, 40, 28];
        const outputEdges = [
          IMPORTED_THUMBNAIL_MAX_EDGE,
          448,
          384,
          320,
          256,
        ];
        let outputByteSize = 0;
        for (const outputEdge of outputEdges) {
          throwIfCancelled();
          for (const quality of qualityLevels) {
            throwIfCancelled();
            const pipeline = sharp(oldArtifactPath, {
              failOn: 'error',
              sequentialRead: true,
              limitInputPixels: false,
            })
              .rotate()
              .toColourspace('srgb')
              .resize({
                width: outputEdge,
                height: outputEdge,
                fit: 'inside',
                withoutEnlargement: true,
              });
            if (hasAlpha) {
              await pipeline.webp({ quality }).toFile(tempPath);
            } else {
              await pipeline.jpeg({ quality }).toFile(tempPath);
            }
            throwIfCancelled();
            outputByteSize = statSync(tempPath).size;
            if (outputByteSize <= IMPORTED_THUMBNAIL_MAX_BYTES) break;
          }
          if (outputByteSize <= IMPORTED_THUMBNAIL_MAX_BYTES) break;
        }
        if (outputByteSize <= 0) throw new Error('Normalized imported thumbnail is empty.');
        if (outputByteSize > IMPORTED_THUMBNAIL_MAX_BYTES) {
          throw new Error('Normalized imported thumbnail exceeded the byte budget.');
        }
        throwIfCancelled();
        const outputMetadata = await sharp(tempPath, {
          failOn: 'none',
          sequentialRead: true,
          limitInputPixels: false,
        }).metadata();
        throwIfCancelled();
        const outputWidth = outputMetadata.width ?? 0;
        const outputHeight = outputMetadata.height ?? 0;
        if (
          !Number.isSafeInteger(outputWidth)
          || !Number.isSafeInteger(outputHeight)
          || outputWidth <= 0
          || outputHeight <= 0
          || outputWidth > IMPORTED_THUMBNAIL_MAX_EDGE
          || outputHeight > IMPORTED_THUMBNAIL_MAX_EDGE
        ) {
          throw new Error('Normalized imported thumbnail exceeded the edge budget.');
        }
        const outputStat = statSync(tempPath);
        if (outputStat.size <= 0 || outputStat.size > IMPORTED_THUMBNAIL_MAX_BYTES) {
          throw new Error('Normalized imported thumbnail exceeded the byte budget.');
        }
        return {
          byteSize: outputStat.size,
          height: outputHeight,
          mimeType: hasAlpha ? 'image/webp' : 'image/jpeg',
          outputHeight,
          outputWidth,
          relativePath,
          width: outputWidth,
        };
      },
    );

    if (output === null) return null;

    if (!temporaryPath || !finalPath) throw new Error('Normalized thumbnail output path is missing.');
    throwIfCancelled();
    renameSync(temporaryPath, finalPath);
    temporaryPath = undefined;

    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      throwIfCancelled();
      assertCurrentRevision();
      const current = openLibrary.connection
        .prepare(
          `SELECT artifact_id
             FROM revision_artifacts
            WHERE revision_id = ?
              AND kind = ?
              AND status = 'ready'
              AND invalidated_at IS NULL
            LIMIT 1`,
        )
        .get(input.revisionId, artifactKind) as {
          artifact_id: string;
        } | undefined;
      if (!current || current.artifact_id !== legacy.artifact_id) {
        throw new Error('Imported thumbnail became stale before replacement.');
      }
      const invalidated = openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE artifact_id = ?
              AND revision_id = ?
              AND invalidated_at IS NULL`,
        )
        .run(now, legacy.artifact_id, input.revisionId);
      if (invalidated.changes !== 1) {
        throw new Error('Imported thumbnail became stale before replacement.');
      }
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          newArtifactId,
          input.revisionId,
          artifactKind,
          output.mimeType,
          output.byteSize,
          output.relativePath,
          output.width,
          output.height,
          IMPORTED_THUMBNAIL_GENERATOR,
          now,
        );
    })();
    replacementCommitted = true;

    // The old copy is no longer reachable through the current artifact row.
    // Removal is best-effort: the reconciliation pass can clean an orphan
    // after a process crash between the transaction and this unlink.
    try {
      rmSync(oldArtifactPath, { force: true });
    } catch (error) {
      this.diagnose('imported-thumbnail.normalize-cleanup', error, {
        assetId: input.assetId,
        revisionId: input.revisionId,
        artifactId: legacy.artifact_id,
      });
    }
    return { artifactId: newArtifactId };
  } catch (error) {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    if (finalPath && !replacementCommitted) rmSync(finalPath, { force: true });
    this.diagnose('imported-thumbnail.normalize', error, {
      assetId: input.assetId,
      revisionId: input.revisionId,
      artifactId: legacy.artifact_id,
    });
    throw error;
  }
}

export async function generateImageThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext): Promise<{ artifactId: string }> {
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  // extension is decided after metadata (jpeg for
  // opaque images, webp only when alpha must be preserved).
  let artifactRelPath = `${artifactId}.webp`;
  let artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  let imageProcessed = false;

  try {
    const headerSize = execution.sourceWidth != null
      && execution.sourceHeight != null
      && execution.sourceWidth > 0
      && execution.sourceHeight > 0
      ? {
          width: execution.sourceWidth,
          height: execution.sourceHeight,
        }
      : await readImageDimensions(assetPath);
    if (headerSize) {
      this.persistExtractedImageDimensions(openLibrary, revisionId, headerSize);
    }
    const { inputWidth, inputHeight, gifMetadata } = await runSharpDecoder(
      execution.signal,
      execution.lane,
      async () => {
        const s = this.options.sharpFn ?? requireSharp();
        // random access enables libvips shrink-on-load
        // for JPEG (a 2400px photo decodes at half/quarter scale before the
        // 512px resize instead of full resolution). GIF keeps sequential
        // reads for animation safety; failOn stays 'none' for truncation
        // tolerance.
        const probe = s(assetPath, {
          failOn: 'none',
          sequentialRead: false,
          limitInputPixels: false,
        });
        const metadata = await probe.metadata();
        const pages = metadata.pages ?? 1;
        const isGif =
          metadata.format === 'gif' || assetPath.toLowerCase().endsWith('.gif');
        const isAnimatedGif = isGif && pages > 1;

        let page = 0;
        if (isAnimatedGif) {
          const scored: Array<{ page: number; score: number }> = [];
          for (const candidate of sampleGifPageIndices(pages)) {
            if (execution.signal?.aborted) {
              throw new DOMException('Media job cancelled during GIF page probe.', 'AbortError');
            }
            try {
              const samplePipeline = s(assetPath, {
                page: candidate,
                limitInputPixels: false,
              })
                .rotate()
                .toColourspace('srgb')
                .resize({
                  width: GIF_THUMBNAIL_PROBE_SIZE,
                  height: GIF_THUMBNAIL_PROBE_SIZE,
                  fit: 'inside',
                  withoutEnlargement: true,
                  // Keep the probe bounded to a small frame; the final card
                  // still preserves the existing thumbnail sampling policy.
                });
              const rawFn = samplePipeline.raw;
              if (!rawFn) {
                break;
              }
              const rawPipeline = rawFn.call(samplePipeline);
              const toBufferFn = rawPipeline.toBuffer;
              if (!toBufferFn) {
                break;
              }
              const sample = await toBufferFn.call(rawPipeline, {
                resolveWithObject: true,
              });
              const score = scoreRawRgbFrame(sample.data, sample.info.channels);
              scored.push({ page: candidate, score });
              // a recognizable frame ends the probe early —
              // bright meme GIFs usually need 1-3 decodes instead of the
              // full sample spread; dark GIFs fall through to the cap.
              if (score >= GIF_GOOD_PAGE_SCORE_THRESHOLD) break;
            } catch (error) {
              this.diagnose('thumbnail.gif-page-probe', error, {
                assetPath,
                page: candidate,
              });
            }
          }
          if (scored.length > 0) {
            page = pickBestGifPage(scored, pages);
          }
        }

        const pipeline = isAnimatedGif
          ? s(assetPath, {
              page,
              failOn: 'none',
              sequentialRead: true,
              limitInputPixels: false,
            })
          : s(assetPath, {
              failOn: 'none',
              sequentialRead: false,
              limitInputPixels: false,
            });
        const finalMeta = isAnimatedGif ? await pipeline.metadata() : metadata;
        const swapsDimensions = finalMeta.orientation !== undefined
          && finalMeta.orientation >= 5
          && finalMeta.orientation <= 8;
        const inputWidth = swapsDimensions ? (finalMeta.height ?? 0) : (finalMeta.width ?? 0);
        const inputHeight = swapsDimensions ? (finalMeta.width ?? 0) : (finalMeta.height ?? 0);

        const hasAlpha =
          (finalMeta as { hasAlpha?: boolean }).hasAlpha === true ||
          (finalMeta as { channels?: number }).channels === 4;
        // opaque images encode as JPEG (libjpeg-turbo is
        // several times faster than WebP and the card is a 512px preview);
        // alpha-bearing images keep WebP so transparency survives.
        artifactRelPath = hasAlpha ? `${artifactId}.webp` : `${artifactId}.jpg`;
        artifactAbsPath = path.join(artifactsDir, artifactRelPath);
        const sized = pipeline
          .rotate()
          .toColourspace('srgb')
          .resize({
            width: 512,
            height: 512,
            fit: 'inside',
            withoutEnlargement: true,
            // Card thumbnails stay bounded to 512px; the viewer still
            // resolves the full-fidelity source when opened.
          });
        try {
          if (hasAlpha) {
            await sized.webp({ quality: 80 }).toFile(artifactAbsPath);
          } else {
            await sized.jpeg({ quality: 72 }).toFile(artifactAbsPath);
          }
        } finally {
          // Windows cannot rm/rename the library while libvips still holds
          // the source or artifact. Destroying here is required: files:0
          // only skips the cache, it does not close the current pipeline.
          sized.destroy?.();
          pipeline.destroy?.();
          probe.destroy?.();
        }
        if (execution.signal?.aborted) {
          throw new DOMException('Media job cancelled after image decoding.', 'AbortError');
        }

        const gifMeta: GifExtractedMetadata | null = isGif
          ? buildGifExtractedMetadata({
              width: inputWidth,
              height: inputHeight,
              pages,
              delay: metadata.delay,
            })
          : null;
        return { inputWidth, inputHeight, gifMetadata: gifMeta };
      },
      {
        sourceByteSize: execution.sourceByteSize,
        width: headerSize?.width ?? execution.sourceWidth,
        height: headerSize?.height ?? execution.sourceHeight,
      },
    );

    const outputStat = statSync(artifactAbsPath);
    imageProcessed = true;

    // AssetSummary.width/height describe the source image, not the bounded
    // WebP card artifact. Keeping the source dimensions here is important
    // when a plugin replaces a large image: both the old and new card
    // thumbnails may be capped at 512px, while the actual resolution has
    // changed substantially.
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'thumbnail', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        // jpeg for opaque sources, webp for alpha.
        artifactRelPath.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
        outputStat.size,
        artifactRelPath,
        inputWidth || null,
        inputHeight || null,
        SHARP_THUMBNAIL_GENERATOR,
        new Date().toISOString(),
      );

    if (gifMetadata) {
      this.persistGifExtractedMetadata(
        openLibrary,
        revisionId,
        gifMetadata,
      );
    }

    // This runs inside the thumbnail job while that job is still marked
    // `running`; checking for any running thumbnail here would therefore
    // suppress EXIF author backfill for every queued thumbnail.
    await this.backfillAuthorFromExif(openLibrary, input.assetId, assetPath);

    return { artifactId };
  } catch (error) {
    const extension = path.extname(assetPath).toLowerCase();
    // A visible-window preemption or queue cancellation is not a decode
    // failure. Do not create a failed artifact, run a second header probe,
    // or misreport an AbortError as LIBRARY_NOT_WRITABLE; the queue will
    // leave the durable job queued for the newest viewport.
    if (execution.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      try {
        rmSync(artifactAbsPath, { force: true });
      } catch (cleanupError) {
        this.diagnose('thumbnail.abort-cleanup', cleanupError, {
          libraryId: input.libraryId,
          assetId: input.assetId,
        });
      }
      throw error;
    }
    if (
      !imageProcessed &&
      JPEG_IMAGE_EXTENSIONS.includes(extension as (typeof JPEG_IMAGE_EXTENSIONS)[number]) &&
      !execution.signal?.aborted
    ) {
      // Sharp correctly rejects severe JPEG truncation, while FFmpeg can
      // often still recover the decoded rows that precede the missing tail.
      // Keep this narrowly scoped to JPEGs and only enter it after the
      // normal Sharp path failed, so healthy images retain the faster
      // in-process decoder.
      const recovered = await this.tryGenerateTruncatedJpegThumbnail({
        openLibrary,
        assetPath,
        revisionId,
        artifactId,
        artifactRelPath,
        artifactAbsPath,
        execution,
        input,
      });
      if (recovered) return { artifactId };
    }
    if (!imageProcessed && (extension === '.tif' || extension === '.tiff')) {
      // libvips handles ordinary TIFFs efficiently. Complex/multi-part TIFFs
      // that it cannot decode fall back to the same OIIO + OCIO path as EXR
      // and TGA, without leaving a terminal sharp failure that would conflict
      // with the replacement thumbnail artifact.
      try {
        rmSync(artifactAbsPath, { force: true });
      } catch (cleanupError) {
        this.diagnose('thumbnail.tiff-sharp-cleanup', cleanupError, {
          libraryId: input.libraryId,
          assetId: input.assetId,
        });
      }
      this.diagnose('thumbnail.tiff-sharp-fallback', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
        extension,
      });
      return this.generateOiiOThumbnail(input, openLibrary, assetPath, revisionId, {}, execution);
    }

    // Write failed status
    const missingInput = isMissingPathError(error) || isDecoderMissingInputError(error);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, error_code, generated_at)
         VALUES (?, ?, 'thumbnail', 'image/webp', 0, ?, ?, 'failed', ?, ?)`,
      )
      .run(
        artifactId,
        revisionId,
        artifactRelPath,
        `sharp@${SHARP_VERSION}`,
        missingInput
          ? 'SOURCE_NOT_FOUND'
          : typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'THUMBNAIL_GENERATION_FAILED',
        new Date().toISOString(),
      );
    // GitHub #45: a second header open on a sync-volume placeholder can
    // block the Worker for minutes after Sharp already reported the file
    // missing. Dimensions come back when the source is readable again.
    if (!missingInput) {
      const headerSize = await readImageDimensions(assetPath);
      if (headerSize) {
        this.persistExtractedImageDimensions(openLibrary, revisionId, headerSize);
      }
    }

    throw serviceError(error, missingInput ? 'ASSET_NOT_FOUND' : 'LIBRARY_NOT_WRITABLE');
  }
}

export async function tryGenerateTruncatedJpegThumbnail(this: LibraryService, input: {
    openLibrary: OpenLibrary;
    assetPath: string;
    revisionId: string;
    artifactId: string;
    artifactRelPath: string;
    artifactAbsPath: string;
    execution: MediaExecutionContext;
    input: { libraryId: string; assetId: string };
  }): Promise<boolean> {
  const {
    openLibrary,
    assetPath,
    revisionId,
    artifactId,
    artifactRelPath,
    artifactAbsPath,
    execution,
  } = input;
  try {
    const result = await this.runFfmpeg(
      resolveFfmpegPath(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-err_detect',
        'ignore_err',
        '-i',
        assetPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=512:512:force_original_aspect_ratio=decrease',
        '-c:v',
        'libwebp',
        '-q:v',
        '80',
        artifactAbsPath,
      ],
      { signal: execution.signal },
    );
    const outputStat = existsSync(artifactAbsPath)
      ? statSync(artifactAbsPath)
      : null;
    if (!outputStat || outputStat.size === 0) {
      rmSync(artifactAbsPath, { force: true });
      return false;
    }
    if (result.exitCode !== 0) {
      this.diagnose('thumbnail.jpeg-truncated-recovery-warning', new Error(
        `FFmpeg returned ${result.exitCode} after producing a thumbnail.`,
      ), {
        libraryId: input.input.libraryId,
        assetId: input.input.assetId,
        stderr: result.stderr.slice(-400),
      });
    }
    const headerSize = await readImageDimensions(assetPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'thumbnail', 'image/webp', ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        outputStat.size,
        artifactRelPath,
        headerSize?.width ?? null,
        headerSize?.height ?? null,
        `ffmpeg@${FFMPEG_VERSION};truncated-jpeg-recovery`,
        new Date().toISOString(),
      );
    if (headerSize) {
      this.persistExtractedImageDimensions(openLibrary, revisionId, headerSize);
    }
    return true;
  } catch (recoveryError) {
    rmSync(artifactAbsPath, { force: true });
    this.diagnose('thumbnail.jpeg-truncated-recovery', recoveryError, {
      libraryId: input.input.libraryId,
      assetId: input.input.assetId,
    });
    return false;
  }
}

export function backfillMissingImageDimensions(this: LibraryService, libraryId: string, limit = 32): Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const imageSql = IMAGE_EXTENSIONS
    .map(() => 'LOWER(a.relative_file_path) LIKE ?')
    .join(' OR ');
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.relative_file_path, a.location_kind, a.linked_folder_id,
              a.current_revision_id, source_revision.byte_size AS source_byte_size
         FROM assets a
         JOIN revisions source_revision
           ON source_revision.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND a.current_revision_id IS NOT NULL
          AND (${imageSql})
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts ra
             WHERE ra.revision_id = a.current_revision_id
               AND ra.kind = 'extracted_metadata'
               AND ra.invalidated_at IS NULL
               AND ra.width IS NOT NULL
          )
        ORDER BY a.relative_file_path
        LIMIT ?`,
    )
    .all(
      ...IMAGE_EXTENSIONS.map((extension) => `%${extension}`),
      Math.max(1, Math.min(64, Math.trunc(limit))),
    ) as Array<{
      asset_id: string;
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      current_revision_id: string | null;
    source_byte_size: number;
    }>;
  const out: Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }> = [];
  for (const row of rows) {
    if (!row.current_revision_id) continue;
    const size = this.persistSourceImageDimensions(
      openLibrary,
      row.current_revision_id,
      row,
    );
    if (size) {
      const sourceDirect = isSourceDirectPreview({
        fileName: row.relative_file_path,
        mediaType: 'image',
        byteSize: row.source_byte_size,
        width: size.width,
        height: size.height,
      });
      out.push({
        assetId: row.asset_id,
        width: size.width,
        height: size.height,
        revisionId: row.current_revision_id,
        previewKind: sourceDirect ? 'source' : null,
        previewRevisionId: sourceDirect ? row.current_revision_id : null,
      });
    }
  }
  return out;
}

/**
* header-probe dimensions for the assets the user
* is currently looking at, so masonry placeholders get correct sizes before
* their thumbnails finish (no layout reflow glitch), and returns them for
* asset.dimensions.ready events.
*/
export function persistVisibleWindowImageDimensions(this: LibraryService, libraryId: string, assetIds: string[]): Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (assetIds.length === 0) return [];
  const capped = assetIds.slice(0, 64);
  const placeholders = capped.map(() => '?').join(',');
  const rows = openLibrary.connection
    .prepare(
      `SELECT assets.asset_id, assets.relative_file_path, assets.location_kind,
              assets.linked_folder_id, assets.current_revision_id,
              source_revision.byte_size AS source_byte_size
         FROM assets
         JOIN revisions source_revision
           ON source_revision.revision_id = assets.current_revision_id
        WHERE assets.asset_id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts ra
             WHERE ra.revision_id = assets.current_revision_id
               AND ra.kind = 'extracted_metadata'
               AND ra.invalidated_at IS NULL
               AND ra.width IS NOT NULL
          )`,
    )
    .all(...capped) as Array<{
      asset_id: string;
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      current_revision_id: string | null;
      source_byte_size: number;
    }>;
  const out: Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }> = [];
  for (const row of rows) {
    if (!row.current_revision_id) continue;
    const size = this.persistSourceImageDimensions(
      openLibrary,
      row.current_revision_id,
      row,
    );
    if (size) {
      const sourceDirect = isSourceDirectPreview({
        fileName: row.relative_file_path,
        mediaType: 'image',
        byteSize: row.source_byte_size,
        width: size.width,
        height: size.height,
      });
      out.push({
        assetId: row.asset_id,
        width: size.width,
        height: size.height,
        revisionId: row.current_revision_id,
        previewKind: sourceDirect ? 'source' : null,
        previewRevisionId: sourceDirect ? row.current_revision_id : null,
      });
    }
  }
  return out;
}

/**
* Async counterpart for the renderer's visible-window hint. The synchronous
* method above remains available to bounded worker/import code and tests,
* but a scroll report must not hold the single Worker event loop while it
* opens source files on a cold disk or a network-backed linked folder.
*
* The query and metadata writes remain owned by this service; only source
* header I/O is moved to fs/promises. Awaiting each probe lets pending
* search/preview messages run between files.
*/
export async function persistVisibleWindowImageDimensionsAsync(this: LibraryService, libraryId: string, assetIds: string[], signal?: AbortSignal): Promise<Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }>> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (assetIds.length === 0) return [];
  const capped = assetIds.slice(0, 64);
  const placeholders = capped.map(() => '?').join(',');
  const rows = openLibrary.connection
    .prepare(
      `SELECT assets.asset_id, assets.relative_file_path, assets.location_kind,
              assets.linked_folder_id, assets.current_revision_id,
              source_revision.byte_size AS source_byte_size
         FROM assets
         JOIN revisions source_revision
           ON source_revision.revision_id = assets.current_revision_id
        WHERE assets.asset_id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts ra
             WHERE ra.revision_id = assets.current_revision_id
               AND ra.kind = 'extracted_metadata'
               AND ra.invalidated_at IS NULL
               AND ra.width IS NOT NULL
          )`,
    )
    .all(...capped) as Array<{
      asset_id: string;
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      current_revision_id: string | null;
      source_byte_size: number;
    }>;
  const out: Array<{
    assetId: string;
    width: number;
    height: number;
    revisionId: string;
    previewKind: 'source' | null;
    previewRevisionId: string | null;
  }> = [];
  for (const row of rows) {
    if (signal?.aborted) {
      throw new DOMException('Visible-window probe aborted.', 'AbortError');
    }
    if (!row.current_revision_id) continue;
    const size = await this.imageDimensionsForAssetAsync(openLibrary, row);
    if (signal?.aborted) {
      throw new DOMException('Visible-window probe aborted.', 'AbortError');
    }
    if (!size) continue;
    this.persistExtractedImageDimensions(openLibrary, row.current_revision_id, size);
    const sourceDirect = isSourceDirectPreview({
      fileName: row.relative_file_path,
      mediaType: 'image',
      byteSize: row.source_byte_size,
      width: size.width,
      height: size.height,
    });
    out.push({
      assetId: row.asset_id,
      width: size.width,
      height: size.height,
      revisionId: row.current_revision_id,
      previewKind: sourceDirect ? 'source' : null,
      previewRevisionId: sourceDirect ? row.current_revision_id : null,
    });
  }
  return out;
}

export function persistSourceImageDimensionsForAssets(this: LibraryService, openLibrary: OpenLibrary, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  assetIds = assetIds.slice(0, 64);
  const placeholders = assetIds.map(() => '?').join(',');
  const rows = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, location_kind, linked_folder_id, current_revision_id
         FROM assets
        WHERE asset_id IN (${placeholders})`,
    )
    .all(...assetIds) as Array<{
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      current_revision_id: string | null;
    }>;
  for (const row of rows) {
    if (!row.current_revision_id) continue;
    this.persistSourceImageDimensions(openLibrary, row.current_revision_id, row);
  }
}

export function persistSourceImageDimensions(this: LibraryService, openLibrary: OpenLibrary, revisionId: string, asset: {
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
    }): { width: number; height: number } | null {
  if (LibraryService.detectMediaType(asset.relative_file_path) !== 'image') return null;
  const size = this.imageDimensionsForAsset(openLibrary, asset);
  if (!size) return null;
  this.persistExtractedImageDimensions(openLibrary, revisionId, size);
  return size;
}

/**
* Cheap header-probed width/height so masonry/sort do not wait for thumbnails
*. Skips when extracted_metadata already exists.
*/
export function persistExtractedImageDimensions(this: LibraryService, openLibrary: OpenLibrary, revisionId: string, size: { width: number; height: number }): void {
  if (
    !Number.isInteger(size.width)
    || !Number.isInteger(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    return;
  }
  const existing = openLibrary.connection
    .prepare(
      `SELECT artifact_id
         FROM revision_artifacts
        WHERE revision_id = ?
          AND kind = 'extracted_metadata'
          AND invalidated_at IS NULL`,
    )
    .get(revisionId) as { artifact_id: string } | undefined;
  if (existing) return;
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  try {
    writeFileSync(
      artifactAbsPath,
      JSON.stringify({ width: size.width, height: size.height }),
      'utf-8',
    );
    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        outputStat.size,
        artifactRelPath,
        size.width,
        size.height,
        `image-header@${SHARP_VERSION}`,
        new Date().toISOString(),
      );
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    this.diagnose('image.extracted-dimensions', error, { revisionId });
  }
}

/** Persist GIF duration / frame count as extracted_metadata (CU-D8). */
export function persistGifExtractedMetadata(this: LibraryService, openLibrary: OpenLibrary, revisionId: string, metadata: GifExtractedMetadata): void {
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  try {
    writeFileSync(artifactAbsPath, JSON.stringify(metadata, null, 2), 'utf-8');
    const outputStat = statSync(artifactAbsPath);
    const now = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ?
            AND kind = 'extracted_metadata'
            AND invalidated_at IS NULL`,
      )
      .run(now, revisionId);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, duration_ms, generator_version, status, generated_at)
         VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        outputStat.size,
        artifactRelPath,
        metadata.width || null,
        metadata.height || null,
        metadata.durationMs,
        `sharp-gif-meta@${SHARP_VERSION}`,
        now,
      );
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    this.diagnose('gif.extracted-metadata', error, { revisionId });
  }
}

/**
* Remember whether audio cards should prefer cover art, and queue a rebuild
* for grid thumbnails that would show a different image.
*/
export function setAudioPreviewPrefersCover(this: LibraryService, libraryId: string, preferCover: boolean): number {
  this.audioPreviewPrefersCover = preferCover;
  const openLibrary = this.requireOpenLibrary(libraryId);
  const audioExtensionSql = AUDIO_EXTENSION_NAMES
    .map(() => 'LOWER(a.relative_file_path) LIKE ?')
    .join(' OR ');
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id, ra.artifact_id,
              ra.mime_type, ra.width, ra.height, ra.generator_version
         FROM assets a
         JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND a.current_revision_id IS NOT NULL
          AND (${audioExtensionSql})
          AND ra.kind = 'thumbnail'
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL`,
    )
    .all(...AUDIO_EXTENSION_NAMES.map((extension) => `%.${extension}`)) as Array<{
      asset_id: string;
      current_revision_id: string;
      artifact_id: string;
      mime_type: string;
      width: number | null;
      height: number | null;
      generator_version: string;
    }>;
  const stale = rows.filter((row) => audioGridThumbnailNeedsRebuild({
    preferCover,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    generatorVersion: row.generator_version,
  }));
  if (stale.length === 0) return 0;
  const now = new Date().toISOString();
  const invalidate = openLibrary.connection.prepare(
    `UPDATE revision_artifacts
        SET invalidated_at = ?
      WHERE artifact_id = ?
        AND invalidated_at IS NULL`,
  );
  const activeJob = openLibrary.connection.prepare(
    `SELECT 1 FROM jobs
      WHERE asset_id = ?
        AND kind = 'generate_thumbnail'
        AND status IN ('queued', 'running', 'paused')
      LIMIT 1`,
  );
  const insert = openLibrary.connection.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
        attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 200, 0.0, 0, ?, ?)`,
  );
  let enqueued = 0;
  openLibrary.connection.transaction(() => {
    for (const row of stale) {
      invalidate.run(now, row.artifact_id);
      if (activeJob.get(row.asset_id)) continue;
      insert.run(
        randomUUID(),
        libraryId,
        row.asset_id,
        row.current_revision_id,
        now,
        now,
      );
      enqueued += 1;
    }
  })();
  return enqueued;
}

// ── Audio artifacts (ffprobe + waveform thumbnail) ─────────────────

/**
* Audio path: extract metadata, then store a
* grid `thumbnail` from embedded album art when present, otherwise a
* waveform PNG. Viewer strip stays a wide waveform (`video_poster`).
* Playback uses the native source via `keel://source` — no proxy needed.
*/
export async function generateAudioArtifacts(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext): Promise<{ artifactId: string }> {
  const ffprobePath = resolveFfprobePath();
  const ffmpegPath = resolveFfmpegPath();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });

  let hasAttachedPicture = false;
  try {
    const probe = await this.probeVideoMetadataForRevision(
      input, openLibrary, assetPath, revisionId, ffprobePath, execution,
    );
    hasAttachedPicture = probe?.hasAttachedPicture ?? false;
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'ffmpeg-audio');
    if (resourceError) throw resourceError;
    this.diagnose('audio-probe', error, { libraryId: input.libraryId, assetId: input.assetId });
  }

  const preferCover = this.audioPreviewPrefersCover;
  let thumbnailArtifactId: string | null = null;
  if (preferCover && hasAttachedPicture) {
    try {
      thumbnailArtifactId = await this.generateAudioAlbumCoverThumbnail(
        input,
        openLibrary,
        assetPath,
        revisionId,
        ffmpegPath,
        artifactsDir,
        execution,
      );
    } catch (error) {
      const resourceError = asMediaResourceExhaustedError(error, 'ffmpeg-audio-cover');
      if (resourceError) throw resourceError;
      this.diagnose('audio-album-cover', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
      });
    }
  }

  if (!thumbnailArtifactId) {
    try {
      thumbnailArtifactId = await this.generateAudioWaveformPng(
        input,
        openLibrary,
        assetPath,
        revisionId,
        ffmpegPath,
        artifactsDir,
        execution,
        {
          kind: 'thumbnail',
          width: AUDIO_WAVEFORM_COVER_WIDTH,
          height: AUDIO_WAVEFORM_COVER_HEIGHT,
          flattenBackground: { ...AUDIO_WAVEFORM_COVER_BACKGROUND },
          forcedWaveform: hasAttachedPicture && !preferCover,
        },
      );
    } catch (error) {
      const resourceError = asMediaResourceExhaustedError(error, 'ffmpeg-audio-waveform');
      if (resourceError) throw resourceError;
      this.diagnose('audio-waveform', error, { libraryId: input.libraryId, assetId: input.assetId });
    }
  }

  try {
    await this.generateAudioWaveformPng(
      input,
      openLibrary,
      assetPath,
      revisionId,
      ffmpegPath,
      artifactsDir,
      execution,
      {
        kind: 'video_poster',
        width: AUDIO_WAVEFORM_VIEWER_WIDTH,
        height: AUDIO_WAVEFORM_VIEWER_HEIGHT,
        // Viewer shell paints theme --ui-pane; flatten to near-black so fill
        // stretch does not flash a light letterbox fringe.
        flattenBackground: { r: 0x1a, g: 0x1c, b: 0x1f },
      },
    );
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'ffmpeg-audio-viewer-waveform');
    if (resourceError) throw resourceError;
    this.diagnose('audio-waveform-viewer', error, {
      libraryId: input.libraryId,
      assetId: input.assetId,
    });
  }

  if (!thumbnailArtifactId) {
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
    });
  }

  return { artifactId: thumbnailArtifactId };
}

/**
* Extract the attached picture stream and store it as the grid `thumbnail`
*. Uses the same 512px-inside encode as image cards so
* album art keeps its aspect instead of being flattened onto the 4:3
* waveform stage.
*/
export async function generateAudioAlbumCoverThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, artifactsDir: string, execution: MediaExecutionContext): Promise<string | null> {
  const artifactId = randomUUID();
  let artifactRelPath = `${artifactId}.jpg`;
  let artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  const tempAbsPath = path.join(artifactsDir, `${artifactId}.cover-tmp.png`);

  try {
    const result = await this.runFfmpeg(ffmpegPath, [
      '-y',
      '-i', assetPath,
      '-an',
      '-map', '0:v:0',
      '-frames:v', '1',
      '-update', '1',
      tempAbsPath,
    ], { signal: execution.signal });

    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg album-cover extract exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`,
      );
    }

    const { inputWidth, inputHeight, mimeType } = await runSharpDecoder(
      execution.signal,
      execution.lane,
      async () => {
        const sharp = this.options.sharpFn ?? requireSharp();
        const pipeline = sharp(tempAbsPath, {
          failOn: 'none',
          sequentialRead: false,
          limitInputPixels: false,
        });
        const metadata = await pipeline.metadata();
        const swapsDimensions = metadata.orientation !== undefined
          && metadata.orientation >= 5
          && metadata.orientation <= 8;
        const inputWidth = swapsDimensions ? (metadata.height ?? 0) : (metadata.width ?? 0);
        const inputHeight = swapsDimensions ? (metadata.width ?? 0) : (metadata.height ?? 0);
        if (inputWidth <= 0 || inputHeight <= 0) {
          throw new Error('Attached picture has no usable pixel size.');
        }
        const hasAlpha =
          (metadata as { hasAlpha?: boolean }).hasAlpha === true ||
          (metadata as { channels?: number }).channels === 4;
        artifactRelPath = hasAlpha ? `${artifactId}.webp` : `${artifactId}.jpg`;
        artifactAbsPath = path.join(artifactsDir, artifactRelPath);
        const sized = pipeline
          .rotate()
          .toColourspace('srgb')
          .resize({
            width: 512,
            height: 512,
            fit: 'inside',
            withoutEnlargement: true,
          });
        try {
          if (hasAlpha) {
            await sized.webp({ quality: 80 }).toFile(artifactAbsPath);
          } else {
            await sized.jpeg({ quality: 72 }).toFile(artifactAbsPath);
          }
        } finally {
          sized.destroy?.();
          pipeline.destroy?.();
        }
        return {
          inputWidth,
          inputHeight,
          mimeType: hasAlpha ? 'image/webp' : 'image/jpeg',
        };
      },
      {
        width: 512,
        height: 512,
      },
    );

    rmSync(tempAbsPath, { force: true });

    const outputStat = statSync(artifactAbsPath);
    if (!this.audioPreviewPrefersCover) {
      rmSync(artifactAbsPath, { force: true });
      return null;
    }
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'thumbnail', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        mimeType,
        outputStat.size,
        artifactRelPath,
        inputWidth || null,
        inputHeight || null,
        AUDIO_WAVEFORM_GENERATOR,
        new Date().toISOString(),
      );

    return artifactId;
  } catch (error) {
    rmSync(tempAbsPath, { force: true });
    rmSync(artifactAbsPath, { force: true });
    throw error;
  }
}

/**
* Render a mono waveform PNG for grid cover (`thumbnail`) or viewer strip
* (`video_poster` for audio).
*/
export async function generateAudioWaveformPng(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, artifactsDir: string, execution: MediaExecutionContext, options: {
      kind: 'thumbnail' | 'video_poster';
      width: number;
      height: number;
      flattenBackground: { r: number; g: number; b: number };
      forcedWaveform?: boolean;
    }): Promise<string> {
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.png`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  const tempAbsPath = path.join(artifactsDir, `${artifactId}.wave-tmp.png`);

  try {
    const result = await this.runFfmpeg(ffmpegPath, [
      '-y',
      '-i', assetPath,
      '-filter_complex',
      `aformat=channel_layouts=mono,compand,showwavespic=s=${options.width}x${options.height}:colors=${AUDIO_WAVEFORM_COVER_STROKE}:scale=sqrt`,
      '-frames:v', '1',
      '-update', '1',
      tempAbsPath,
    ], { signal: execution.signal });

    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg waveform exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`,
      );
    }

    await runSharpDecoder(execution.signal, execution.lane, async () => {
      const sharp = this.options.sharpFn ?? requireSharp();
      const flatten = sharp(tempAbsPath).flatten?.({
        background: { ...options.flattenBackground },
      });
      if (!flatten?.png || !flatten.toFile) {
        throw new Error('Sharp flatten/png API unavailable for waveform covers.');
      }
      await flatten.png().toFile(artifactAbsPath);
    }, {
      width: options.width,
      height: options.height,
    });
    rmSync(tempAbsPath, { force: true });

    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, ?, 'image/png', ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        options.kind,
        outputStat.size,
        artifactRelPath,
        options.width,
        options.height,
        options.forcedWaveform
          ? `${AUDIO_WAVEFORM_GENERATOR}+${AUDIO_FORCED_WAVEFORM_GENERATOR_MARK}`
          : AUDIO_WAVEFORM_GENERATOR,
        new Date().toISOString(),
      );

    return artifactId;
  } catch (error) {
    rmSync(tempAbsPath, { force: true });
    rmSync(artifactAbsPath, { force: true });
    this.writeFailedArtifact(
      openLibrary,
      artifactId,
      revisionId,
      options.kind,
      'image/png',
      artifactRelPath,
      AUDIO_WAVEFORM_GENERATOR,
      error,
    );
    throw error;
  }
}

// ── Video artifacts (ffprobe + ffmpeg) ─────────────────────────────

/**
* Generate a video poster and its revision's full metadata from one ffprobe.
* The durable metadata job reuses the same in-flight or persisted result;
* the poster falls back to a duration-only probe only when full metadata is
* unavailable or has no usable duration.
* Returns the poster artifact ID (the primary visual thumbnail).
*/
export async function generateVideoArtifacts(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext, includeMetadata: boolean): Promise<{ artifactId: string }> {
  const ffprobePath = resolveFfprobePath();
  const ffmpegPath = resolveFfmpegPath();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });

  let posterArtifactId: string | null = null;
  let durationSec: number | null = null;

  try {
    // Queue poster jobs used to run a duration-only ffprobe while the
    // separate metadata job ran a full ffprobe for the same revision. A
    // shared full probe supplies both the poster seek point and Inspector
    // metadata without waiting for another queue job.
    const probed = await this.probeVideoMetadataForRevision(
      input, openLibrary, assetPath, revisionId, ffprobePath, execution,
    );
    durationSec = probed && probed.durationSec > 0 ? probed.durationSec : null;
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'ffprobe');
    if (resourceError) throw resourceError;
    this.diagnose(
      includeMetadata ? 'video-probe' : 'video-poster-metadata-probe',
      error,
      { libraryId: input.libraryId, assetId: input.assetId },
    );
    // Continue with the poster even if full metadata probing fails. The
    // poster helper can still make a duration-only attempt.
  }

  // 2. Video poster
  try {
    posterArtifactId = await this.generateVideoPoster(
      input, openLibrary, assetPath, revisionId, ffmpegPath, ffprobePath,
      artifactsDir, execution, durationSec,
    );
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'ffmpeg-video-poster');
    if (resourceError) throw resourceError;
    this.diagnose('video-poster', error, { libraryId: input.libraryId, assetId: input.assetId });
    // Continue with remaining artifacts
  }

  if (!posterArtifactId) {
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
    });
  }

  return { artifactId: posterArtifactId };
}

export function enqueueVideoMetadataJob(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string, priority: number): void {
  const asset = openLibrary.connection
    .prepare(
      `SELECT location_kind, linked_folder_id, relative_file_path,
              current_revision_id, availability
         FROM assets
        WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .get(assetId) as {
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
    } | undefined;
  if (!asset || this.isExplicitlyIgnored(
    openLibrary,
    asset.location_kind,
    asset.linked_folder_id,
    asset.relative_file_path,
    'asset',
  )) return;
  const terminalArtifact = openLibrary.connection.prepare(
    `SELECT artifact_id, status FROM revision_artifacts WHERE revision_id = ? AND kind = 'extracted_metadata'
      AND status IN ('ready', 'failed') AND invalidated_at IS NULL
      AND generator_version = ? LIMIT 1`,
  ).get(revisionId, FFMPEG_METADATA_GENERATOR) as { artifact_id: string; status: 'ready' | 'failed' } | undefined;
  const active = openLibrary.connection.prepare(
    `SELECT job_id FROM jobs WHERE asset_id = ? AND revision_id = ? AND kind = 'extract_metadata'
      AND status IN ('queued', 'running', 'paused') LIMIT 1`,
  ).get(assetId, revisionId) as { job_id: string } | undefined;
  const admission = admitArtifactJob({
    assetId,
    revisionId,
    currentRevisionId: asset.current_revision_id,
    mediaType: LibraryService.detectMediaType(asset.relative_file_path),
    jobKind: 'extract_metadata',
    availability: asset.availability,
    ignored: false,
    readyArtifact: terminalArtifact?.status === 'ready',
    failedArtifact: terminalArtifact?.status === 'failed',
    activeJob: active !== undefined,
  });
  if (!admission.admitted) return;
  const now = new Date().toISOString();
  openLibrary.connection.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
        attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'extract_metadata', 'queued', ?, 0.0, 0, ?, ?)`,
  ).run(randomUUID(), openLibrary.summary.libraryId, assetId, revisionId, priority, now, now);
}

/**
* Enqueue bounded RAW technical-metadata work without coupling it to the
* card thumbnail. Header-only artifacts are intentionally not terminal:
* they provide layout dimensions, but the Inspector still needs the later
* EXIF/IPTC/XMP projection. A successful no-metadata job is terminal at the
* job layer so unsupported/metadata-less camera files do not requeue on
* every browse refresh. The queue also persists a normalized, empty
* metadata artifact so the terminal state is visible to readers.
*/
export function requeueRawImageMetadataJobs(this: LibraryService, openLibrary: OpenLibrary, options: { assetIds?: readonly string[]; limit: number; extensions?: 'raw' | 'embedded' }): { admitted: number; probed: number } {
  const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
  const selectedSql = selectedIds.length > 0
    ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
    : '';
  const extensionMatch = options.extensions === 'embedded'
    ? embeddedImageMetadataExtensionMatchSql(openLibrary.connection, 'a')
    : rawImageExtensionMatchSql(openLibrary.connection, 'a');
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit)));
  const retryCutoff = new Date(Date.now() - RAW_IMAGE_METADATA_RETRY_DELAY_MS).toISOString();
  const retryRows = openLibrary.connection
    .prepare(
      `SELECT j.job_id
         FROM jobs j
         JOIN assets a ON a.asset_id = j.asset_id
        WHERE j.library_id = ?
          AND j.kind = 'extract_metadata'
          AND j.status = 'failed'
          AND j.error_code = 'RAW_METADATA_EXTRACTION_FAILED'
          AND j.attempt_count < ?
          AND j.updated_at <= ?
          AND a.deleted_at IS NULL
          AND a.current_revision_id = j.revision_id
          AND a.availability = 'available'
          ${selectedSql}
          AND NOT EXISTS (
            SELECT 1 FROM linked_folders loff
             WHERE loff.folder_id = a.linked_folder_id
               AND loff.status = 'offline'
          )
          AND ${extensionMatch.sql}
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts complete_metadata
             WHERE complete_metadata.revision_id = a.current_revision_id
               AND complete_metadata.kind = 'extracted_metadata'
               AND complete_metadata.status = 'ready'
               AND complete_metadata.invalidated_at IS NULL
               AND complete_metadata.generator_version = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts failed_metadata
             WHERE failed_metadata.revision_id = a.current_revision_id
               AND failed_metadata.kind = 'extracted_metadata'
               AND failed_metadata.status = 'failed'
               AND failed_metadata.invalidated_at IS NULL
          )
        ORDER BY j.updated_at, j.job_id
        LIMIT ?`,
    )
    .all(
      openLibrary.summary.libraryId,
      RAW_IMAGE_METADATA_MAX_ATTEMPTS,
      retryCutoff,
      ...selectedIds,
      ...extensionMatch.params,
      EMBEDDED_IMAGE_METADATA_GENERATOR,
      limit,
    ) as Array<{ job_id: string }>;
  if (retryRows.length === 0) return { admitted: 0, probed: 0 };
  const now = new Date().toISOString();
  const requeue = openLibrary.connection.prepare(
    `UPDATE jobs
        SET status = 'queued', progress = 0.0,
            error_code = NULL, error_detail = NULL, updated_at = ?
      WHERE job_id = ? AND status = 'failed'`,
  );
  let admitted = 0;
  openLibrary.connection.transaction(() => {
    for (const row of retryRows) admitted += requeue.run(now, row.job_id).changes;
  })();
  return { admitted, probed: retryRows.length };
}

/** Requeue only due RAW failures; this path never probes the catalog cursor. */
export function requeueRawImageMetadataBackfillRetries(this: LibraryService, libraryId: string, limit = 256): number {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) return 0;
  const pending = Number((openLibrary.connection
    .prepare(
      `SELECT COUNT(*) AS count
         FROM jobs
        WHERE library_id = ?
          AND kind = 'extract_metadata'
          AND status IN ('queued', 'running', 'paused')`,
    )
    .get(libraryId) as { count: number } | undefined)?.count ?? 0);
  const available = Math.max(0, Math.min(500, Math.trunc(limit)) - pending);
  if (available === 0) return 0;
  return this.requeueRawImageMetadataJobs(openLibrary, { limit: available }).admitted;
}

/**
* A ready extracted_metadata row whose width or height is not a positive
* pixel size was a failed probe (commonly an EXIF stub of 0×0). It must not
* stay terminal: invalidate it and put the metadata job back on the queue
* so the container header can replace it.
*/
export function requeueNonPositiveExtractedImageDimensions(this: LibraryService, openLibrary: OpenLibrary, options: {
      assetIds: readonly string[];
      extension: { sql: string; params: readonly string[] };
      limit: number;
    }): void {
  const selectedSql = options.assetIds.length > 0
    ? `AND a.asset_id IN (${options.assetIds.map(() => '?').join(',')})`
    : '';
  const rows = openLibrary.connection
    .prepare(
      `SELECT ra.artifact_id, a.current_revision_id AS revision_id
         FROM assets a
         JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.current_revision_id IS NOT NULL
          AND a.availability = 'available'
          ${selectedSql}
          AND ${options.extension.sql}
          AND ra.kind = 'extracted_metadata'
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL
          AND (
            (ra.width IS NOT NULL AND ra.width <= 0)
            OR (ra.height IS NOT NULL AND ra.height <= 0)
          )
        LIMIT ?`,
    )
    .all(
      ...options.assetIds,
      ...options.extension.params,
      options.limit,
    ) as Array<{ artifact_id: string; revision_id: string }>;
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const invalidate = openLibrary.connection.prepare(
    `UPDATE revision_artifacts
        SET invalidated_at = ?
      WHERE artifact_id = ?
        AND invalidated_at IS NULL`,
  );
  const requeue = openLibrary.connection.prepare(
    `UPDATE jobs
        SET status = 'queued', progress = 0.0,
            error_code = NULL, error_detail = NULL, updated_at = ?
      WHERE revision_id = ?
        AND kind = 'extract_metadata'
        AND status IN ('succeeded', 'failed', 'cancelled')`,
  );
  openLibrary.connection.transaction(() => {
    for (const row of rows) {
      invalidate.run(now, row.artifact_id);
      requeue.run(now, row.revision_id);
    }
  })();
}

export function enqueueRawImageMetadataJobs(this: LibraryService, openLibrary: OpenLibrary, options: {
      assetIds?: readonly string[];
      limit?: number;
      /** The same durable job kind serves RAW and common image containers. */
      extensions?: 'raw' | 'embedded';
    } = {}): RawMetadataBackfillProbeOutcome {
  const targeted = options.assetIds !== undefined;
  const isBackfill = options.extensions !== 'embedded' && !targeted;
  const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
  if (targeted && selectedIds.length === 0) {
    return { admitted: 0, probed: 0, budgetCapped: true };
  }
  const selectedSql = selectedIds.length > 0
    ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
    : '';
  const extensionMatch = options.extensions === 'embedded'
    ? embeddedImageMetadataExtensionMatchSql(openLibrary.connection, 'a')
    : rawImageExtensionMatchSql(openLibrary.connection, 'a');
  this.requeueNonPositiveExtractedImageDimensions(openLibrary, {
    assetIds: selectedIds,
    extension: extensionMatch,
    limit: options.limit === undefined
      ? 64
      : Math.max(1, Math.min(64, Math.trunc(options.limit))),
  });
  // Metadata is a secondary Inspector aid. Keep each enqueue call bounded;
  // the regular background scheduler will admit the next batch after the
  // primary thumbnail wave yields.
  const limit = options.limit === undefined
    ? 256
    : Math.max(1, Math.min(500, Math.trunc(options.limit)));
  // Backfill is a secondary maintenance lane. Keep its durable queue bounded
  // so each scheduler turn does not rescan every asset while hundreds of
  // metadata jobs are already waiting. The jobs library/status index makes
  // this count cheap; explicit asset requests bypass the cap so visible or
  // newly-mutated assets still receive immediate derived work.
  const pendingMetadataCount = options.assetIds === undefined
    ? Number((openLibrary.connection
        .prepare(
          `SELECT COUNT(*) AS count
             FROM jobs
            WHERE library_id = ?
              AND kind = 'extract_metadata'
              AND status IN ('queued', 'running', 'paused')`,
        )
        .get(openLibrary.summary.libraryId) as { count: number } | undefined)?.count ?? 0)
    : 0;
  const availableAdmissionLimit = Math.max(0, limit - pendingMetadataCount);
  // 全局上限已满：本轮 0 结果是「排队预算用尽」而不是「候选扫完」，不得据此标记
  // exhausted。
  if (availableAdmissionLimit === 0) {
    return { admitted: 0, probed: 0, budgetCapped: true };
  }
  const admissionToken = isBackfill ? this.rawMetadataBackfillToken(openLibrary) : null;
  const persistedAdmission = isBackfill
    ? this.getRawMetadataBackfillAdmissionState(openLibrary.summary.libraryId)
    : null;
  const admissionStateMatches = admissionToken !== null
    && persistedAdmission?.token === admissionToken;
  if (admissionStateMatches && persistedAdmission?.exhausted) {
    return { admitted: 0, probed: 0, budgetCapped: false };
  }
  const cursorAssetId = admissionStateMatches ? persistedAdmission?.cursorAssetId ?? null : null;
  const cursorSql = isBackfill && cursorAssetId !== null
    ? 'AND a.asset_id > ?'
    : '';
  const cursorParams = cursorSql === '' ? [] : [cursorAssetId];
  const retryAdmission = this.requeueRawImageMetadataJobs(openLibrary, {
    ...(targeted ? { assetIds: selectedIds } : {}),
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    limit: availableAdmissionLimit,
  });
  const retryRows = retryAdmission.probed;
  let enqueued = retryAdmission.admitted;
  const now = new Date().toISOString();
  const remainingLimit = Math.max(0, availableAdmissionLimit - enqueued);
  if (remainingLimit === 0) {
    return { admitted: enqueued, probed: retryRows, budgetCapped: true };
  }
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id
         FROM assets a
        WHERE a.deleted_at IS NULL
          AND a.current_revision_id IS NOT NULL
          AND a.availability = 'available'
          ${selectedSql}
          ${cursorSql}
          AND NOT EXISTS (
            SELECT 1 FROM linked_folders loff
             WHERE loff.folder_id = a.linked_folder_id
               AND loff.status = 'offline'
          )
          AND ${extensionMatch.sql}
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
          AND NOT EXISTS (
            SELECT 1 FROM jobs active
             WHERE active.library_id = ?
               AND active.asset_id = a.asset_id
               AND active.revision_id = a.current_revision_id
               AND active.kind = 'extract_metadata'
               AND active.status IN ('queued', 'running', 'paused')
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs terminal
             WHERE terminal.library_id = ?
               AND terminal.asset_id = a.asset_id
               AND terminal.revision_id = a.current_revision_id
               AND terminal.kind = 'extract_metadata'
               AND terminal.status = 'succeeded'
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs failed_retry
             WHERE failed_retry.library_id = ?
               AND failed_retry.asset_id = a.asset_id
               AND failed_retry.revision_id = a.current_revision_id
               AND failed_retry.kind = 'extract_metadata'
               AND failed_retry.status = 'failed'
               AND failed_retry.error_code = 'RAW_METADATA_EXTRACTION_FAILED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts complete_metadata
             WHERE complete_metadata.revision_id = a.current_revision_id
               AND complete_metadata.kind = 'extracted_metadata'
               AND complete_metadata.status = 'ready'
               AND complete_metadata.invalidated_at IS NULL
               AND complete_metadata.generator_version = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts failed_metadata
             WHERE failed_metadata.revision_id = a.current_revision_id
               AND failed_metadata.kind = 'extracted_metadata'
               AND failed_metadata.status = 'failed'
               AND failed_metadata.invalidated_at IS NULL
          )
        ${isBackfill ? 'ORDER BY a.asset_id' : 'ORDER BY a.created_at DESC, a.relative_file_path'}
        LIMIT ?`,
    )
    .all(
      ...selectedIds,
      ...cursorParams,
      ...extensionMatch.params,
      openLibrary.summary.libraryId,
      openLibrary.summary.libraryId,
      openLibrary.summary.libraryId,
      EMBEDDED_IMAGE_METADATA_GENERATOR,
      remainingLimit,
    ) as Array<{ asset_id: string; current_revision_id: string }>;
  // A change observed between the token sampled at admission and the end
  // of the candidate read invalidates this page. Do not mark that newer
  // token exhausted or carry a cursor across the concurrent mutation.
  const tokenAfterProbe = isBackfill ? this.rawMetadataBackfillToken(openLibrary) : null;
  if (rows.length === 0) {
    if (isBackfill && admissionToken !== null) {
      // Preserve a cursor only when the token stayed stable during the
      // probe. A concurrent catalog mutation must restart from the keyset
      // boundary on the next token.
      const postToken = this.rawMetadataBackfillToken(openLibrary);
      if (postToken !== null) {
        const probeWasStable = tokenAfterProbe !== null
          && this.rawMetadataBackfillPostTokenMatchesOwnWrites(
            admissionToken,
            tokenAfterProbe,
          )
          && this.rawMetadataBackfillPostTokenMatchesOwnWrites(
            tokenAfterProbe,
            postToken,
          );
        this.persistRawMetadataBackfillAdmissionState(openLibrary, {
          token: postToken,
          cursorAssetId: probeWasStable ? cursorAssetId : null,
          exhausted: probeWasStable,
        });
      }
    }
    return {
      admitted: enqueued,
      probed: retryRows,
      budgetCapped: targeted,
    };
  }

  const insert = openLibrary.connection.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority,
        progress, attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'extract_metadata', 'queued', -25, 0.0, 0, ?, ?)`,
  );
  openLibrary.connection.transaction(() => {
    for (const row of rows) {
      const admission = admitArtifactJob({
        assetId: row.asset_id,
        revisionId: row.current_revision_id,
        currentRevisionId: row.current_revision_id,
        mediaType: 'image',
        jobKind: 'extract_metadata',
        availability: 'available',
        ignored: false,
        readyArtifact: false,
        failedArtifact: false,
        activeJob: false,
      });
      if (!admission.admitted) continue;
      enqueued += insert.run(
        randomUUID(),
        openLibrary.summary.libraryId,
        row.asset_id,
        row.current_revision_id,
        now,
        now,
      ).changes;
    }
  })();
  const budgetCapped = targeted || rows.length >= remainingLimit;
  if (isBackfill && admissionToken !== null) {
    const postToken = this.rawMetadataBackfillToken(openLibrary);
    if (postToken !== null) {
      const probeWasStable = tokenAfterProbe !== null
        && this.rawMetadataBackfillPostTokenMatchesOwnWrites(
          admissionToken,
          tokenAfterProbe,
        )
        && this.rawMetadataBackfillPostTokenMatchesOwnWrites(
          tokenAfterProbe,
          postToken,
        );
      this.persistRawMetadataBackfillAdmissionState(openLibrary, {
        token: postToken,
        cursorAssetId: probeWasStable
          ? rows.at(-1)?.asset_id ?? cursorAssetId
          : null,
        exhausted: probeWasStable && !budgetCapped,
      });
    }
  }
  return {
    admitted: enqueued,
    probed: retryRows + rows.length,
    // 候选填满预算说明可能还有下一批；定向探测与全局上限一律不参与判定。
    budgetCapped,
  };
}

/**
* Admit the next bounded RAW metadata batch for the idle secondary pump.
* This is intentionally separate from visible thumbnail admission so a
* large RAW catalogue is eventually drained without expanding the card
* queue or putting EXIF work on the first-content path.
*/
export function enqueueRawImageMetadataBackfill(this: LibraryService, libraryId: string, limit = 256): RawMetadataBackfillProbeOutcome {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return { admitted: 0, probed: 0, budgetCapped: true };
  }
  return this.enqueueRawImageMetadataJobs(openLibrary, { limit });
}

/** Return the delay before an eligible transient RAW metadata failure may retry. */
export function rawImageMetadataRetryDelayMs(this: LibraryService, libraryId: string): number | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // Leniently opened pre-status libraries cannot have durable metadata job
  // state. The secondary scheduler must treat them as having no retryable
  // RAW work instead of issuing a schema-incompatible query on every pump.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) return null;
  const extensionMatch = embeddedImageMetadataExtensionMatchSql(openLibrary.connection, 'a');
  const row = openLibrary.connection
    .prepare(
      `SELECT MIN(j.updated_at) AS updated_at
         FROM jobs j
         JOIN assets a ON a.asset_id = j.asset_id
        WHERE j.library_id = ?
          AND j.kind = 'extract_metadata'
          AND j.status = 'failed'
          AND j.error_code = 'RAW_METADATA_EXTRACTION_FAILED'
          AND j.attempt_count < ?
          AND a.deleted_at IS NULL
          AND a.current_revision_id = j.revision_id
          AND a.availability = 'available'
          AND NOT EXISTS (
            SELECT 1 FROM linked_folders loff
             WHERE loff.folder_id = a.linked_folder_id
               AND loff.status = 'offline'
          )
          AND ${extensionMatch.sql}
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts complete_metadata
             WHERE complete_metadata.revision_id = a.current_revision_id
               AND complete_metadata.kind = 'extracted_metadata'
               AND complete_metadata.status = 'ready'
               AND complete_metadata.invalidated_at IS NULL
               AND complete_metadata.generator_version = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts failed_metadata
             WHERE failed_metadata.revision_id = a.current_revision_id
               AND failed_metadata.kind = 'extracted_metadata'
               AND failed_metadata.status = 'failed'
               AND failed_metadata.invalidated_at IS NULL
          )`,
    )
    .get(
      openLibrary.summary.libraryId,
      RAW_IMAGE_METADATA_MAX_ATTEMPTS,
      ...extensionMatch.params,
      EMBEDDED_IMAGE_METADATA_GENERATOR,
    ) as { updated_at: string | null } | undefined;
  if (!row?.updated_at) return null;
  const updatedAt = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedAt)) return null;
  return Math.max(0, updatedAt + RAW_IMAGE_METADATA_RETRY_DELAY_MS - Date.now());
}

export function enqueuePaletteJob(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string, priority: number): boolean {
  const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const sourceDimensionColumns = artifactColumns.has('width') && artifactColumns.has('height')
    ? `,
              (SELECT source_metadata.width
                 FROM revision_artifacts source_metadata
                WHERE source_metadata.revision_id = a.current_revision_id
                  AND source_metadata.kind = 'extracted_metadata'
                  AND source_metadata.status = 'ready'
                  AND source_metadata.invalidated_at IS NULL
                ORDER BY source_metadata.generated_at DESC
                LIMIT 1) AS source_width,
              (SELECT source_metadata.height
                 FROM revision_artifacts source_metadata
                WHERE source_metadata.revision_id = a.current_revision_id
                  AND source_metadata.kind = 'extracted_metadata'
                  AND source_metadata.status = 'ready'
                  AND source_metadata.invalidated_at IS NULL
                ORDER BY source_metadata.generated_at DESC
                LIMIT 1) AS source_height`
    : ', NULL AS source_width, NULL AS source_height';
  const asset = openLibrary.connection
    .prepare(
      `SELECT a.location_kind, a.linked_folder_id, a.relative_file_path,
              a.current_revision_id, a.availability,
              source_revision.byte_size AS source_byte_size
              ${sourceDimensionColumns}
         FROM assets a
         LEFT JOIN revisions source_revision
           ON source_revision.revision_id = a.current_revision_id
        WHERE a.asset_id = ? AND a.deleted_at IS NULL`,
    )
  .get(assetId) as {
    location_kind: 'managed' | 'linked';
    linked_folder_id: string | null;
    relative_file_path: string;
    current_revision_id: string | null;
    availability: 'available' | 'missing';
    source_byte_size: number | null;
    source_width: number | null;
    source_height: number | null;
  } | undefined;
  if (!asset || this.isExplicitlyIgnored(
    openLibrary,
    asset.location_kind,
    asset.linked_folder_id,
    asset.relative_file_path,
    'asset',
  )) return false;
  if (!this.isPaletteEligibleAsset(openLibrary, assetId, revisionId)) {
    return false;
  }
  const source = openLibrary.connection.prepare(
    `SELECT artifact_id FROM revision_artifacts
      WHERE revision_id = ?
        AND kind IN ('thumbnail', 'video_poster')
        AND status = 'ready'
        AND invalidated_at IS NULL
      LIMIT 1`,
  ).get(revisionId);
  const sourceDirect = isSourceDirectPreview({
    fileName: asset.relative_file_path,
    mediaType: LibraryService.toSummaryMediaType(
      LibraryService.detectMediaType(asset.relative_file_path),
    ),
    byteSize: asset.source_byte_size ?? 0,
    width: asset.source_width,
    height: asset.source_height,
  });
  if (!source && !sourceDirect) return false;
  const terminal = openLibrary.connection.prepare(
    `SELECT artifact_id, status FROM revision_artifacts
      WHERE revision_id = ? AND kind = 'extracted_palette'
        AND status IN ('ready', 'failed') AND invalidated_at IS NULL LIMIT 1`,
  ).get(revisionId) as { artifact_id: string; status: 'ready' | 'failed' } | undefined;
  const active = openLibrary.connection.prepare(
    `SELECT job_id FROM jobs WHERE asset_id = ? AND revision_id = ?
      AND kind = 'extract_palette' AND status IN ('queued', 'running', 'paused') LIMIT 1`,
  ).get(assetId, revisionId) as { job_id: string } | undefined;
  const admission = admitArtifactJob({
    assetId,
    revisionId,
    currentRevisionId: asset.current_revision_id,
    mediaType: LibraryService.detectMediaType(asset.relative_file_path),
    jobKind: 'extract_palette',
    availability: asset.availability,
    ignored: false,
    readyArtifact: terminal?.status === 'ready',
    failedArtifact: terminal?.status === 'failed',
    activeJob: active !== undefined,
  });
  if (!admission.admitted) return false;
  const now = new Date().toISOString();
  const result = openLibrary.connection.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
        attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'extract_palette', 'queued', ?, 0.0, 0, ?, ?)`,
  ).run(randomUUID(), openLibrary.summary.libraryId, assetId, revisionId, priority, now, now);
  return result.changes > 0;
}

/**
* Palette extraction is only meaningful for assets with a visual surface.
* Audio waveform covers are deliberately excluded even though they use the
* `video_poster` artifact kind for viewer compatibility.
*/
export function isPaletteEligibleAsset(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string): boolean {
  const asset = openLibrary.connection.prepare(
    `SELECT relative_file_path, current_revision_id
       FROM assets
      WHERE asset_id = ?`,
  ).get(assetId) as {
    relative_file_path: string;
    current_revision_id: string | null;
  } | undefined;
  return Boolean(
    asset
    && asset.current_revision_id === revisionId
    && mediaTypeSupportsAutoPalette(LibraryService.detectMediaType(asset.relative_file_path)),
  );
}

export async function generateQueuedPaletteArtifact(this: LibraryService, libraryId: string, assetId: string, queuedRevisionId: string, execution: MediaExecutionContext): Promise<boolean> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const sourceDimensionColumns = artifactColumns.has('width') && artifactColumns.has('height')
    ? `,
           (SELECT source_metadata.width
              FROM revision_artifacts source_metadata
             WHERE source_metadata.revision_id = a.current_revision_id
               AND source_metadata.kind = 'extracted_metadata'
               AND source_metadata.status = 'ready'
               AND source_metadata.invalidated_at IS NULL
             ORDER BY source_metadata.generated_at DESC
             LIMIT 1) AS source_width,
           (SELECT source_metadata.height
              FROM revision_artifacts source_metadata
             WHERE source_metadata.revision_id = a.current_revision_id
               AND source_metadata.kind = 'extracted_metadata'
               AND source_metadata.status = 'ready'
               AND source_metadata.invalidated_at IS NULL
             ORDER BY source_metadata.generated_at DESC
             LIMIT 1) AS source_height`
    : ', NULL AS source_width, NULL AS source_height';
  const asset = openLibrary.connection.prepare(
    `SELECT a.relative_file_path, a.current_revision_id, a.availability,
            a.deleted_at, source_revision.byte_size AS source_byte_size
            ${sourceDimensionColumns}
       FROM assets a
       LEFT JOIN revisions source_revision
         ON source_revision.revision_id = a.current_revision_id
      WHERE a.asset_id = ?`,
  ).get(assetId) as {
    relative_file_path: string;
    current_revision_id: string | null;
    availability: 'available' | 'missing';
    deleted_at: string | null;
    source_byte_size: number | null;
    source_width: number | null;
    source_height: number | null;
  } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.current_revision_id !== queuedRevisionId) return false;
  if (!this.isPaletteEligibleAsset(openLibrary, assetId, queuedRevisionId)) return false;

  const source = openLibrary.connection.prepare(
    `SELECT artifact_id FROM revision_artifacts
      WHERE revision_id = ?
        AND kind IN ('thumbnail', 'video_poster')
        AND status = 'ready'
        AND invalidated_at IS NULL
      ORDER BY CASE kind WHEN 'thumbnail' THEN 0 ELSE 1 END
      LIMIT 1`,
  ).get(queuedRevisionId) as { artifact_id: string } | undefined;
  const sourceDirect = isSourceDirectPreview({
    fileName: asset.relative_file_path,
    mediaType: LibraryService.toSummaryMediaType(
      LibraryService.detectMediaType(asset.relative_file_path),
    ),
    byteSize: asset.source_byte_size ?? 0,
    width: asset.source_width,
    height: asset.source_height,
  });
  if (!source && !sourceDirect) {
    throw new LibraryServiceError('INTERNAL_ERROR', { reason: 'PALETTE_SOURCE_NOT_READY' });
  }
  const sourcePath = source
    ? this.getArtifactAbsolutePath(libraryId, source.artifact_id)
    : this.getCurrentMediaSource(libraryId, assetId, queuedRevisionId).absolutePath;
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(this.artifactsDir(openLibrary), artifactRelPath);

  openLibrary.connection.prepare(
    `UPDATE revision_artifacts SET invalidated_at = ?
      WHERE revision_id = ? AND kind = 'extracted_palette' AND invalidated_at IS NULL`,
  ).run(new Date().toISOString(), queuedRevisionId);

  try {
    const palette = await runSharpDecoder(execution.signal, execution.lane, async () => {
      const sharp = this.options.paletteSharpFn
        ?? (requireSharp() as unknown as PaletteSharpModule);
      // No `ensureAlpha()`: the extractor accepts RGB or RGBA and skips only
      // genuinely transparent pixels, so forcing a fourth channel on opaque
      // sources only widened the buffer it has to scan.
      const decoded = await sharp(sourcePath)
        .rotate()
        .toColourspace('srgb')
        .resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (execution.signal?.aborted) {
        throw new DOMException('Media job cancelled after palette decoding.', 'AbortError');
      }
      return extractRepresentativePalette(decoded.data, decoded.info.channels, 6);
    });
    if (palette.length === 0) {
      throw new Error('The decoded preview contains no visible pixels.');
    }
    const dominant = dominantColorMetrics(palette[0]!.hex);
    writeFileSync(artifactAbsPath, JSON.stringify(palette), 'utf-8');
    if (execution.signal?.aborted) {
      throw new DOMException('Media job cancelled after palette serialization.', 'AbortError');
    }
    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at, dominant_hue, dominant_lightness, dominant_saturation)
       VALUES (?, ?, 'extracted_palette', 'application/json', ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    ).run(
      artifactId,
      queuedRevisionId,
      outputStat.size,
      artifactRelPath,
      `serpent-palette@1;sharp@${SHARP_VERSION}`,
      new Date().toISOString(),
      dominant.hue,
      dominant.lightness,
      dominant.saturation,
    );
    return true;
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    if (execution.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
    openLibrary.connection.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, 'extracted_palette', 'application/json', 0, ?, ?, 'failed',
               'PALETTE_EXTRACTION_FAILED', ?)`,
    ).run(
      artifactId,
      queuedRevisionId,
      artifactRelPath,
      `serpent-palette@1;sharp@${SHARP_VERSION}`,
      new Date().toISOString(),
    );
    throw error;
  }
}

/**
* AI contact sheets are generated lazily, only when video
* analysis actually needs them. Proactive scheduling flooded converted
* libraries with doomed FFmpeg batches on every open. Returns false when
* the asset's revision changed mid-flight (caller cancels).
*/
export async function ensureVideoContactSheet(this: LibraryService, libraryId: string, assetId: string, execution: MediaExecutionContext = { signal: undefined }): Promise<boolean> {
  throwIfMediaExecutionAborted(execution.signal);
  const openLibrary = this.requireOpenLibrary(libraryId);
  const assetRow = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { current_revision_id: string | null } | undefined;
  const revisionId = assetRow?.current_revision_id ?? null;
  if (!revisionId) return false;
  const existing = openLibrary.connection
    .prepare(
      "SELECT status FROM revision_artifacts WHERE revision_id = ? AND kind = 'contact_sheet' AND invalidated_at IS NULL LIMIT 1",
    )
    .get(revisionId) as { status?: string } | undefined;
  if (existing?.status === 'ready') return true;
  // review fix: overlapping analysis requests for the same
  // video must share one generation, or the losers hit
  // UNIQUE(revision_id, kind) and mask the real outcome.
  const inFlightKey = `${libraryId}\u0000${revisionId}`;
  const inFlight = this.videoContactSheetInFlight.get(inFlightKey);
  // The last waiter can abort a producer before its promise settles. A new
  // request must start fresh instead of joining that abandoned generation.
  if (inFlight && !inFlight.controller.signal.aborted) {
    return await waitForSharedMediaOperation(inFlight, execution.signal);
  }
  if (existing) {
    // Explicit retry: clear the previous terminal row so either outcome —
    // a fresh ready sheet or a renewed failed marker — can register without
    // tripping UNIQUE(revision_id, kind).
    openLibrary.connection
      .prepare(
        "DELETE FROM revision_artifacts WHERE revision_id = ? AND kind = 'contact_sheet' AND invalidated_at IS NULL",
      )
      .run(revisionId);
  }
  const controller = new AbortController();
  const entry: {
    controller: AbortController;
    promise: Promise<boolean>;
    waiters: number;
  } = {
    controller,
    promise: Promise.resolve(false),
    waiters: 0,
  };
  entry.promise = (async () => {
    try {
      return await this.generateQueuedVideoArtifact(
        libraryId,
        assetId,
        revisionId,
        'generate_contact_sheet',
        { ...execution, signal: controller.signal },
      );
    } finally {
      if (this.videoContactSheetInFlight.get(inFlightKey) === entry) {
        this.videoContactSheetInFlight.delete(inFlightKey);
      }
    }
  })();
  this.videoContactSheetInFlight.set(inFlightKey, entry);
  return await waitForSharedMediaOperation(entry, execution.signal);
}

export async function generateQueuedVideoArtifact(this: LibraryService, libraryId: string, assetId: string, queuedRevisionId: string, kind: 'generate_contact_sheet' | 'generate_webm_proxy', execution: MediaExecutionContext): Promise<boolean> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const assetPath = this.resolveAssetPath(libraryId, assetId);
  const asset = openLibrary.connection.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  ).get(assetId) as { current_revision_id: string | null } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.current_revision_id !== queuedRevisionId) return false;
  const revisionId = queuedRevisionId;
  const ffmpegPath = resolveFfmpegPath();
  const ffprobePath = resolveFfprobePath();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  if (kind === 'generate_webm_proxy') {
    await this.generateVideoProxy({ libraryId, assetId }, openLibrary, assetPath, revisionId, ffmpegPath, artifactsDir, execution);
    return true;
  }
  // Eagle/Billfish conversions can register videos with
  // width/height-only metadata (no ffprobe ever ran), so duration is
  // unknown and contact sheets used to fail forever while every open
  // re-enqueued the whole doomed batch. Self-heal instead: probe on demand
  // and surface the real ffprobe failure.
  try {
    let metadata = this.getCurrentArtifact(libraryId, assetId, 'extracted_metadata');
    const readParsedMetadata = (): { durationMs?: number; width?: number; height?: number } | null => {
      if (metadata?.status !== 'ready') return null;
      try {
        return JSON.parse(
          readFileSync(path.join(artifactsDir, metadata.filePath), 'utf-8'),
        ) as { durationMs?: number; width?: number; height?: number };
      } catch {
        return null;
      }
    };
    let parsed = readParsedMetadata();
    if (!parsed || !Number.isFinite(parsed.durationMs) || (parsed.durationMs ?? 0) <= 0) {
      // probeVideoAsset now replaces any prior
      // extracted_metadata row transactionally AFTER a successful ffprobe,
      // so a failed probe never destroys conversion-recorded dimensions.
      const probed = await this.generateQueuedVideoMetadata(
        libraryId, assetId, revisionId, execution,
      );
      if (!probed) return false; // stale revision; caller cancels the job
      metadata = this.getCurrentArtifact(libraryId, assetId, 'extracted_metadata');
      parsed = readParsedMetadata();
    }
    const durationSec = (parsed?.durationMs ?? 0) / 1000;
    const width = Number.isFinite(parsed?.width) && (parsed?.width ?? 0) > 0
      ? parsed!.width!
      : 640;
    const height = Number.isFinite(parsed?.height) && (parsed?.height ?? 0) > 0
      ? parsed!.height!
      : 360;
    const dimensions = { width, height };
    if (!(durationSec > 0)) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'MEDIA_PROCESSING_FAILED',
        cause: new Error(`Video has no measurable duration after ffprobe: ${assetPath}`),
      });
    }
    await this.generateContactSheet(
      { libraryId, assetId }, openLibrary, assetPath, revisionId, ffmpegPath, artifactsDir,
      Math.max(durationSec, 0.1), dimensions, ffprobePath, execution,
    );
  } catch (error) {
    if (execution.signal?.aborted) throw error;
    // persist the terminal failure so the terminal-artifact
    // guard in ensureVideoContactSheet stops regenerating this sheet. The
    // next revision change resets it naturally.
    // Adversarial-review fix: generateContactSheet's own catch already
    // wrote a failed contact_sheet row; a second INSERT would violate the
    // partial UNIQUE(revision_id, kind) index and mask the real ffmpeg
    // error. Only write when no terminal row exists yet.
    const existingTerminal = openLibrary.connection
      .prepare(
        "SELECT 1 FROM revision_artifacts WHERE revision_id = ? AND kind = 'contact_sheet' AND status IN ('ready', 'failed') AND invalidated_at IS NULL LIMIT 1",
      )
      .get(revisionId);
    if (!existingTerminal) {
      this.writeFailedArtifact(
        openLibrary, randomUUID(), revisionId, 'contact_sheet', 'image/jpeg',
        `${randomUUID()}.txt`, `ffmpeg@${FFMPEG_VERSION}`, error,
      );
    }
    throw error;
  }
  return true;
}

export async function generateQueuedVideoMetadata(this: LibraryService, libraryId: string, assetId: string, queuedRevisionId: string, execution: MediaExecutionContext): Promise<boolean> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  ).get(assetId) as { current_revision_id: string | null } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.current_revision_id !== queuedRevisionId) return false;
  const probed = await this.probeVideoMetadataForRevision(
    { libraryId, assetId },
    openLibrary,
    this.resolveAssetPath(libraryId, assetId),
    queuedRevisionId,
    resolveFfprobePath(),
    execution,
  );
  if (!probed) return false;
  const currentAfterProbe = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { current_revision_id: string | null } | undefined;
  return currentAfterProbe?.current_revision_id === queuedRevisionId;
}

export function readReadyVideoMetadataForRevision(this: LibraryService, openLibrary: OpenLibrary, revisionId: string): VideoProbeResult | null {
  const artifact = openLibrary.connection.prepare(
    `SELECT file_path FROM revision_artifacts
      WHERE revision_id = ?
        AND kind = 'extracted_metadata'
        AND status = 'ready'
        AND invalidated_at IS NULL
        AND generator_version = ?
      ORDER BY generated_at DESC, artifact_id DESC
      LIMIT 1`,
  ).get(revisionId, FFMPEG_METADATA_GENERATOR) as { file_path: string } | undefined;
  if (!artifact) return null;
  try {
    const metadata = JSON.parse(
      readFileSync(this.artifactFilePathFromRow(openLibrary, artifact.file_path), 'utf-8'),
    ) as {
      durationMs?: unknown;
      width?: unknown;
      height?: unknown;
      hasCoverArt?: unknown;
    };
    if (
      typeof metadata.durationMs !== 'number'
      || !Number.isFinite(metadata.durationMs)
      || metadata.durationMs < 0
    ) return null;
    return {
      durationSec: metadata.durationMs / 1000,
      width: typeof metadata.width === 'number'
        && Number.isFinite(metadata.width)
        && metadata.width > 0
        ? metadata.width
        : null,
      height: typeof metadata.height === 'number'
        && Number.isFinite(metadata.height)
        && metadata.height > 0
        ? metadata.height
        : null,
      hasAttachedPicture: metadata.hasCoverArt === true,
    };
  } catch {
    // A missing or unreadable artifact is a cache miss. The source revision
    // remains authoritative and can be probed again without trusting bytes
    // from a different revision.
    return null;
  }
}

export async function probeVideoMetadataForRevision(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffprobePath: string, execution: MediaExecutionContext): Promise<VideoProbeResult | null> {
  throwIfMediaExecutionAborted(execution.signal);
  const current = openLibrary.connection.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  ).get(input.assetId) as { current_revision_id: string | null } | undefined;
  if (!current?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (current.current_revision_id !== revisionId) return null;

  const cached = this.readReadyVideoMetadataForRevision(openLibrary, revisionId);
  if (cached) return cached;

  const inFlightKey = `${input.libraryId}\u0000${revisionId}`;
  let entry = this.videoMetadataProbeInFlight.get(inFlightKey);
  // An aborted producer may still be unwinding its subprocess. Its finally
  // guard uses identity, so replacing it cannot remove the new probe.
  if (entry?.controller.signal.aborted) entry = undefined;
  if (!entry) {
    const controller = new AbortController();
    const identity = {};
    const promise = (async () => {
      try {
        return await this.probeVideoAsset(
          input,
          openLibrary,
          assetPath,
          revisionId,
          ffprobePath,
          { ...execution, signal: controller.signal },
        );
      } finally {
        if (this.videoMetadataProbeInFlight.get(inFlightKey)?.identity === identity) {
          this.videoMetadataProbeInFlight.delete(inFlightKey);
        }
      }
    })();
    const createdEntry = { controller, promise, waiters: 0, identity };
    this.videoMetadataProbeInFlight.set(inFlightKey, createdEntry);
    entry = createdEntry;
  }

  const probed = await waitForSharedMediaOperation(entry, execution.signal);
  const currentAfterProbe = openLibrary.connection.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  ).get(input.assetId) as { current_revision_id: string | null } | undefined;
  return currentAfterProbe?.current_revision_id === revisionId ? probed : null;
}

export async function generateQueuedRawImageMetadata(this: LibraryService, libraryId: string, assetId: string, queuedRevisionId: string, execution: MediaExecutionContext): Promise<boolean> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection
    .prepare(
      'SELECT relative_file_path, current_revision_id FROM assets WHERE asset_id = ?',
    )
    .get(assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
    } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.current_revision_id !== queuedRevisionId) return false;
  if (!isEmbeddedImageMetadataExtension(asset.relative_file_path)) return false;

  const assetPath = this.resolveAssetPath(libraryId, assetId);
  const extraction = await extractRawImageMetadataDetailed(
    assetPath,
    this.options.rawImageMetadataParser,
    execution.signal,
  );
  const current = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { current_revision_id: string | null } | undefined;
  if (execution.signal?.aborted) {
    throw new DOMException('RAW metadata extraction cancelled.', 'AbortError');
  }
  if (current?.current_revision_id !== queuedRevisionId) return false;
  if (extraction.status === 'failed') {
    throw new Error('RAW image metadata extraction failed.', {
      cause: extraction.error,
    });
  }
  const metadata = extraction.status === 'metadata'
    ? extraction.metadata
    : normalizeRawImageMetadata({
      width: execution.sourceWidth ?? null,
      height: execution.sourceHeight ?? null,
    });
  const persisted = await this.persistRawImageMetadata(
    openLibrary,
    assetId,
    queuedRevisionId,
    assetPath,
    metadata,
    {
      width: execution.sourceWidth,
      height: execution.sourceHeight,
    },
  );
  if (!persisted) {
    throw new Error('RAW image metadata artifact could not be persisted.');
  }
  return true;
}

export async function generateQueuedAudioProxy(this: LibraryService, libraryId: string, assetId: string, queuedRevisionId: string, execution: MediaExecutionContext): Promise<boolean> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection.prepare(
    'SELECT current_revision_id FROM assets WHERE asset_id = ?',
  ).get(assetId) as { current_revision_id: string | null } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.current_revision_id !== queuedRevisionId) return false;
  const assetPath = this.resolveAssetPath(libraryId, assetId);
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  await this.generateAudioProxy(
    { libraryId, assetId },
    openLibrary,
    assetPath,
    queuedRevisionId,
    resolveFfmpegPath(),
    artifactsDir,
    execution,
  );
  return true;
}

/** Run ffprobe and store extracted_metadata artifact. */
export async function probeVideoAsset(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffprobePath: string, execution: MediaExecutionContext): Promise<VideoProbeResult> {
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

  try {
    const result = await this.runFfmpeg(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      assetPath,
    ], { signal: execution.signal });

    if (result.exitCode !== 0) {
      throw new Error(`ffprobe exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
    }

    const probeJson = JSON.parse(result.stdout.toString('utf-8'));
    const hasAttachedPicture = ffprobeHasAttachedPicture(probeJson);
    const videoStream = probeJson.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'video',
    );
    const audioStream = probeJson.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'audio',
    );

    const durationSec = parseFloat(probeJson.format?.duration || '0') || 0;
    const width: number | null = videoStream?.width ?? null;
    const height: number | null = videoStream?.height ?? null;
    const framerate = videoStream?.r_frame_rate || null;

    // Retrieve rotation side_data if present
    let rotation = 0;
    if (videoStream?.side_data_list) {
      for (const sd of videoStream.side_data_list) {
        if (sd.rotation !== undefined) {
          rotation = sd.rotation;
          break;
        }
      }
    }

    // Store structured metadata as extracted_metadata artifact
    const metadata = {
      container: probeJson.format?.format_name || null,
      durationMs: Math.round(durationSec * 1000),
      width: width ?? 0,
      height: height ?? 0,
      framerate,
      rotation: rotation !== 0 ? rotation : undefined,
      videoCodec: videoStream?.codec_name || null,
      videoBitrate: videoStream?.bit_rate || null,
      pixelFormat: videoStream?.pix_fmt || null,
      hasAudio: !!audioStream,
      hasCoverArt: hasAttachedPicture,
      audioCodec: audioStream?.codec_name || null,
      audioBitrate: audioStream?.bit_rate || null,
      sampleRate: audioStream?.sample_rate || null,
      channels: audioStream?.channels || null,
      containerBitrate: probeJson.format?.bit_rate || null,
      ...normalizeProbeEmbeddedMetadata(probeJson),
    };

    throwIfMediaExecutionAborted(execution.signal);
    writeFileSync(artifactAbsPath, JSON.stringify(metadata, null, 2), 'utf-8');
    const outputStat = statSync(artifactAbsPath);
    throwIfMediaExecutionAborted(execution.signal);

    // replace any prior extracted_metadata row (e.g. a
    // width/height-only row written by an external conversion) in the same
    // transaction as the fresh insert. Probing first and only then
    // touching the old row means a failed ffprobe never destroys the
    // dimensions a conversion already recorded.
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `DELETE FROM revision_artifacts
            WHERE revision_id = ? AND kind = 'extracted_metadata'
              AND status IN ('ready', 'failed')`,
        )
        .run(revisionId);
      openLibrary.connection
        .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, duration_ms, generator_version, status, generated_at)
           VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId, revisionId, outputStat.size, artifactRelPath,
          width, height, metadata.durationMs,
          FFMPEG_METADATA_GENERATOR,
          new Date().toISOString(),
        );
    })();
    const currentRevision = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    if (currentRevision?.current_revision_id === revisionId) {
      this.syncAssetSearchContent(
        openLibrary.connection,
        input.assetId,
        embeddedMetadataSearchText(metadata),
        revisionId,
      );
    }

    return { durationSec, width, height, hasAttachedPicture };
  } catch (error) {
    if (execution.signal?.aborted) {
      rmSync(artifactAbsPath, { force: true });
      throw error;
    }
    // Write failed artifact
      this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'extracted_metadata',
      'application/json', artifactRelPath, FFMPEG_METADATA_GENERATOR, error);
    throw error;
  }
}

export async function probeVideoDurationSeconds(this: LibraryService, ffprobePath: string, assetPath: string, execution: MediaExecutionContext): Promise<number | null> {
  try {
    const result = await this.runFfmpeg(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,duration',
      '-select_streams', 'v:0',
      '-of', 'json',
      assetPath,
    ], { signal: execution.signal });
    if (result.exitCode !== 0) return null;
    return durationSecondsFromProbeStdout(result.stdout.toString('utf-8'));
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'ffprobe-video-duration');
    if (resourceError) throw resourceError;
    return null;
  }
}

/** Grab one poster frame at 30% of the duration. */
export async function generateVideoPoster(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, ffprobePath: string, artifactsDir: string, execution: MediaExecutionContext, knownDurationSec: number | null): Promise<string> {
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.jpg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  const durationSec = knownDurationSec ?? await this.probeVideoDurationSeconds(
    ffprobePath,
    assetPath,
    execution,
  );
  const seekSeconds = durationSec === null ? null : videoPosterSeekSeconds(durationSec);

  try {
    const result = await this.runFfmpeg(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-threads:v', '1',
      '-filter_threads', '1',
      // Input seek jumps to a nearby keyframe. Output seek would decode
      // every frame from the start up to 30% of a long file.
      ...(seekSeconds === null ? [] : ['-ss', seekSeconds.toFixed(3)]),
      '-i', assetPath,
      // Do not let FFmpeg auto-select audio, subtitles, or data streams for
      // a one-frame image output. Those streams are irrelevant to a card
      // poster but can allocate their own codec buffers on large sources.
      '-map', '0:v:0',
      '-an',
      '-sn',
      '-dn',
      // One scaled frame. Do not run thumbnail=N: that filter only ranks
      // the next N frames after the start, which is the opening shot.
      '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease',
      '-frames:v', '1',
      '-q:v', '3',
      artifactAbsPath,
    ], { signal: execution.signal });

    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg poster exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
    }

    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, generated_at)
         VALUES (?, ?, 'video_poster', 'image/jpeg', ?, ?, ?, 'ready', ?)`,
      )
      .run(artifactId, revisionId, outputStat.size, artifactRelPath,
        videoPosterGeneratorVersion(FFMPEG_VERSION), new Date().toISOString());

    return artifactId;
  } catch (error) {
    if (execution.signal?.aborted) {
      rmSync(artifactAbsPath, { force: true });
      throw error;
    }
    this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'video_poster',
      'image/jpeg', artifactRelPath, videoPosterGeneratorVersion(FFMPEG_VERSION), error);
    throw error;
  }
}

/**
* Count decoder keyframes cheaply so long-GOP videos can avoid decoding
* every inter-frame just to build an AI contact sheet. Short clips and
* unusual streams fall back to the full sequential pass when the probe
* cannot establish a safe fast path.
*/
export async function countVideoKeyframes(this: LibraryService, ffprobePath: string, assetPath: string, execution: MediaExecutionContext): Promise<number | null> {
  try {
    const result = await this.runFfmpeg(ffprobePath, [
      '-v', 'error',
      '-skip_frame', 'nokey',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'json',
      assetPath,
    ], { signal: execution.signal });
    if (result.exitCode !== 0) return null;
    const parsed = JSON.parse(result.stdout.toString('utf-8')) as {
      streams?: Array<{ nb_read_frames?: string | number }>;
    };
    const count = Number(parsed.streams?.[0]?.nb_read_frames);
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

export function h264VideoProxyProfile(this: LibraryService, encoder: string): VideoProxyProfile {
  return {
    codec: 'h264',
    encoder,
    extension: 'mp4',
    mimeType: 'video/mp4',
    args: [
      '-c:v', encoder,
      ...(encoder === 'h264_videotoolbox' ? ['-realtime', 'true'] : []),
      '-threads', '1',
      '-b:v', '1M',
      '-g', '60',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
    ],
  };
}

/**
* Listing an encoder in `ffmpeg -encoders` is not a capability proof.
* Probe a 1-frame lavfi encode and keep the first H.264 encoder that writes
* a non-empty file. If none works, proxy generation fails without trying VP9.
*/
export async function probeVideoProxyEncoder(this: LibraryService, ffmpegPath: string, execution: MediaExecutionContext): Promise<string | null> {
  let listed: string[] = [];
  try {
    const result = await this.runFfmpeg(
      ffmpegPath,
      ['-hide_banner', '-encoders'],
      { signal: execution.signal },
    );
    if (result.exitCode === 0) {
      listed = listedH264ProxyEncoders(
        parseFfmpegEncoderTokens(`${result.stdout.toString('utf8')}\n${result.stderr}`),
      );
    }
  } catch (error) {
    this.diagnose('video-proxy.encoder-list', error, { ffmpegPath });
  }

  const probeRoot = mkdtempSync(path.join(tmpdir(), 'keel-proxy-encoder-'));
  try {
    for (const candidate of listed) {
      const outputPath = path.join(probeRoot, `${candidate}.mp4`);
      let encodeOk = false;
      let probeError: unknown = null;
      try {
        const result = await this.runFfmpeg(
          ffmpegPath,
          ffmpegOneFrameEncodeArgs(candidate, outputPath),
          { signal: execution.signal },
        );
        encodeOk = result.exitCode === 0
          && existsSync(outputPath)
          && statSync(outputPath).size > 0;
        if (!encodeOk) {
          probeError = new Error(
            result.stderr.slice(-200) || `ffmpeg probe exited ${result.exitCode}`,
          );
        }
      } catch (error) {
        probeError = error;
      }
      this.diagnose('video-proxy.encoder-probe-result', probeError, {
        ffmpegPath,
        encoder: candidate,
        encodeOk,
        hardwareNamed: encoderUsesHardwareName(candidate),
      });
      if (encodeOk) return candidate;
    }
  } finally {
    rmSync(probeRoot, { force: true, recursive: true });
  }
  return null;
}

export async function resolveVideoProxyProfiles(this: LibraryService, ffmpegPath: string, execution: MediaExecutionContext): Promise<VideoProxyProfile[]> {
  let encoder = this.videoProxyEncoderByFfmpegPath.get(ffmpegPath);
  if (encoder === undefined) {
    encoder = await this.probeVideoProxyEncoder(ffmpegPath, execution);
    this.videoProxyEncoderByFfmpegPath.set(ffmpegPath, encoder);
  }

  return encoder === null ? [] : [this.h264VideoProxyProfile(encoder)];
}

/** Generate an H.264/MP4 proxy; VP9 is deliberately never used. */
export async function generateVideoProxy(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, artifactsDir: string, execution: MediaExecutionContext): Promise<string> {
  const artifactId = randomUUID();
  const profiles = await this.resolveVideoProxyProfiles(ffmpegPath, execution);
  let lastError: unknown = new Error('No H.264 video proxy encoder is available.');
  if (profiles.length === 0) {
    // A missing FFmpeg is not "no H.264 encoder": keep its ENOENT so the
    // failed artifact records FFMPEG_REQUIRED and the viewer names the cause.
    try {
      await this.runFfmpeg(ffmpegPath, ['-hide_banner', '-version'], { signal: execution.signal });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') lastError = error;
    }
  }
  let failedProfile = profiles[0] ?? this.h264VideoProxyProfile('unavailable');

  for (const profile of profiles) {
    failedProfile = profile;
    const artifactRelPath = `${artifactId}.${profile.extension}`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
    try {
      const result = await this.runFfmpeg(ffmpegPath, [
        '-y',
        '-i', assetPath,
        ...profile.args,
        '-vf', VIDEO_PROXY_SCALE_FILTER,
        artifactAbsPath,
      ], { signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(
          `ffmpeg ${profile.codec} proxy exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`,
        );
      }

      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, 'webm_proxy', ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          profile.mimeType,
          outputStat.size,
          artifactRelPath,
          `ffmpeg@${FFMPEG_VERSION};proxy=${profile.codec};encoder=${profile.encoder}`,
          new Date().toISOString(),
        );

      return artifactId;
    } catch (error) {
      lastError = error;
      this.diagnose('video-proxy.encode', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
        codec: profile.codec,
        encoder: profile.encoder,
      });
      rmSync(artifactAbsPath, { force: true });
    }
  }

  const failedArtifactRelPath = `${artifactId}.${failedProfile.extension}`;
  this.writeFailedArtifact(
    openLibrary,
    artifactId,
    revisionId,
    'webm_proxy',
    failedProfile.mimeType,
    failedArtifactRelPath,
    `ffmpeg@${FFMPEG_VERSION};proxy=${failedProfile.codec};encoder=${failedProfile.encoder}`,
    lastError,
  );
  throw lastError;
}

/** Generate an Opus/Ogg proxy so audio playback does not rely on source codecs. */
export async function generateAudioProxy(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, artifactsDir: string, execution: MediaExecutionContext): Promise<string> {
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.ogg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

  try {
    const result = await this.runFfmpeg(ffmpegPath, [
      '-y',
      '-i', assetPath,
      '-map', '0:a:0?',
      '-vn',
      '-c:a', 'libopus',
      '-threads', '1',
      '-b:a', '128k',
      '-f', 'ogg',
      artifactAbsPath,
    ], { signal: execution.signal });
    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg audio proxy exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
    }
    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at)
       VALUES (?, ?, 'audio_proxy', 'audio/ogg', ?, ?, ?, 'ready', ?)`,
    ).run(
      artifactId,
      revisionId,
      outputStat.size,
      artifactRelPath,
      `ffmpeg@${FFMPEG_VERSION};opus@128k`,
      new Date().toISOString(),
    );
    return artifactId;
  } catch (error) {
    this.writeFailedArtifact(
      openLibrary,
      artifactId,
      revisionId,
      'audio_proxy',
      'audio/ogg',
      artifactRelPath,
      `ffmpeg@${FFMPEG_VERSION};opus@128k`,
      error,
    );
    throw error;
  }
}

// ── OIIO thumbnail (EXR/TGA and complex TIFF fallback) ─────────────

/**
* Prefer the camera's embedded JPEG for a card thumbnail. This path is
* intentionally card-only: viewer_image must still use OIIO/LibRaw so the
* embedded preview never masquerades as a full-resolution RAW decode.
*/
export async function tryGenerateRawEmbeddedThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, execution: MediaExecutionContext): Promise<{ artifactId: string } | null> {
  const embeddedJpeg = extractRawEmbeddedJpegThumbnail(assetPath);
  if (!embeddedJpeg) return null;

  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.jpg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

  try {
    const embeddedDimensions = await runSharpDecoder(
      execution.signal,
      execution.lane,
      async () => {
        const sharp = this.options.sharpFn ?? requireSharp();
        const pipeline = sharp(embeddedJpeg, {
          failOn: 'none',
          sequentialRead: true,
          limitInputPixels: false,
        });
        const metadata = await pipeline.metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
          throw new Error('Embedded RAW JPEG dimensions are invalid.');
        }
        const swapsDimensions = metadata.orientation !== undefined
          && metadata.orientation >= 5
          && metadata.orientation <= 8;
        const orientedWidth = swapsDimensions ? height : width;
        const orientedHeight = swapsDimensions ? width : height;
        await pipeline
          .rotate()
          .toColourspace('srgb')
          .resize({
            width: 512,
            height: 512,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 72 })
          .toFile(artifactAbsPath);
        return { width: orientedWidth, height: orientedHeight };
      },
    );
    if (execution.signal?.aborted) {
      throw new DOMException('Media job cancelled after embedded RAW thumbnail generation.', 'AbortError');
    }

    const rawMetadata = execution.includeRawMetadata === false
      ? null
      : await extractRawImageMetadata(
        assetPath,
        this.options.rawImageMetadataParser,
      );
    const sourceWidth = rawMetadata?.width
      ?? execution.sourceWidth
      ?? embeddedDimensions.width;
    const sourceHeight = rawMetadata?.height
      ?? execution.sourceHeight
      ?? embeddedDimensions.height;
    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            width, height, generator_version, status, generated_at)
         VALUES (?, ?, 'thumbnail', 'image/jpeg', ?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(
        artifactId,
        revisionId,
        outputStat.size,
        artifactRelPath,
        sourceWidth,
        sourceHeight,
        RAW_EMBEDDED_THUMBNAIL_GENERATOR,
        new Date().toISOString(),
      );
    if (rawMetadata) {
      await this.persistRawImageMetadata(openLibrary, input.assetId, revisionId, assetPath, rawMetadata, {
        width: execution.sourceWidth,
        height: execution.sourceHeight,
      });
    }
    return { artifactId };
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    if (error instanceof Error && error.name === 'AbortError') throw error;
    this.diagnose('thumbnail.raw-embedded-fallback', error, {
      libraryId: input.libraryId,
      assetId: input.assetId,
      extension: path.extname(assetPath).toLowerCase(),
    });
    return null;
  }
}

export async function generateOiiOThumbnail(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, options: {
      exposureStops?: number;
      inputColorSpace?: string;
      subimage?: number;
      artifactKind?: 'thumbnail' | 'viewer_image';
    } = {}, execution: MediaExecutionContext = {}): Promise<{ artifactId: string }> {
  const oiiotoolPath = resolveOiiotoolPath();
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  mkdirSync(artifactsDir, { recursive: true });
  const artifactRelPath = `${artifactId}.png`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  const artifactKind = options.artifactKind ?? 'thumbnail';
  const isViewerImage = artifactKind === 'viewer_image';
  let subimage = Number.isSafeInteger(options.subimage) && (options.subimage ?? 0) >= 0
    ? options.subimage ?? 0
    : 0;
  const isIcoAsset = path.extname(assetPath).toLowerCase() === '.ico';
  if (isIcoAsset && options.subimage === undefined) {
    // OIIO exposes ICO entries as subimages in directory order.  The first
    // entry is commonly 16px, so explicitly select the largest directory
    // entry instead of letting the decoder upscale a tiny icon.
    try {
      const icoPageSizes = readIcoPageSizesFromPath(assetPath);
      subimage = pickLargestIcoPage(icoPageSizes);
    } catch (error) {
      this.diagnose('oiio.ico-page-directory', error, { assetPath });
    }
  }

  try {
    const exposureStops = Number.isFinite(options.exposureStops)
      ? Math.max(-10, Math.min(10, options.exposureStops ?? 0))
      : 0;
    const exposureMultiplier = 2 ** exposureStops;
    const inputColorSpace = options.inputColorSpace?.trim() || null;
    const exposureValues = [
      exposureMultiplier,
      exposureMultiplier,
      exposureMultiplier,
      1,
    ].join(',');
    const isRawAsset = isRawImageExtension(assetPath);
    // Keep the card artifact inside a 512px square while preserving the
    // source aspect ratio. `--resize 0x512` makes a 2048x1024 source into a
    // 1024x512 card, which is twice as wide as the card contract and caused
    // the real TIFF E2E to expose the wrong raster size. This is an output
    // presentation size, not a source acceptance or processing limit.
    const resizeArgs = isViewerImage ? [] : ['--fit', '512x512'];
    // Chromium <img> does not paint 16-bit PNG. Card and viewer outputs are
    // display files, so force 8-bit before writing the PNG.
    const displayDepthArgs = ['-d', 'uint8'];

    if (isRawAsset && !isViewerImage) {
      const embeddedThumbnail = await this.tryGenerateRawEmbeddedThumbnail(
        input,
        openLibrary,
        assetPath,
        revisionId,
        execution,
      );
      if (embeddedThumbnail) return embeddedThumbnail;
    }

    const nativeInput = await inspectMediaNativeInput(assetPath, execution);

    // LibRaw already converts camera RAW data to its display-ready default
    // output. Running that result through the studio OCIO display transform
    // makes some ARW/RAW files fail with OIIO_COLOR_TRANSFORM_FAILED, so RAW
    // stays on the decoder's default sRGB path. EXR/TGA and other OIIO
    // formats retain the established explicit OCIO route.
    const args: string[] = isRawAsset
      ? [
          '--subimage', String(subimage),
          assetPath,
          ...resizeArgs,
          ...displayDepthArgs,
          '-o', artifactAbsPath,
        ]
      : [
          '--colorconfig', KEEL_OCIO_CONFIG,
          '--subimage', String(subimage),
          assetPath,
          ...(inputColorSpace ? ['--iscolorspace', inputColorSpace] : []),
          // Preserve alpha while applying exposure to RGB color channels.
          '--mulc', exposureValues,
          // Empty display/view select the OCIO config defaults. Literal "default"
          // would instead request names that the selected config may not define.
          inputColorSpace
            ? `--ociodisplay:from=${inputColorSpace}:unpremult=1`
            : '--ociodisplay:unpremult=1',
          '', '',
          ...resizeArgs,
          ...displayDepthArgs,
          '-o', artifactAbsPath,
        ];

    const result = await this.runOiio(oiiotoolPath, args, {
      signal: execution.signal,
      memory: nativeInput,
    });

    if (result.exitCode !== 0) {
      throw new OiioInvocationError(
        oiioFailureCode(result.stderr),
        `oiiotool ${isRawAsset ? 'RAW decode' : 'OCIO display transform'} exited with code ${result.exitCode}: ${result.stderr.slice(-8192)}`,
      );
    }

    const outputStat = statSync(artifactAbsPath);
    const rawMetadata = isRawAsset && !isViewerImage && execution.includeRawMetadata !== false
      ? await extractRawImageMetadata(
        assetPath,
        this.options.rawImageMetadataParser,
      )
      : null;
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, generated_at)
         VALUES (?, ?, ?, 'image/png', ?, ?, ?, 'ready', ?)`,
      )
      .run(artifactId, revisionId, artifactKind, outputStat.size, artifactRelPath,
        (isRawAsset
          ? `oiio@${OIIO_VERSION};raw-${isViewerImage ? 'viewer-full' : 'default'}-srgb;subimage=${subimage};display-uint8`
          : isIcoAsset
            ? `oiio@${OIIO_VERSION};ico-largest-v1;subimage=${subimage};display-uint8`
            : `oiio@${OIIO_VERSION};${isViewerImage ? 'viewer-full;' : ''}ocio=studio-v4-aces2;colorspace=${inputColorSpace ?? 'auto'};exposure=${exposureStops};subimage=${subimage};display-uint8`) + `;${OIIO_LITERAL_PATHS_MARK}`,
        new Date().toISOString());
    if (rawMetadata) {
      await this.persistRawImageMetadata(openLibrary, input.assetId, revisionId, assetPath, rawMetadata, {
        width: execution.sourceWidth,
        height: execution.sourceHeight,
      });
    }

    return { artifactId };
  } catch (error) {
    const resourceError = asMediaResourceExhaustedError(error, 'oiio');
    const errorCode: OiioArtifactErrorCode | typeof MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE = resourceError
      ? MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE
      : isMissingPathError(error)
      ? 'OIIO_REQUIRED'
      : error instanceof OiioInvocationError
        ? error.artifactErrorCode
        : 'OIIO_GENERATION_FAILED';

    this.diagnose('oiio.thumbnail', error, {
      libraryId: input.libraryId,
      assetId: input.assetId,
      extension: path.extname(assetPath).toLowerCase(),
      errorCode,
      ocioConfig: KEEL_OCIO_CONFIG,
    });

    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, error_code, generated_at)
         VALUES (?, ?, ?, 'image/png', 0, ?, ?, 'failed', ?, ?)`,
      )
      .run(
        artifactId, revisionId, artifactKind, artifactRelPath,
        (isRawImageExtension(assetPath)
          ? `oiio@${OIIO_VERSION};raw-${isViewerImage ? 'viewer-full' : 'default'}-srgb;subimage=${subimage}`
          : isIcoAsset
            ? `oiio@${OIIO_VERSION};ico-largest-v1;subimage=${subimage}`
            : `oiio@${OIIO_VERSION};${isViewerImage ? 'viewer-full;' : ''}ocio=studio-v4-aces2;subimage=${subimage}`) + `;${OIIO_LITERAL_PATHS_MARK}`,
        errorCode,
        new Date().toISOString(),
      );

    if (resourceError) throw resourceError;
    throw new LibraryServiceError('INTERNAL_ERROR', {
      cause: error,
      reason: errorCode === 'OIIO_REQUIRED' ? 'OIIO_REQUIRED' : 'MEDIA_PROCESSING_FAILED',
    });
  }
}

/**
* Store the small, allow-listed EXIF/IPTC/XMP projection used by the image
* Inspector. Metadata extraction is deliberately best-effort: a file with
* no readable embedded metadata must still keep its successful thumbnail.
*/
export async function persistRawImageMetadata(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string, assetPath: string, metadata: RawImageMetadata, knownDimensions?: { width?: number | null; height?: number | null }): Promise<boolean> {
  const artifactId = randomUUID();
  const artifactsDir = this.artifactsDir(openLibrary);
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  try {
    const hasKnownDimensions = Number.isSafeInteger(knownDimensions?.width)
      && Number.isSafeInteger(knownDimensions?.height)
      && knownDimensions!.width! > 0
      && knownDimensions!.height! > 0;
    const headerSize = hasKnownDimensions
      ? { width: knownDimensions!.width!, height: knownDimensions!.height! }
      : await readImageDimensions(assetPath);
    const pixelSize = resolvedExtractedPixelSize(metadata, headerSize);
    const stored = { ...metadata, width: pixelSize.width, height: pixelSize.height };
    writeFileSync(artifactAbsPath, JSON.stringify(stored, null, 2), 'utf-8');
    const outputStat = statSync(artifactAbsPath);
    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ?
              AND kind = 'extracted_metadata'
              AND invalidated_at IS NULL`,
        )
        .run(now, revisionId);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          outputStat.size,
          artifactRelPath,
          pixelSize.width,
          pixelSize.height,
          EMBEDDED_IMAGE_METADATA_GENERATOR,
          now,
      );
    })();
    const currentRevision = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(assetId) as { current_revision_id: string | null } | undefined;
    if (currentRevision?.current_revision_id === revisionId) {
      this.syncAssetSearchContent(
        openLibrary.connection,
        assetId,
        embeddedMetadataSearchText(metadata),
        revisionId,
      );
    }
    return true;
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    this.diagnose('image.raw-metadata', error, {
      revisionId,
      extension: path.extname(assetPath).toLowerCase(),
    });
    return false;
  }
}

/** Write a failed revision_artifact row. Used across video and OIIO paths. */
export function writeFailedArtifact(this: LibraryService, openLibrary: OpenLibrary, artifactId: string, revisionId: string, kind: string, mimeType: string, filePath: string, generatorVersion: string, error: unknown): void {
  let errorCode: string;
  if (isMissingPathError(error) || (typeof error === 'object' && error !== null && 'code' in error && (error as Record<string, unknown>).code === 'ENOENT')) {
    errorCode = kind === 'extracted_metadata' || kind === 'video_poster' || kind === 'contact_sheet' || kind === 'webm_proxy' || kind === 'audio_proxy'
      ? 'FFMPEG_REQUIRED' : 'OIIO_REQUIRED';
  } else if (typeof error === 'object' && error !== null && 'code' in error) {
    errorCode = String((error as Record<string, unknown>).code);
  } else {
    errorCode = `${kind.toUpperCase()}_GENERATION_FAILED`;
  }
  openLibrary.connection
    .prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, error_code, generated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'failed', ?, ?)`,
    )
    .run(artifactId, revisionId, kind, mimeType, filePath, generatorVersion, errorCode, new Date().toISOString());
}

/**
* Return the current card image artifact for an asset's current revision.
* Videos use `video_poster`; other card media uses `thumbnail`.
*/
export function getThumbnailArtifact(this: LibraryService, libraryId: string, assetId: string): {
    artifactId: string;
    filePath: string;
    width: number | null;
    height: number | null;
  } | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const assetRow = openLibrary.connection
    .prepare('SELECT current_revision_id, relative_file_path FROM assets WHERE asset_id = ?')
    .get(assetId) as { current_revision_id: string | null; relative_file_path: string } | undefined;
  if (!assetRow?.current_revision_id) return null;

  const row = openLibrary.connection
    .prepare(
      `SELECT artifact_id, file_path, width, height
         FROM revision_artifacts
        WHERE revision_id = ?
          AND kind = CASE
            WHEN LOWER(?) LIKE '%.mp4' OR LOWER(?) LIKE '%.webm' OR LOWER(?) LIKE '%.mov'
              OR LOWER(?) LIKE '%.avi' OR LOWER(?) LIKE '%.wmv' OR LOWER(?) LIKE '%.mkv'
              OR LOWER(?) LIKE '%.m4v' OR LOWER(?) LIKE '%.flv'
            THEN 'video_poster' ELSE 'thumbnail' END
          AND status = 'ready'
          AND invalidated_at IS NULL
        ORDER BY CASE mime_type WHEN 'image/jpeg' THEN 0 WHEN 'image/webp' THEN 1
          WHEN 'image/png' THEN 2 ELSE 3 END, rowid DESC
        LIMIT 1`,
    )
    .get(assetRow.current_revision_id, ...Array(8).fill(assetRow.relative_file_path)) as {
      artifact_id: string;
      file_path: string;
      width: number | null;
      height: number | null;
    } | undefined;

  return row
    ? {
        artifactId: row.artifact_id,
        filePath: row.file_path,
        width: row.width,
        height: row.height,
      }
    : null;
}

/** Persist bounded Main-brokered plugin media as the normal thumbnail artifact. */
export async function writePluginMediaArtifact(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    mimeType: string;
    bytesBase64: string;
    providerId?: string;
  }): Promise<{ artifactId: string }> {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const asset = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ? AND deleted_at IS NULL')
    .get(input.assetId) as { current_revision_id: string | null } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');

  const bytes = Buffer.from(input.bytesBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 256 * 1024) {
    throw new LibraryServiceError('INTERNAL_ERROR');
  }

  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.plugin`;
  const artifactAbsPath = path.join(this.artifactsDir(openLibrary), artifactRelPath);
  let width: number | null = null;
  let height: number | null = null;
  if (input.mimeType.toLowerCase().startsWith('image/')) {
    try {
      const metadata = await runSharpDecoder(
        undefined,
        'background',
        () => (this.options.sharpFn ?? requireSharp())(bytes, {
          failOn: 'none',
          limitInputPixels: false,
        }).metadata(),
        { sourceByteSize: bytes.length },
      );
      const metadataWidth = metadata.width;
      const metadataHeight = metadata.height;
      width = typeof metadataWidth === 'number'
        && Number.isInteger(metadataWidth)
        && metadataWidth > 0
        ? metadataWidth
        : null;
      height = typeof metadataHeight === 'number'
        && Number.isInteger(metadataHeight)
        && metadataHeight > 0
        ? metadataHeight
        : null;
    } catch (error) {
      this.diagnose('plugin-media-artifact.metadata', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
        mimeType: input.mimeType,
      });
    }
  }
  mkdirSync(this.artifactsDir(openLibrary), { recursive: true });
  try {
    writeFileSync(artifactAbsPath, bytes, { flag: 'wx' });
    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ? AND kind = 'thumbnail' AND invalidated_at IS NULL`,
        )
        .run(now, asset.current_revision_id);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, 'thumbnail', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          asset.current_revision_id,
          input.mimeType,
          bytes.length,
          artifactRelPath,
          width,
          height,
          `plugin:${input.providerId ?? 'media-provider'}`,
          now,
        );
    })();
    return { artifactId };
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    throw error;
  }
}

/**
* Write a derived binary artifact for an asset's current revision.
*
* Slice-0030 addition (FBX→GLB pipeline): like writePluginMediaArtifact but
* the artifact kind and generator version are caller supplied. Local
* resources have no product-size gate; the artifact is written atomically.
* Cache semantics stay the same as the other derived pipelines: the
* artifact is keyed by (revision_id, kind) —
* a new source revision invalidates the previous artifact — and the
* `generator_version` column lets consumers detect a stale converter
* (resolveConvertedGlb in src/worker/fbx/converter.ts).
*/
export function writeDerivedArtifact(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    kind: string;
    mimeType: string;
    bytes: Uint8Array;
    generatorVersion: string;
  }): { artifactId: string; filePath: string } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const asset = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ? AND deleted_at IS NULL')
    .get(input.assetId) as { current_revision_id: string | null } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (input.bytes.length === 0) {
    throw new LibraryServiceError('INTERNAL_ERROR');
  }

  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.${input.kind}`;
  const artifactAbsPath = path.join(this.artifactsDir(openLibrary), artifactRelPath);
  mkdirSync(this.artifactsDir(openLibrary), { recursive: true });
  try {
    writeFileSync(artifactAbsPath, input.bytes, { flag: 'wx' });
    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ? AND kind = ? AND invalidated_at IS NULL`,
        )
        .run(now, asset.current_revision_id, input.kind);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          asset.current_revision_id,
          input.kind,
          input.mimeType,
          input.bytes.length,
          artifactRelPath,
          input.generatorVersion,
          now,
        );
    })();
    return { artifactId, filePath: artifactRelPath };
  } catch (error) {
    rmSync(artifactAbsPath, { force: true });
    throw error;
  }
}

/**
* Return the current (invalidated_at IS NULL) artifact of a given kind
* for an asset's current revision. Returns null if none exists.
* Unlike getThumbnailArtifact, this also returns the raw status so
* callers can distinguish ready vs failed artifacts.
*/
export function getCurrentArtifact(this: LibraryService, libraryId: string, assetId: string, kind: string, options: { expectedGeneratorVersion?: string } = {}): ArtifactDescriptor | null {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const assetRow = openLibrary.connection
    .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
    .get(assetId) as { current_revision_id: string | null } | undefined;
  if (!assetRow?.current_revision_id) return null;

  const cacheKey = ArtifactDescriptorCache.key(
    libraryId,
    assetId,
    assetRow.current_revision_id,
    kind,
    options.expectedGeneratorVersion,
  );
  const changeSequence = openLibrary.changeSubscription.refresh?.()
    ?? openLibrary.changeSubscription.lastSequence;

  // lenient read (0031 §1): libraries predating the
  // artifact table (or the columns needed to address an artifact) have no
  // current artifact; callers already treat null as "no artifact".
  const connection = openLibrary.connection;
  const artifactColumns = columnsFor(connection, 'revision_artifacts');
  if (!artifactColumns.has('artifact_id') || !artifactColumns.has('kind')) {
    return null;
  }
  const cached = this.artifactDescriptorCache.get(cacheKey, changeSequence);
  if (cached !== undefined) return cached;
  const present = selectColumns(connection, 'revision_artifacts', [
    'artifact_id',
    'file_path',
    'mime_type',
    'generator_version',
    'artifact_role',
    'generator_id',
    'settings_hash',
    'artifact_key',
    'status',
    'error_code',
    'width',
    'height',
    'generated_at',
  ]);
  if (present.length === 0) {
    this.artifactDescriptorCache.set(cacheKey, null, changeSequence);
    return null;
  }
  const descriptor = readCatalogArtifactDescriptor(connection, {
    revisionId: assetRow.current_revision_id,
    kind,
    selectedColumns: present,
    hasInvalidatedAt: artifactColumns.has('invalidated_at'),
    expectedGeneratorVersion: options.expectedGeneratorVersion,
  });
  if (!descriptor) {
    this.artifactDescriptorCache.set(cacheKey, null, changeSequence);
    return null;
  }
  this.artifactDescriptorCache.set(cacheKey, descriptor, changeSequence);
  return descriptor;
}

/** Diagnostic snapshot for cache-hit/miss/eviction benchmarks. */
export function getArtifactDescriptorCacheMetrics(this: LibraryService): ArtifactDescriptorCacheMetrics {
  return this.artifactDescriptorCache.metrics();
}

export function resetArtifactDescriptorCacheMetrics(this: LibraryService): void {
  this.artifactDescriptorCache.resetMetrics();
}

export async function ensureRawViewerImage(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string): Promise<void> {
  const key = `${input.libraryId}:${input.assetId}:${revisionId}`;
  const existing = this.getCurrentArtifact(input.libraryId, input.assetId, 'viewer_image');
  const expected = `oiio@${OIIO_VERSION};raw-viewer-full;`;
  // A failed viewer artifact is not a durable verdict about the source.
  // In particular, a library can remain open while its media bundle is
  // repaired or replaced. Retry failed/legacy artifacts once the RAW reader
  // is available instead of returning the stale failure forever.
  if (existing?.status === 'ready' && existing.generatorVersion.includes(expected)) return;
  if (existing) {
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE artifact_id = ? AND invalidated_at IS NULL`,
      )
      .run(new Date().toISOString(), existing.artifactId);
  }
  const running = this.rawViewerImageInFlight.get(key);
  if (running) {
    await running;
    return;
  }
  const task = this.generateOiiOThumbnail(
    input,
    openLibrary,
    assetPath,
    revisionId,
    { artifactKind: 'viewer_image' },
  ).then(() => undefined).catch(() => undefined);
  this.rawViewerImageInFlight.set(key, task);
  try {
    await task;
  } finally {
    this.rawViewerImageInFlight.delete(key);
  }
}

/**
* ICO files are multi-page containers rather than one fixed raster. Chromium
* may choose the first/smallest page when the source URL is used directly,
* so the viewer receives a dedicated PNG generated from the largest page.
* The implementation shares the OIIO selection path with card thumbnails
* and is single-flight per revision, just like the RAW viewer artifact.
*/
export async function generateIcoViewerImage(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string): Promise<{ artifactId: string }> {
  // ICO is owned by the bundled OIIO decoder. Reusing the same path as the
  // card thumbnail keeps viewer and grid selection identical and avoids
  // Sharp's platform-dependent/unsupported ICO handling.
  return this.generateOiiOThumbnail(
    input,
    openLibrary,
    assetPath,
    revisionId,
    { artifactKind: 'viewer_image' },
  );
}

export async function ensureIcoViewerImage(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string): Promise<void> {
  const key = `${input.libraryId}:${input.assetId}:${revisionId}`;
  const existing = this.getCurrentArtifact(input.libraryId, input.assetId, 'viewer_image');
  if (existing?.status === 'ready' && existing.generatorVersion.includes('ico-largest-v1')) return;
  if (existing) {
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE artifact_id = ? AND invalidated_at IS NULL`,
      )
      .run(new Date().toISOString(), existing.artifactId);
  }
  const running = this.icoViewerImageInFlight.get(key);
  if (running) {
    await running;
    return;
  }
  const task = this.generateIcoViewerImage(
    input,
    openLibrary,
    assetPath,
    revisionId,
  ).then(() => undefined).catch(() => undefined);
  this.icoViewerImageInFlight.set(key, task);
  try {
    await task;
  } finally {
    this.icoViewerImageInFlight.delete(key);
  }
}

export async function getImageColorSpace(this: LibraryService, revisionId: string, assetPath: string, decoder: 'sharp' | 'oiio'): Promise<ImageColorSpaceInfo> {
  const cached = this.imageColorSpaceByRevision.get(revisionId);
  if (cached) return cached;
  const extension = path.extname(assetPath).toLowerCase();
  let detected: ImageColorSpaceInfo | undefined;
  try {
    if (decoder === 'sharp') {
      const metadata = await runSharpDecoder(undefined, 'background', async () =>
        (this.options.sharpFn ?? requireSharp())(assetPath).metadata(),
      );
      const profileName = parseIccProfileDescription(metadata.icc);
      detected = colorSpaceInfoFromName(profileName, 'embedded')
        ?? colorSpaceInfoFromName(metadata.space, metadata.hasProfile ? 'embedded' : 'metadata');
    } else {
      const nativeInput = await inspectMediaNativeInput(assetPath, {});
      const result = await this.runOiio(resolveOiiotoolPath(), [
        '--info', '-v', '-a', assetPath,
      ], { memory: nativeInput });
      if (result.exitCode === 0) {
        detected = parseOiioColorSpaceInfo(result.stdout.toString('utf-8'));
      }
    }
  } catch (error) {
    this.diagnose('image.colorspace-probe', error, { revisionId, decoder });
  }
  const resolved = detected ?? defaultImageColorSpace(extension);
  this.imageColorSpaceByRevision.set(revisionId, resolved);
  return resolved;
}

export function getColorSpaceOverride(this: LibraryService, connection: DatabaseConnection, assetId: string): string | null {
  const row = connection
    .prepare('SELECT color_space FROM asset_color_space_overrides WHERE asset_id = ?')
    .get(assetId) as { color_space: string } | undefined;
  return row?.color_space ?? null;
}

/**
* Async renderer entrypoint. Base preview resolution stays synchronous for
* cards and worker tests; EXR selection is the only on-demand derivative
* because each part needs a distinct OIIO decode.
*/
export async function resolvePreviewArtifact(this: LibraryService, libraryId: string, assetId: string, requestedExrPlane?: number, requestedColorSpace?: string, intent: 'viewer' | 'hover' | 'proxy-fallback' = 'viewer'): Promise<ReturnType<LibraryService['getPreviewArtifact']> & {
    exrPlanes?: ExrPlaneDescriptor[];
    selectedExrPlane?: number;
    colorSpace?: ImageColorSpaceInfo & { options: ImageColorSpaceOption[] };
    colorSpacePending?: boolean;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, current_revision_id, availability
         FROM assets
        WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .get(assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
    } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.availability === 'missing') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }

  const basePreview = this.getPreviewArtifact(libraryId, assetId, intent);
  const extension = path.extname(asset.relative_file_path).toLowerCase();
  const decoder = imageDecoderForExtension(extension);
  const viewerDecoder = imageViewerDecoderForExtension(extension);
  const isRawAsset = isRawImageExtension(extension);
  const isIcoAsset = extension === '.ico';
  if (basePreview.mediaType === 'video' && asset.current_revision_id) {
    const override = this.getColorSpaceOverride(openLibrary.connection, assetId);
    const selected = colorSpaceInfoFromName(requestedColorSpace ?? override ?? undefined, 'metadata')
      ?? defaultImageColorSpace(extension);
    return {
      ...basePreview,
      colorSpace: {
        ...selected,
        options: [...COMMON_IMAGE_COLOR_SPACE_OPTIONS],
      },
    };
  }
  if (basePreview.mediaType !== 'image' || !asset.current_revision_id || !decoder || !viewerDecoder) {
    return basePreview;
  }
  if ((isRawAsset || isIcoAsset) && intent === 'viewer') {
    const ensureViewerImage = isRawAsset
      ? this.ensureRawViewerImage.bind(this)
      : this.ensureIcoViewerImage.bind(this);
    await ensureViewerImage(
      { libraryId, assetId },
      openLibrary,
      this.resolveAssetPath(libraryId, assetId),
      asset.current_revision_id,
    );
  }
  const storedOverride = this.getColorSpaceOverride(openLibrary.connection, assetId);
  const cachedColorSpace = this.imageColorSpaceByRevision.get(asset.current_revision_id);
  const canWarmColorSpaceInBackground =
    basePreview.playbackMode === 'source'
    && decoder === 'sharp'
    && viewerDecoder === 'sharp'
    && !isRawAsset
    && requestedColorSpace === undefined
    && storedOverride === null;

  // Native images already have a browser-readable source URL. Do not make
  // the viewer wait for a filesystem probe or Sharp metadata just to decide
  // which label to show beside the image. Return the source with a safe
  // default immediately, then resolve the path and warm the colour-space
  // cache on a detached turn; the next normal preview poll merges the exact
  // embedded profile without replacing the decoded image.
  if (canWarmColorSpaceInBackground) {
    const detectedColorSpace = cachedColorSpace ?? defaultImageColorSpace(extension);
    if (!cachedColorSpace) {
      void Promise.resolve()
        .then(() => this.resolveAssetPath(libraryId, assetId))
      .then((assetPath) => this.getImageColorSpace(
          asset.current_revision_id!,
          assetPath,
          viewerDecoder,
        ))
        .catch(() => undefined);
    }
    return {
      ...basePreview,
      colorSpace: {
        ...detectedColorSpace,
        options: canOverrideImageColorSpace(extension)
          ? [...COMMON_IMAGE_COLOR_SPACE_OPTIONS]
          : [{
            id: detectedColorSpace.id,
            label: detectedColorSpace.label,
            isLinear: detectedColorSpace.isLinear,
          }],
      },
      ...(cachedColorSpace ? {} : { colorSpacePending: true }),
    };
  }

  const assetPath = this.resolveAssetPath(libraryId, assetId);
  let detectedColorSpace: ImageColorSpaceInfo;
  if (cachedColorSpace) {
    detectedColorSpace = cachedColorSpace;
  } else {
    detectedColorSpace = await this.getImageColorSpace(
      asset.current_revision_id,
      assetPath,
      viewerDecoder,
    );
  }
  const selectedColorSpace = colorSpaceInfoFromName(
    requestedColorSpace ?? storedOverride ?? undefined,
    'metadata',
  ) ?? detectedColorSpace;
  const colorSpace = {
    ...selectedColorSpace,
    options: viewerDecoder === 'oiio' || canOverrideImageColorSpace(extension)
      ? [...COMMON_IMAGE_COLOR_SPACE_OPTIONS]
      : [{ id: detectedColorSpace.id, label: detectedColorSpace.label, isLinear: detectedColorSpace.isLinear }],
  };
  let planes: ExrPlaneDescriptor[] | undefined;
  let selected = 0;
  if (extension === '.exr') {
    planes = await this.getExrPlanes(
      asset.current_revision_id,
      this.resolveAssetPath(libraryId, assetId),
    );
    const requested = Number.isSafeInteger(requestedExrPlane) && requestedExrPlane! >= 0
      ? requestedExrPlane!
      : 0;
    selected = planes.some((plane) => plane.index === requested)
      ? requested
      : 0;
  }

  // Chromium cannot render the remaining supported image containers (TIFF,
  // BMP, TGA, PSD and EXR) from their source URL.  Give the viewer a
  // source-resolution OIIO decode instead of reusing the 512px card
  // thumbnail.  The selected colour space and EXR plane are part of the
  // artifact identity so changing either option cannot show stale pixels.
  if (
    intent === 'viewer'
    && viewerDecoder === 'oiio'
    && !isRawAsset
    && !isIcoAsset
  ) {
    await this.ensureOiiOViewerImage(
      { libraryId, assetId },
      openLibrary,
      assetPath,
      asset.current_revision_id,
      {
        inputColorSpace: selectedColorSpace.id,
        ...(extension === '.exr' ? { subimage: selected } : {}),
      },
    );
  }

  // OIIO derivatives must be regenerated when the source profile or the
  // viewer override differs from the artifact that is currently cached. This
  // also repairs older PSD/EXR thumbnails created before color metadata was
  // wired into the generator version.
  const shouldRegenerateWithOiiO =
    !isRawAsset &&
    !isIcoAsset &&
    basePreview.status === 'ready' &&
    (viewerDecoder === 'oiio' || requestedColorSpace !== undefined || storedOverride !== null) &&
    canOverrideImageColorSpace(extension);
  if (shouldRegenerateWithOiiO) {
    const current = openLibrary.connection.prepare(
      `SELECT generator_version
         FROM revision_artifacts
        WHERE revision_id = ?
          AND kind = 'thumbnail'
          AND status = 'ready'
          AND invalidated_at IS NULL
        LIMIT 1`,
    ).get(asset.current_revision_id) as { generator_version: string } | undefined;
    const version = current?.generator_version ?? '';
    const needsColor = !version.includes(`colorspace=${selectedColorSpace.id}`);
    const needsPlane = extension === '.exr' && !version.includes(`subimage=${selected}`);
    if (needsColor || needsPlane) {
      openLibrary.connection.prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ?
            AND kind = 'thumbnail'
            AND invalidated_at IS NULL`,
      ).run(new Date().toISOString(), asset.current_revision_id);
      try {
        await this.generateOiiOThumbnail(
          { libraryId, assetId },
          openLibrary,
          this.resolveAssetPath(libraryId, assetId),
          asset.current_revision_id,
          {
            inputColorSpace: selectedColorSpace.id,
            ...(extension === '.exr' ? { subimage: selected } : {}),
          },
        );
      } catch {
        // The refreshed artifact carries the renderer-safe failure reason.
      }
    }
  }

  return {
    ...this.getPreviewArtifact(libraryId, assetId, intent),
    ...(planes ? { exrPlanes: planes, selectedExrPlane: selected } : {}),
    colorSpace,
  };
}

/**
* Resolve the renderer-safe preview state for an asset. The renderer receives
* only an opaque artifact id; absolute and library-relative paths stay in the
* Worker/Main boundary.
*/
export function getPreviewArtifact(this: LibraryService, libraryId: string, assetId: string, intent: 'viewer' | 'hover' | 'proxy-fallback' = 'viewer'): {
    mediaType: 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'font' | 'other';
    status: 'ready' | 'pending' | 'failed' | 'missing';
    kind: 'thumbnail' | 'webm_proxy' | 'audio_proxy';
    artifactId?: string;
    mimeType: string;
    errorCode?: string;
    posterArtifactId?: string;
    playbackMode?: 'source' | 'proxy';
    sourceRevisionId?: string;
    sourceMimeType?: string;
    sourceContainer?: 'mp4' | 'mov' | 'webm';
    sourceCodecs?: string[];
  } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, current_revision_id, availability
         FROM assets
        WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .get(assetId) as { relative_file_path: string; current_revision_id: string; availability: 'available' | 'missing' } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.availability === 'missing') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }

  const mediaType = LibraryService.detectMediaType(asset.relative_file_path);
  const kind = mediaType === 'video'
    ? 'webm_proxy'
    : mediaType === 'audio'
      ? 'audio_proxy'
      : 'thumbnail';
  const extension = path.extname(asset.relative_file_path).toLowerCase();
  const viewerImageArtifact = mediaType === 'image'
    && intent === 'viewer'
    && directImageMimeForExtension(extension) === null
    && imageViewerDecoderForExtension(extension) === 'oiio'
    ? this.getCurrentArtifact(libraryId, assetId, 'viewer_image')
    : null;
  const artifact = viewerImageArtifact?.status === 'ready'
    ? viewerImageArtifact
    : this.getCurrentArtifact(libraryId, assetId, kind);
  const mimeType = mediaType === 'video'
    ? artifact?.mimeType ?? 'video/mp4'
    : mediaType === 'audio'
      ? 'audio/ogg'
      : mediaType === 'text'
        ? 'text/plain'
      : 'image/webp';
  if (mediaType === 'other') {
    if (artifact?.status === 'ready' && artifact.generatorVersion.startsWith('plugin:')) {
      return {
        mediaType: 'image',
        status: 'ready',
        kind: 'thumbnail',
        artifactId: artifact.artifactId,
        mimeType: artifact.mimeType,
      };
    }
    return {
      mediaType,
      status: 'missing',
      kind,
      mimeType,
      errorCode: 'UNSUPPORTED_FORMAT',
    };
  }

  // PDF/HTML documents and PDF-compatible AI files open the original source
  // through keel://source; the renderer previews them with pdfjs / an
  // embedded browser. No thumbnail job is required to open.
  if (mediaType === 'document' && asset.current_revision_id) {
    const extension = path.extname(asset.relative_file_path).toLowerCase();
    if (
      extension === '.ai'
      && !hasPdfCompatibleIllustratorHeader(this.resolveAssetPath(libraryId, assetId))
    ) {
      return {
        mediaType,
        status: 'missing',
        kind,
        mimeType: 'application/octet-stream',
        errorCode: 'UNSUPPORTED_FORMAT',
      };
    }
    const documentMime = extension === '.pdf' || extension === '.ai'
      ? 'application/pdf'
      : extension === '.html' || extension === '.htm'
        ? 'text/html'
        : 'application/octet-stream';
    return {
      mediaType,
      status: 'ready',
      kind,
      mimeType: documentMime,
      playbackMode: 'source',
      sourceRevisionId: asset.current_revision_id,
      sourceMimeType: documentMime,
    };
  }

  // fonts open from the original source; the renderer loads
  // them with @font-face and renders the sample text itself.
  if (mediaType === 'font' && asset.current_revision_id) {
    const fontMime = fontMimeForExtension(asset.relative_file_path)
      ?? 'application/octet-stream';
    return {
      mediaType,
      status: 'ready',
      kind,
      mimeType: fontMime,
      playbackMode: 'source',
      sourceRevisionId: asset.current_revision_id,
      sourceMimeType: fontMime,
    };
  }

  // Text assets are previewed via capped IPC (asset.text.read), not keel://.
  // Still mark ready so the viewer can open without a thumbnail job.
  if (mediaType === 'text' && asset.current_revision_id) {
    const extension = path.extname(asset.relative_file_path).toLowerCase();
    const textMime = textMimeForExtension(extension) ?? 'text/plain';
    return {
      mediaType,
      status: 'ready',
      kind,
      mimeType: textMime,
      playbackMode: 'source',
      sourceRevisionId: asset.current_revision_id,
      sourceMimeType: textMime,
    };
  }

  // Models resolve to their original source (keel://source via
  // playbackMode/sourceRevisionId, same route as direct-play video). The
  // renderer's 3D surface (slice C) loads it with three.js; thumbnail/poster
  // artifacts are not needed for the viewer. Resolution logic lives in
  // model-resolution.ts so slices B/E can extend it without touching this
  // dispatch.
  const modelPreview = resolveModelPreviewResolution(
    asset.relative_file_path,
    asset.current_revision_id,
  );
  if (modelPreview) {
    return modelPreview;
  }

  const nativeMimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.opus': 'audio/ogg',
  };
  const nativeMimeType = directImageMimeForExtension(extension)
    ?? nativeMimeTypes[extension]
    ?? (mediaType === 'video' ? videoMimeForExtension(extension) : null);
  // Audio: viewer uses wide `video_poster` strip; fall back to 4:3 thumbnail
  // until cover6 regeneration lands.
  const poster = mediaType === 'video'
    ? this.getCurrentArtifact(libraryId, assetId, 'video_poster')
    : mediaType === 'audio'
      ? (this.getCurrentArtifact(libraryId, assetId, 'video_poster')
        ?? this.getCurrentArtifact(libraryId, assetId, 'thumbnail'))
    : null;
  const posterArtifactId = poster?.status === 'ready' ? poster.artifactId : undefined;
  const posterErrorCode = poster?.status === 'failed'
    ? poster.errorCode ?? 'MEDIA_PROCESSING_FAILED'
    : undefined;
  // animated GIFs intentionally stay on the native image
  // path (no WebM proxy). Chromium renders animated GIFs inside <img>, so
  // hover/viewer play the source directly; the azf6 proactive per-GIF FFmpeg
  // transcode was a long-standing Windows failure point, and on-demand
  // semantics have no trigger because <img> GIF decoding never fails.
  if (mediaType === 'video' || mediaType === 'audio') {
    // source playback is the viewer starting point for
    // Chromium-playable containers (mp4/webm/m4v). Other containers
    // (mov/avi/wmv/mkv/flv) are not a playback guarantee; a ready proxy is
    // the viewer URL so generating a proxy actually unblocks preview.
    // Hover: a ready proxy wins for every video so
    // undecodable containers can still preview in-place.
    if (mediaType === 'video' && intent !== 'proxy-fallback' && asset.current_revision_id) {
      const preferReadyProxy = intent === 'hover'
        || !isChromiumDirectPlayVideoExtension(extension);
      if (preferReadyProxy) {
        const readyProxy = this.getCurrentArtifact(libraryId, assetId, 'webm_proxy');
        if (readyProxy?.status === 'ready') {
          return {
            mediaType,
            status: 'ready',
            kind,
            artifactId: readyProxy.artifactId,
            mimeType: readyProxy.mimeType,
            playbackMode: 'proxy',
            ...(posterArtifactId ? { posterArtifactId } : {}),
          };
        }
      }
      const extracted =
        this.getExtractedMetadata({ libraryId, assetId });
      const sourceCodecs =
        extracted?.status === 'ready' && extracted.metadata?.videoCodec
          ? [extracted.metadata.videoCodec]
          : undefined;
      const sourceContainer =
        mediaType === 'video' && extension === '.mp4'
          ? 'mp4'
          : mediaType === 'video' && extension === '.mov'
            ? 'mov'
            : mediaType === 'video' && extension === '.webm'
              ? 'webm'
              : undefined;
      return {
        mediaType,
        status: 'ready',
        kind,
        mimeType: nativeMimeType ?? 'application/octet-stream',
        ...(posterArtifactId ? { posterArtifactId } : {}),
        ...(posterErrorCode ? { errorCode: posterErrorCode } : {}),
        playbackMode: 'source',
        sourceRevisionId: asset.current_revision_id,
        sourceMimeType: nativeMimeType ?? 'application/octet-stream',
        ...(sourceContainer ? { sourceContainer } : {}),
        ...(sourceContainer && sourceCodecs ? { sourceCodecs } : {}),
      };
    }
    // Audio follows the same source-first policy as video for both the
    // viewer and hover card. A ready proxy is only selected after the
    // renderer reports a real source decode failure (`proxy-fallback`).
    if (mediaType === 'audio' && intent !== 'proxy-fallback' && nativeMimeType && asset.current_revision_id) {
      return {
        mediaType,
        status: 'ready',
        kind,
        mimeType: nativeMimeType,
        ...(posterArtifactId ? { posterArtifactId } : {}),
        playbackMode: 'source',
        sourceRevisionId: asset.current_revision_id,
        sourceMimeType: nativeMimeType,
      };
    }
    const status = artifact?.status === 'generating' ? 'pending' : artifact?.status;
    if (status === 'ready' && artifact) {
      return {
        mediaType,
        status,
        kind,
        artifactId: artifact.artifactId,
        mimeType: artifact.mimeType,
        playbackMode: 'proxy',
        ...(posterArtifactId ? { posterArtifactId } : {}),
      };
    }
    if (status === 'failed' && artifact) {
      return {
        mediaType,
        status,
        kind,
        artifactId: artifact.artifactId,
        mimeType: artifact.mimeType,
        errorCode: artifact.errorCode ?? 'MEDIA_PROCESSING_FAILED',
        ...(posterArtifactId ? { posterArtifactId } : {}),
      };
    }
    // Do not enqueue an audio proxy merely because a preview was requested.
    // `retryArtifact(audio_proxy)` is the explicit source-decode failure
    // path, and keeps native formats from producing background conversions.
    return {
      mediaType,
      status: 'pending',
      kind,
      mimeType,
      ...(posterArtifactId ? { posterArtifactId } : {}),
    };
  }
  if (artifact) {
    const status = artifact.status === 'generating' ? 'pending' : artifact.status;
    // Prefer a ready derivative, except native images always use the original
    // (REQ-VIEW-002: uncompressed source in the viewer).
    if (
      status === 'ready' &&
      !(mediaType === 'image' && nativeMimeType && !artifact.generatorVersion.startsWith('plugin:'))
    ) {
      return {
        mediaType,
        status,
        kind,
        artifactId: artifact.artifactId,
        mimeType: artifact.mimeType,
        ...(posterArtifactId ? { posterArtifactId } : {}),
      };
    }
    // Non-native formats have no Chromium-playable source: surface derivative
    // pending/failed. Native formats fall through to source below.
    if (!nativeMimeType) {
      if (status === 'failed') {
        return {
          mediaType,
          status,
          kind,
          artifactId: artifact.artifactId,
          mimeType: artifact.mimeType,
          errorCode: artifact.errorCode ?? 'MEDIA_PROCESSING_FAILED',
          ...(posterArtifactId ? { posterArtifactId } : {}),
        };
      }
      return {
        mediaType,
        status: 'pending',
        kind,
        artifactId: artifact.artifactId,
        mimeType: artifact.mimeType,
        ...(posterArtifactId ? { posterArtifactId } : {}),
      };
    }
  }

  // Browsing native images remains an optimization. Audio and video take the
  // safe proxy branch above because a container extension is not a
  // cross-platform playback guarantee.
  if (nativeMimeType && asset.current_revision_id) {
      return {
        mediaType,
        status: 'ready',
        kind,
        mimeType: nativeMimeType,
        ...(posterArtifactId ? { posterArtifactId } : {}),
        playbackMode: 'source',
        sourceRevisionId: asset.current_revision_id,
        sourceMimeType: nativeMimeType,
      };
  }

  const activeJob = openLibrary.connection
    .prepare(
      `SELECT status
         FROM jobs
        WHERE asset_id = ?
           AND kind IN ('generate_thumbnail', 'generate_webm_proxy', 'generate_audio_proxy')
          AND status IN ('queued', 'running', 'paused')
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .get(assetId) as { status: 'queued' | 'running' | 'paused' } | undefined;
  if (activeJob) {
    return {
      mediaType,
      status: 'pending',
      kind,
      mimeType,
      ...(posterArtifactId ? { posterArtifactId } : {}),
    };
  }
  return {
    mediaType,
    status: 'missing',
    kind,
    mimeType,
    ...(posterArtifactId ? { posterArtifactId } : {}),
  };
}

/** Queue an artifact retry and return before any decoder subprocess starts. */
export function enqueueArtifactRetry(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
    kind: 'thumbnail' | 'webm_proxy' | 'audio_proxy';
  }): string {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const asset = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, location_kind, linked_folder_id,
              current_revision_id, availability
         FROM assets
        WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .get(input.assetId) as {
      relative_file_path: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
    } | undefined;
  if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset && this.isExplicitlyIgnored(
    openLibrary,
    asset.location_kind,
    asset.linked_folder_id,
    asset.relative_file_path,
    'asset',
  )) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  const assetMediaType = LibraryService.detectMediaType(asset.relative_file_path);
  const expectedKind = assetMediaType === 'video'
    ? 'webm_proxy'
    : assetMediaType === 'audio'
      ? 'audio_proxy'
      : 'thumbnail';
  if (input.kind !== expectedKind) {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }
  const jobKind = input.kind === 'webm_proxy'
    ? 'generate_webm_proxy'
    : input.kind === 'audio_proxy'
      ? 'generate_audio_proxy'
      : 'generate_thumbnail';
  const explicitProxyFallback = input.kind === 'webm_proxy' || input.kind === 'audio_proxy';

  // A playback failure can race a proxy that was generated by an earlier
  // session or by another viewer. Keep a valid current proxy intact and
  // let the caller resolve it immediately; retrying must never turn a
  // successful fallback into another full encode.
  if (input.kind === 'webm_proxy' || input.kind === 'audio_proxy') {
    const currentArtifact = this.getCurrentArtifact(
      input.libraryId,
      input.assetId,
      input.kind,
    );
    if (currentArtifact?.status === 'ready') {
      try {
        this.getArtifactAbsolutePath(
          input.libraryId,
          currentArtifact.artifactId,
          'proxy',
        );
        return currentArtifact.artifactId;
      } catch {
        // The DB row is stale or the artifact file is gone. Invalidate it
        // below and create a replacement for this explicit playback error.
      }
    }
  }

  return openLibrary.connection.transaction(() => {
    const active = openLibrary.connection
      .prepare(
        `SELECT job_id
           FROM jobs
          WHERE asset_id = ?
            AND kind = ?
            AND status IN ('queued', 'running', 'paused')
          ORDER BY updated_at DESC
          LIMIT 1`,
      )
      .get(input.assetId, jobKind) as { job_id: string } | undefined;
    if (active) {
      if (explicitProxyFallback) {
        openLibrary.connection.prepare(
          'UPDATE jobs SET priority = MAX(priority, 300), error_code = ?, updated_at = ? WHERE job_id = ?',
        ).run(EXPLICIT_PROXY_FALLBACK_MARKER, new Date().toISOString(), active.job_id);
      } else {
        openLibrary.connection.prepare(
          'UPDATE jobs SET priority = MAX(priority, 300), updated_at = ? WHERE job_id = ?',
        ).run(new Date().toISOString(), active.job_id);
      }
      return active.job_id;
    }

    if (input.kind === 'webm_proxy' || input.kind === 'audio_proxy') {
      openLibrary.connection.prepare(
        `UPDATE revision_artifacts SET invalidated_at = ?
          WHERE revision_id = ? AND kind = ? AND invalidated_at IS NULL`,
      ).run(new Date().toISOString(), asset.current_revision_id, input.kind);
    } else {
      // An explicit thumbnail retry is allowed to replace a ready artifact.
      // Invalidate it before the claim-time admission check so the durable
      // job cannot be mistaken for an automatic duplicate.
      openLibrary.connection.prepare(
        `UPDATE revision_artifacts SET invalidated_at = ?
          WHERE revision_id = ? AND kind = 'thumbnail' AND invalidated_at IS NULL`,
      ).run(new Date().toISOString(), asset.current_revision_id);
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `INSERT INTO jobs
           (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
            attempt_count, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 300, 0.0, 0, ?, ?, ?)`,
      )
      .run(
        jobId,
        input.libraryId,
        input.assetId,
        asset.current_revision_id,
        jobKind,
        explicitProxyFallback ? EXPLICIT_PROXY_FALLBACK_MARKER : null,
        now,
        now,
      );
    return jobId;
  })();
}

/** Get the absolute filesystem path for an artifact. */
export function getArtifactAbsolutePath(this: LibraryService, libraryId: string, artifactId: string, usage?: 'preview' | 'proxy'): string {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const cacheKey = `${libraryId}\u0000${artifactId}`;
  const currentChangeSequence = openLibrary.changeSubscription.lastSequence;
  const cached = this.artifactPathCache.get(cacheKey);
  if (cached && cached.changeSequence === currentChangeSequence) {
    this.assertArtifactUsage(cached.kind, usage);
    this.validateCachedArtifactPath(openLibrary, cached.absolutePath);
    return cached.absolutePath;
  }
  // The join against the asset's current revision is the serving boundary:
  // permanently deleted assets lose their row and stop resolving here, while
  // trashed assets keep resolving so the trash scope can show a decodable
  // preview (the derived artifact is not moved or invalidated by trashing).
  const row = openLibrary.connection
    .prepare(
      `SELECT ra.artifact_id, ra.file_path, ra.kind
         FROM revision_artifacts ra
         JOIN assets a ON a.current_revision_id = ra.revision_id
        WHERE ra.artifact_id = ?
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL`,
    )
    .get(artifactId) as { artifact_id: string; file_path: string; kind: string } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  this.assertArtifactUsage(row.kind, usage);
  const absolutePath = this.artifactFilePathFromRow(openLibrary, row.file_path);
  this.artifactPathCache.set(cacheKey, {
    absolutePath,
    kind: row.kind,
    changeSequence: openLibrary.changeSubscription.lastSequence,
  });
  return absolutePath;
}

/** Resolve a burst of virtual-card previews with one query/root check. */
export function getArtifactAbsolutePaths(this: LibraryService, libraryId: string, artifactIds: readonly string[], usage: 'preview' | 'proxy'): Array<{ artifactId: string; absolutePath: string }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const ids = [...new Set(artifactIds)].slice(0, 500);
  if (ids.length === 0) return [];
  const rows = openLibrary.connection.prepare(
    `SELECT ra.artifact_id, ra.file_path, ra.kind
       FROM revision_artifacts ra
       JOIN assets a ON a.current_revision_id = ra.revision_id
      WHERE ra.artifact_id IN (${ids.map(() => '?').join(',')})
        AND ra.status = 'ready'
        AND ra.invalidated_at IS NULL`,
  ).all(...ids) as Array<{ artifact_id: string; file_path: string; kind: string }>;
  const byId = new Map(rows.map((row) => [row.artifact_id, row] as const));
  const artifactsRoot = this.artifactRootPath(openLibrary);
  const changeSequence = openLibrary.changeSubscription.lastSequence;
  const entries: Array<{ artifactId: string; absolutePath: string }> = [];
  for (const artifactId of ids) {
    const row = byId.get(artifactId);
    if (!row) continue;
    try {
      this.assertArtifactUsage(row.kind, usage);
    } catch {
      // Preserve the single-artifact 404 semantics for one stale or
      // incompatible id without discarding valid siblings in the batch.
      continue;
    }
    try {
      const absolutePath = this.artifactFilePathFromRoot(artifactsRoot, row.file_path);
      this.artifactPathCache.set(`${libraryId}\u0000${artifactId}`, {
        absolutePath,
        kind: row.kind,
        changeSequence,
      });
      entries.push({ artifactId, absolutePath });
    } catch (error) {
      if (
        error instanceof LibraryServiceError
        && (error.code === 'ASSET_NOT_FOUND' || error.code === 'INVALID_LIBRARY_PATH')
      ) {
        continue;
      }
      throw error;
    }
  }
  return entries;
}

export function assertArtifactUsage(this: LibraryService, kind: string, usage?: 'preview' | 'proxy'): void {
  if (!usage) return;
  const allowedKinds = usage === 'proxy'
    ? new Set(['webm_proxy', 'audio_proxy'])
    : new Set(['thumbnail', 'viewer_image', 'video_poster', 'model_glb']);
  if (!allowedKinds.has(kind)) throw new LibraryServiceError('ASSET_NOT_FOUND');
}

export function validateCachedArtifactPath(this: LibraryService, openLibrary: OpenLibrary, absolutePath: string): void {
  const artifactsDir = this.artifactsDir(openLibrary);
  try {
    const rootEntry = lstatSync(artifactsDir);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    const artifactsRoot = realpathSync(artifactsDir);
    const targetEntry = lstatSync(absolutePath);
    if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    const realTarget = realpathSync(absolutePath);
    const relation = path.relative(artifactsRoot, realTarget);
    if (
      relation === ''
      || relation.startsWith(`..${path.sep}`)
      || path.isAbsolute(relation)
    ) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
  }
}

/**
* Containment-checked absolute path for an artifact row's relative path.
* The artifacts root itself must be a real directory (no symlink), the
* resolved target must stay inside it, and the target file must exist as a
* regular non-symlink file. Callers that already hold the artifact row skip
* the per-artifact DB lookup (batch drag priming).
*/
export function artifactFilePathFromRow(this: LibraryService, openLibrary: OpenLibrary, relativeFilePath: string): string {
  return this.artifactFilePathFromRoot(
    this.artifactRootPath(openLibrary),
    relativeFilePath,
  );
}

export function artifactRootPath(this: LibraryService, openLibrary: OpenLibrary): string {
  const artifactsDir = this.artifactsDir(openLibrary);
  try {
    const rootEntry = lstatSync(artifactsDir);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    return realpathSync(artifactsDir);
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
  }
}

export async function artifactRootPathAsync(this: LibraryService, openLibrary: OpenLibrary): Promise<string> {
  const artifactsDir = this.artifactsDir(openLibrary);
  try {
    const rootEntry = await lstatAsync(artifactsDir);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    return await realpathAsync(artifactsDir);
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
  }
}

export function artifactFilePathFromRoot(this: LibraryService, artifactsRoot: string, relativeFilePath: string): string {
  const targetPath = path.resolve(artifactsRoot, ...relativeFilePath.split('/'));
  const relation = path.relative(artifactsRoot, targetPath);
  if (
    relation === '' ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  try {
    const targetEntry = lstatSync(targetPath);
    if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    const realTarget = realpathSync(targetPath);
    const realRelation = path.relative(artifactsRoot, realTarget);
    if (
      realRelation === '' ||
      realRelation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelation)
    ) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    return realTarget;
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
  }
}

/** Async equivalent for bounded bulk serving; keep the sync point API intact. */
export async function artifactFilePathFromRootAsync(this: LibraryService, artifactsRoot: string, relativeFilePath: string): Promise<string> {
  const targetPath = path.resolve(artifactsRoot, ...relativeFilePath.split('/'));
  const relation = path.relative(artifactsRoot, targetPath);
  if (
    relation === '' ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new LibraryServiceError('INVALID_LIBRARY_PATH');
  }
  try {
    const targetEntry = await lstatAsync(targetPath);
    if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    const realTarget = await realpathAsync(targetPath);
    const realRelation = path.relative(artifactsRoot, realTarget);
    if (
      realRelation === '' ||
      realRelation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelation)
    ) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    return realTarget;
  } catch (error) {
    if (error instanceof LibraryServiceError) throw error;
    throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
  }
}

export function getCurrentMediaSource(this: LibraryService, libraryId: string, assetId: string, revisionId: string): { absolutePath: string; mimeType: string } {
  const openLibrary = this.requireOpenLibrary(libraryId);
  const asset = openLibrary.connection.prepare(
    `SELECT relative_file_path, current_revision_id, availability, deleted_at
       FROM assets WHERE asset_id = ?`,
  ).get(assetId) as {
    relative_file_path: string;
    current_revision_id: string | null;
    availability: 'available' | 'missing';
    deleted_at: string | null;
  } | undefined;
  if (!asset || asset.deleted_at || asset.availability !== 'available') {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  if (asset.current_revision_id !== revisionId) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  const extension = path.extname(asset.relative_file_path).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.opus': 'audio/ogg',
    // PDF/HTML and PDF-compatible AI source responses need their real MIME
    // so the renderer can present them (pdfjs / iframe) instead of download.
    '.pdf': 'application/pdf',
    '.ai': 'application/pdf',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
  };
  const mimeType = directImageMimeForExtension(extension)
    ?? videoMimeForExtension(extension)
    ?? mimeTypes[extension]
    ?? audioMimeForExtension(extension)
    ?? modelMimeForExtension(extension)
    // Companion files (MTL, TGA textures, …) have no registered media
    // MIME; serving them as octet-stream through the source route (which
    // still requires a valid revision token) lets 3D loaders fetch them.
    ?? 'application/octet-stream';
  return { absolutePath: this.resolveAssetPath(libraryId, assetId), mimeType };
}

/** @deprecated Use getCurrentMediaSource; kept for protocol and test compatibility. */
export function getCurrentVideoSource(this: LibraryService, libraryId: string, assetId: string, revisionId: string): { absolutePath: string; mimeType: string } {
  return this.getCurrentMediaSource(libraryId, assetId, revisionId);
}

export function enqueueReadyPaletteJobs(this: LibraryService, openLibrary: OpenLibrary, options: { assetIds?: string[]; limit?: number; priority?: number }): number {
  const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
  if (options.assetIds && selectedIds.length === 0) return 0;
  const selectedSql = selectedIds.length > 0
    ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
    : '';
  const limit = options.limit === undefined
    ? 500
    : Math.max(0, Math.min(500, Math.trunc(options.limit)));
  if (limit === 0) return 0;
  const paletteExtensions = [
    ...IMAGE_EXTENSIONS,
    ...VIDEO_EXTENSIONS,
    ...MODEL_EXTENSIONS,
    ...DOCUMENT_EXTENSIONS,
  ];
  const hasSourceDimensions = columnsFor(openLibrary.connection, 'revision_artifacts').has('width')
    && columnsFor(openLibrary.connection, 'revision_artifacts').has('height');
  const sourceDirectExtensions = IMAGE_EXTENSIONS.map((extension) => extension.slice(1));
  const sourceDirectSql = hasSourceDimensions
    ? `
           OR (
             source_revision.byte_size <= ${SOURCE_DIRECT_MAX_BYTES}
             AND (${sourceDirectExtensions.map(() => 'LOWER(a.relative_file_path) LIKE ?').join(' OR ')})
             AND EXISTS (
               SELECT 1 FROM revision_artifacts source_metadata
                WHERE source_metadata.revision_id = a.current_revision_id
                  AND source_metadata.kind = 'extracted_metadata'
                  AND source_metadata.status = 'ready'
                  AND source_metadata.invalidated_at IS NULL
                  AND source_metadata.width > 0
                  AND source_metadata.height > 0
                  AND source_metadata.width <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                  AND source_metadata.height <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                  AND source_metadata.width * source_metadata.height <= ${SOURCE_DIRECT_MAX_PIXELS}
             )
           )`
    : '';
  const rows = openLibrary.connection.prepare(
    `SELECT a.asset_id, a.current_revision_id, a.relative_file_path,
            source_revision.byte_size AS source_byte_size
            ${hasSourceDimensions ? `,
            (SELECT source_metadata.width
               FROM revision_artifacts source_metadata
              WHERE source_metadata.revision_id = a.current_revision_id
                AND source_metadata.kind = 'extracted_metadata'
                AND source_metadata.status = 'ready'
                AND source_metadata.invalidated_at IS NULL
              ORDER BY source_metadata.generated_at DESC
              LIMIT 1) AS source_width,
            (SELECT source_metadata.height
               FROM revision_artifacts source_metadata
              WHERE source_metadata.revision_id = a.current_revision_id
                AND source_metadata.kind = 'extracted_metadata'
                AND source_metadata.status = 'ready'
                AND source_metadata.invalidated_at IS NULL
              ORDER BY source_metadata.generated_at DESC
              LIMIT 1) AS source_height` : ', NULL AS source_width, NULL AS source_height'}
       FROM assets a
       JOIN revisions source_revision
         ON source_revision.revision_id = a.current_revision_id
      WHERE a.deleted_at IS NULL
        AND a.availability = 'available'
        AND a.current_revision_id IS NOT NULL
        AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
        ${selectedSql}
        AND (${paletteExtensions.map(() => 'LOWER(a.relative_file_path) LIKE ?').join(' OR ')})
        AND (
          EXISTS (
            SELECT 1 FROM revision_artifacts source
             WHERE source.revision_id = a.current_revision_id
               AND source.kind IN ('thumbnail', 'video_poster')
               AND source.status = 'ready'
               AND source.invalidated_at IS NULL
          )${sourceDirectSql}
        )
        AND NOT EXISTS (
          SELECT 1 FROM revision_artifacts palette
           WHERE palette.revision_id = a.current_revision_id
             AND palette.kind = 'extracted_palette'
             AND palette.status IN ('ready', 'failed')
             AND palette.invalidated_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM jobs job
           WHERE job.asset_id = a.asset_id
             AND job.revision_id = a.current_revision_id
             AND job.kind = 'extract_palette'
             AND job.status IN ('queued', 'running', 'paused')
        )
      ORDER BY a.relative_file_path
      LIMIT ?`,
  ).all(
    ...selectedIds,
    ...paletteExtensions.map((extension) => `%.${extension.slice(1)}`),
    ...(hasSourceDimensions
      ? sourceDirectExtensions.map((extension) => `%.${extension}`)
      : []),
    limit,
  ) as Array<{
    asset_id: string;
    current_revision_id: string;
    relative_file_path: string;
    source_byte_size: number;
    source_width: number | null;
    source_height: number | null;
  }>;
  let enqueued = 0;
  for (const row of rows) {
    if (this.enqueuePaletteJob(
      openLibrary,
      row.asset_id,
      row.current_revision_id,
      options.priority ?? -10,
    )) enqueued += 1;
  }
  return enqueued;
}

/**
* Invalidate ready artifacts whose files are missing under `.keel/artifacts`.
* Used after import/open when an older export omitted the artifacts tree while
* the DB still recorded status=ready.
*/
export async function reconcileMissingArtifactFiles(this: LibraryService, openLibrary: OpenLibrary, yieldTurn?: () => Promise<void>, onMissingPrimaryArtifacts?: (assetIds: string[]) => void): Promise<number> {
  // lenient open (0031 §1): libraries predating
  // revision_artifacts.status skip this recovery step instead of failing
  // to open.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return 0;
  }
  const artifactsDir = this.artifactsDir(openLibrary);
  let artifactsRoot: string;
  try {
    const rootEntry = lstatSync(artifactsDir);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return 0;
    artifactsRoot = realpathSync(artifactsDir);
  } catch {
    return 0;
  }

  const rows = openLibrary.connection
    .prepare(
      `SELECT ra.artifact_id, ra.file_path, ra.kind, a.asset_id
         FROM revision_artifacts ra
         JOIN assets a ON a.current_revision_id = ra.revision_id
        WHERE ra.status = 'ready'
          AND ra.invalidated_at IS NULL
          AND a.deleted_at IS NULL
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}`,
    )
    .all() as Array<{
      artifact_id: string;
      file_path: string;
      kind: string;
      asset_id: string;
    }>;
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();

  // The artifacts directory is flat (artifact_id + extension written by the
  // generators), so one directory listing replaces per-file lstat+realpath.
  // On SMB/NAS each lstat is a network round trip (~10ms measured), which
  // made this sweep cost minutes of pure latency on a 20k-artifact store;
  // a single readdir costs one directory enumeration regardless of how the
  // entries are checked afterwards. A symlinked or subdirectory entry is
  // never treated as present, matching the old containment rules.
  // 现场教训（用户 NAS 库打开 5 分钟）：21k 条目的 readdirSync
  // 是一次 ~21 秒的同步调用，期间 Worker 事件循环完全停摆——所有并发请求
  // 撞上 15s 超时。改为 opendir 异步流式构建集合，让事件循环持续可响应。
  // 补充实测（真实 NAS 生产库）：即便纯异步，21,508 条目的
  // 目录枚举本身也要 ~16.5s——SMB 目录元数据是海量小往返。因此：
  // ① names-only readdir（Dirent 类型判定在本目录全是常规文件的扁平结构里
  //    没有额外价值；路径逃逸防护仍由 artifactFilePresent 的 containment
  //    检查承担；同名符号链接/子目录被当作存在的代价只是少触发一次重建，
  //    可接受）；
  // ② 枚举循环每 4k 条让步一次事件循环——配合链尾调度 + startup gate，
  //    交互请求到达时永远不需要等待整个枚举完成。
  let presentArtifactPaths: Set<string>;
  try {
    presentArtifactPaths = new Set();
    const dir = await opendirAsync(artifactsRoot);
    try {
      let sinceYield = 0;
      for (;;) {
        const entry = await dir.read();
        if (entry === null) break;
        if (entry.name.startsWith('.')) continue;
        presentArtifactPaths.add(entry.name);
        if (++sinceYield >= 4_096 && yieldTurn) {
          sinceYield = 0;
          await yieldTurn();
        }
      }
    } finally {
      await dir.close();
    }
  } catch {
    return 0;
  }
  const artifactFilePresent = (filePath: string): boolean => {
    // Same containment rules as getArtifactAbsolutePath — escape / symlink → treat missing.
    const targetPath = path.resolve(artifactsRoot, ...filePath.split('/'));
    const relation = path.relative(artifactsRoot, targetPath);
    if (
      relation === '' ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      return false;
    }
    return presentArtifactPaths.has(targetPath.slice(artifactsRoot.length + path.sep.length));
  };

  // sweep in batches and yield between batches so a large
  // artifact store does not stall the Worker event loop for seconds.
  // each batch is one multi-row UPDATE instead of a
  // per-row transaction. Network libraries run under a rollback journal,
  // where any open write blocks concurrent reads — collapsing 400
  // statements into one keeps that write window (and the user-visible
  // stall it can cause on SMB) as short as possible.
  const batchSize = 400;
  let invalidated = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const missingRows = rows
      .slice(offset, offset + batchSize)
      .filter((row) => !artifactFilePresent(row.file_path));
    const missingIds = missingRows.map((row) => row.artifact_id);
    if (missingIds.length > 0) {
      const changed = openLibrary.connection.prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE artifact_id IN (${sqliteInPlaceholders(missingIds)})
            AND invalidated_at IS NULL`,
      ).run(now, ...missingIds).changes;
      invalidated += changed;
      const missingPrimaryAssetIds = [...new Set(
        missingRows
          .filter((row) => row.kind === 'thumbnail' || row.kind === 'video_poster')
          .map((row) => row.asset_id),
      )];
      if (changed > 0 && missingPrimaryAssetIds.length > 0) {
        try {
          onMissingPrimaryArtifacts?.(missingPrimaryAssetIds);
        } catch (error) {
          this.diagnose('artifact.missing-primary-queue-notify', error, {
            libraryId: openLibrary.summary.libraryId,
            affectedAssetCount: missingPrimaryAssetIds.length,
          });
        }
      }
    }
    if (yieldTurn && offset + batchSize < rows.length) {
      await yieldTurn();
    }
  }
  return invalidated;
}

/**
* Remove old artifact files left behind by a crash after a DB replacement
* commit but before the best-effort unlink. Only the flat artifacts root is
* scanned, only paths older than the grace period are eligible, and every
* non-temporary file still referenced by an active artifact row is retained.
*/
export async function reconcileOrphanArtifactFiles(this: LibraryService, openLibrary: OpenLibrary, yieldTurn?: () => Promise<void>): Promise<number> {
  let artifactsRoot: string;
  try {
    const artifactsDir = this.artifactsDir(openLibrary);
    const rootEntry = lstatSync(artifactsDir);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return 0;
    artifactsRoot = realpathSync(artifactsDir);
  } catch {
    return 0;
  }

  const referencedPaths = new Set<string>();
  const rows = openLibrary.connection
    .prepare(
      `SELECT file_path
         FROM revision_artifacts
        WHERE file_path IS NOT NULL
          AND invalidated_at IS NULL`,
    )
    .all() as Array<{ file_path: string }>;
  for (const row of rows) {
    const targetPath = path.resolve(artifactsRoot, ...row.file_path.split('/'));
    const relation = path.relative(artifactsRoot, targetPath);
    if (
      relation === ''
      || relation.startsWith(`..${path.sep}`)
      || path.isAbsolute(relation)
    ) continue;
    referencedPaths.add(targetPath);
  }

  let removed = 0;
  let scanned = 0;
  let enumerated = 0;
  let probed = 0;
  let skippedReferenced = 0;
  const scanStartedAt = performance.now();
  const now = Date.now();
  const directory = await opendirAsync(artifactsRoot);
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      enumerated += 1;
      // Normalization writes `<uuid>.tmp` before its atomic final rename;
      // leave temporary files to the existing job cleanup path.
      if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue;
      const candidatePath = path.join(artifactsRoot, entry.name);
      // consult the reference set *before* the filesystem.
      // This directory holds tens of thousands of artifacts and nearly every
      // one is still referenced, so probing first spent the whole scan on
      // paths the database already accounted for (measured on a 44k-asset
      // library: 17.2 s of `artifact-orphan-cleanup` per open).
      if (referencedPaths.has(candidatePath)) {
        skippedReferenced += 1;
        continue;
      }
      let entryStat: Awaited<ReturnType<typeof lstatAsync>>;
      try {
        probed += 1;
        entryStat = await lstatAsync(candidatePath);
      } catch {
        continue;
      }
      if (
        !entryStat.isFile()
        || entryStat.isSymbolicLink()
        || now - entryStat.mtimeMs < ORPHAN_ARTIFACT_GRACE_MS
      ) continue;
      try {
        await rmAsync(candidatePath, { force: true });
        removed += 1;
      } catch (error) {
        this.diagnose('artifact.orphan-cleanup', error, {
          libraryId: openLibrary.summary.libraryId,
          fileName: entry.name,
        });
      }
      scanned += 1;
      if (yieldTurn && scanned % 256 === 0) await yieldTurn();
    }
  } finally {
    await directory.close();
  }
  // Stage metrics for the reconciliation perf ticket: enumeration, probes,
  // candidates excluded by reference and actual removals are separate numbers.
  if (process.env.KEEL_REFRESH_STAGE_LOG === '1') {
    console.error(JSON.stringify({
      scope: 'open.reconciliation.stage',
      libraryId: openLibrary.summary.libraryId,
      stage: 'artifact-orphan-scan',
      enumerated,
      probed,
      skippedReferenced,
      referencedPaths: referencedPaths.size,
      candidates: removed,
      durationMs: Math.round((performance.now() - scanStartedAt) * 100) / 100,
    }));
  }
  return removed;
}

export function networkMetadataBrowseChangeSequence(this: LibraryService, connection: DatabaseConnection, libraryId: string): number {
  const row = connection
    .prepare(
      'SELECT sequence FROM browse_change_sequence WHERE library_id = ?',
    )
    .get(libraryId) as { sequence: number } | undefined;
  if (!row || !Number.isSafeInteger(row.sequence) || row.sequence < 0) {
    throw new Error('The browse change sequence is missing or invalid.');
  }
  return row.sequence;
}

/**
* Requeue every current preview whose failure was specifically caused by a
* missing external component. This is separate from the normal bounded
* startup scan so a library with many old failures can repair them all while
* normal missing-thumbnail work remains bounded.
*/
export function enqueueFailedMediaRepairs(this: LibraryService, openLibrary: OpenLibrary, components: Set<MediaAutoRepairComponent>, priority: number): number {
  const failureConditions: string[] = [];
  if (components.has('ffmpeg')) failureConditions.push("ra.error_code = 'FFMPEG_REQUIRED'");
  if (components.has('oiio')) failureConditions.push("ra.error_code = 'OIIO_REQUIRED'");
  if (failureConditions.length === 0) return 0;

  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id, ra.kind AS artifact_kind
         FROM assets a
         JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
         WHERE a.deleted_at IS NULL
           AND a.availability = 'available'
           AND a.current_revision_id IS NOT NULL
           AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
           AND ra.kind IN ('thumbnail', 'video_poster', 'audio_proxy')
          AND ra.status = 'failed'
          AND ra.invalidated_at IS NULL
          AND (${failureConditions.join(' OR ')})
          AND NOT EXISTS (
            SELECT 1
              FROM jobs active
             WHERE active.asset_id = a.asset_id
               AND active.revision_id = a.current_revision_id
               AND active.kind = CASE ra.kind
                 WHEN 'audio_proxy' THEN 'generate_audio_proxy'
                 ELSE 'generate_thumbnail'
               END
               AND active.status IN ('queued', 'running', 'paused')
          )
        ORDER BY a.relative_file_path`,
    )
    .all() as Array<{
      asset_id: string;
      current_revision_id: string;
      artifact_kind: 'thumbnail' | 'video_poster' | 'audio_proxy';
    }>;
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  const findFailedJob = openLibrary.connection.prepare(
    `SELECT job_id
       FROM jobs
      WHERE asset_id = ?
        AND revision_id = ?
        AND kind = ?
        AND status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  const resetFailedJob = openLibrary.connection.prepare(
    `UPDATE jobs
        SET status = 'queued',
            priority = MAX(priority, ?),
            progress = 0.0,
            attempt_count = 0,
            error_code = NULL,
            error_detail = NULL,
            updated_at = ?
      WHERE job_id = ?`,
  );
  const insertJob = openLibrary.connection.prepare(
    `INSERT INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
        attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, 0.0, 0, ?, ?)`,
  );

  const repairJobs = new Map<string, {
    assetId: string;
    revisionId: string;
    kind: 'generate_thumbnail' | 'generate_audio_proxy';
  }>();
  for (const row of rows) {
    const kind = row.artifact_kind === 'audio_proxy'
      ? 'generate_audio_proxy'
      : 'generate_thumbnail';
    repairJobs.set(`${row.asset_id}:${kind}`, {
      assetId: row.asset_id,
      revisionId: row.current_revision_id,
      kind,
    });
  }
  let enqueued = 0;
  openLibrary.connection.transaction(() => {
    for (const row of repairJobs.values()) {
      const failedJob = findFailedJob.get(
        row.assetId,
        row.revisionId,
        row.kind,
      ) as { job_id: string } | undefined;
      if (failedJob) {
        enqueued += resetFailedJob.run(priority, now, failedJob.job_id).changes;
      } else {
        enqueued += insertJob.run(
          randomUUID(),
          openLibrary.summary.libraryId,
          row.assetId,
          row.revisionId,
          row.kind,
          priority,
          now,
          now,
        ).changes;
      }
    }
  })();
  return enqueued;
}

/**
* Return whether a primary artifact was produced by the current generator
* family. This is intentionally a prefix/family check: settings such as
* EXR plane and colour space are part of artifact_key and are validated by
* the viewer path, while this queue gate only needs to retire generators
* whose implementation version changed.
*/
export function primaryArtifactGeneratorIsCurrent(this: LibraryService, relativeFilePath: string, kind: 'thumbnail' | 'video_poster', generatorVersion: string): boolean {
  if (generatorVersion.startsWith('plugin:')) return true;
  // Imported Eagle/Billfish previews are deliberately kept as the visible
  // fallback while their low-priority normalization job is queued. The
  // queue must not invalidate the only usable card before that job runs.
  if (isImportedThumbnailGenerator(generatorVersion)) return true;
  const mediaType = LibraryService.detectMediaType(relativeFilePath);
  if (kind === 'video_poster') {
    return mediaType === 'audio'
      ? generatorVersion.includes(AUDIO_WAVEFORM_COVER_GENERATOR_TAG)
      : generatorVersion.startsWith(`ffmpeg@${FFMPEG_VERSION}`)
        && generatorVersion.includes(VIDEO_POSTER_GENERATOR_TAG);
  }
  switch (mediaType) {
    case 'image': {
      const extension = path.extname(relativeFilePath).toLowerCase();
      const oiioOwned = isRawImageExtension(extension)
        || extension === '.ico'
        || imageViewerDecoderForExtension(extension) === 'oiio';
      return oiioOwned
        ? generatorVersion.startsWith(`oiio@${OIIO_VERSION}`)
          || generatorVersion.startsWith(RAW_EMBEDDED_THUMBNAIL_GENERATOR)
        : generatorVersion.startsWith(`sharp@${SHARP_VERSION}`)
          || generatorVersion.startsWith(`ffmpeg@${FFMPEG_VERSION};truncated-jpeg-recovery`);
    }
    case 'audio':
      return generatorVersion.includes(AUDIO_WAVEFORM_COVER_GENERATOR_TAG);
    case 'model':
      return generatorVersion === MODEL_THUMBNAIL_GENERATOR_VERSION;
    case 'document':
      // DOCUMENT_THUMBNAIL_GENERATOR_VERSION 对应 offscreen HTML 渲染器；
      // generatePdfThumbnail（pdfjs）写入 `pdfjs@<version>`。若只认 offscreen
      // 版本，pdfjs 生成的 PDF 缩略图每次 enqueue 都被判 stale 而失效，
      // 造成「生成成功→立即失效→重生成」的封面 churn。两者都应视为当前。
      return generatorVersion === DOCUMENT_THUMBNAIL_GENERATOR_VERSION
        || generatorVersion.startsWith('pdfjs@');
    case 'font':
      // 字体样张由 offscreen 样张页生成，版本标签独立。
      return generatorVersion === FONT_THUMBNAIL_GENERATOR_VERSION;
    default:
      return true;
  }
}

/** Invalidate only visible stale primary rows; never scan the whole library. */
export function invalidateStalePrimaryArtifacts(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): number {
  if (assetIds.length === 0) return 0;
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.asset_id',
    assetIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.relative_file_path, ra.artifact_id, ra.kind, ra.generator_version,
                  source_revision.byte_size AS source_byte_size,
                  (SELECT source_metadata.width
                     FROM revision_artifacts source_metadata
                    WHERE source_metadata.revision_id = a.current_revision_id
                      AND source_metadata.kind = 'extracted_metadata'
                      AND source_metadata.status = 'ready'
                      AND source_metadata.invalidated_at IS NULL
                    ORDER BY source_metadata.generated_at DESC
                    LIMIT 1) AS source_width,
                  (SELECT source_metadata.height
                     FROM revision_artifacts source_metadata
                    WHERE source_metadata.revision_id = a.current_revision_id
                      AND source_metadata.kind = 'extracted_metadata'
                      AND source_metadata.status = 'ready'
                      AND source_metadata.invalidated_at IS NULL
                    ORDER BY source_metadata.generated_at DESC
                    LIMIT 1) AS source_height
             FROM assets a
             JOIN revisions source_revision
               ON source_revision.revision_id = a.current_revision_id
             JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
            WHERE ${sql}
              AND a.deleted_at IS NULL
              AND ra.kind IN ('thumbnail', 'video_poster')
              AND ra.status IN ('ready', 'failed')
              AND ra.invalidated_at IS NULL`,
        )
        .all(...params) as Array<{
          relative_file_path: string;
          artifact_id: string;
          kind: 'thumbnail' | 'video_poster';
          generator_version: string;
          source_byte_size: number | null;
          source_width: number | null;
          source_height: number | null;
        }>,
  );
  const stale = rows.filter((row) => !this.primaryArtifactGeneratorIsCurrent(
    row.relative_file_path,
    row.kind,
    row.generator_version,
  ));
  if (stale.length === 0) return 0;
  const invalidate = openLibrary.connection.prepare(
    `UPDATE revision_artifacts
        SET invalidated_at = ?
      WHERE artifact_id = ?
        AND invalidated_at IS NULL`,
  );
  const now = new Date().toISOString();
  let invalidated = 0;
  openLibrary.connection.transaction(() => {
    for (const row of stale) invalidated += invalidate.run(now, row.artifact_id).changes;
  })();
  return invalidated;
}

/**
* Queue one bounded normalization job for a copied Eagle/Billfish preview.
* The copy is already durable and remains the serving artifact until the
* replacement transaction commits, so a decode failure never makes an
* imported asset blank.
*/
export function enqueueImportedThumbnailNormalizationJob(this: LibraryService, openLibrary: OpenLibrary, assetId: string, revisionId: string): number {
  const activeOrFailed = openLibrary.connection
    .prepare(
      `SELECT 1
         FROM jobs
        WHERE library_id = ?
          AND asset_id = ?
          AND revision_id = ?
          AND kind = 'generate_thumbnail'
          AND error_code = ?
          AND status IN ('queued', 'running', 'paused', 'failed')
        LIMIT 1`,
    )
    .get(
      openLibrary.summary.libraryId,
      assetId,
      revisionId,
      IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
    );
  if (activeOrFailed !== undefined) return 0;
  const now = new Date().toISOString();
  return openLibrary.connection
    .prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority,
          progress, attempt_count, error_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', -20, 0.0, 0, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      openLibrary.summary.libraryId,
      assetId,
      revisionId,
      IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      now,
      now,
    ).changes;
}

/**
* Backfill the same low-priority work for libraries imported by an older
* Keel build. This is intentionally bounded and runs only in background
* scheduling, never in the visible-window fast path.
*/
export function enqueueImportedThumbnailNormalizationJobs(this: LibraryService, openLibrary: OpenLibrary, options: { assetIds?: readonly string[]; limit?: number } = {}): number {
  const assetIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
  if (options.assetIds !== undefined && assetIds.length === 0) return 0;
  const assetClause = assetIds.length === 0
    ? ''
    : `AND a.asset_id IN (${assetIds.map(() => '?').join(',')})`;
  const limit = options.limit === undefined
    ? 256
    : Math.max(1, Math.min(500, Math.trunc(options.limit)));
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id
         FROM assets a
         JOIN revision_artifacts ra
           ON ra.revision_id = a.current_revision_id
          AND ra.kind = CASE
            WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
              OR LOWER(a.relative_file_path) LIKE '%.webm'
              OR LOWER(a.relative_file_path) LIKE '%.mov'
              OR LOWER(a.relative_file_path) LIKE '%.avi'
              OR LOWER(a.relative_file_path) LIKE '%.wmv'
              OR LOWER(a.relative_file_path) LIKE '%.mkv'
              OR LOWER(a.relative_file_path) LIKE '%.m4v'
              OR LOWER(a.relative_file_path) LIKE '%.flv'
            THEN 'video_poster'
            ELSE 'thumbnail'
          END
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND a.current_revision_id IS NOT NULL
          ${assetClause}
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL
          AND (
            ra.generator_version LIKE 'eagle-thumbnail@1%'
            OR ra.generator_version LIKE 'billfish-thumbnail@1%'
          )
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
          AND NOT EXISTS (
            SELECT 1
              FROM jobs existing
             WHERE existing.library_id = ?
               AND existing.asset_id = a.asset_id
               AND existing.revision_id = a.current_revision_id
               AND existing.kind = 'generate_thumbnail'
               AND existing.error_code = ?
               AND existing.status IN ('queued', 'running', 'paused', 'failed')
          )
        ORDER BY a.created_at DESC, a.relative_file_path
        LIMIT ?`,
    )
    .all(
      ...assetIds,
      openLibrary.summary.libraryId,
      IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      limit,
    ) as Array<{
      asset_id: string;
      current_revision_id: string;
    }>;
  if (rows.length === 0) return 0;
  let enqueued = 0;
  openLibrary.connection.transaction(() => {
    for (const row of rows) {
      enqueued += this.enqueueImportedThumbnailNormalizationJob(
        openLibrary,
        row.asset_id,
        row.current_revision_id,
      );
    }
  })();
  return enqueued;
}

/**
* Enqueue thumbnail jobs for supported assets whose current revision has no
* terminal artifact. Callers may pass the currently visible asset ids and a
* limit so opening a large library never materializes or queues the whole
* catalogue at once.
*/
export function enqueueThumbnailJobs(this: LibraryService, libraryId: string, options: {
      assetIds?: string[];
      limit?: number;
      priority?: number;
      repairFailed?: boolean;
      /** also re-open retryable failed artifacts (throttled). */
      retryFailed?: boolean;
      /** Background fill waves skip GIF/audio stale-artifact scans. */
      skipStaleRepair?: boolean;
    } = {}): number {
  const openLibrary = this.requireOpenLibrary(libraryId);
  // lenient open (0031 §1): libraries predating
  // revision_artifacts.status have no artifact state to queue against;
  // thumbnail generation degrades to off instead of failing to open.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return 0;
  }
  this.cancelQueuedHiddenSequenceMemberJobs(openLibrary);
  const artifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
  const limit = options.limit === undefined
    ? undefined
    : Math.max(0, Math.min(500, Math.trunc(options.limit)));
  if (limit === 0 || (options.assetIds && selectedIds.length === 0)) return 0;
  if (options.retryFailed) {
    // failures (transient decode errors, killed processes,
    // cancelled imports) must not permanently block regeneration. Invalidate
    // retryable failed artifacts here so the queue SQL below re-enqueues them;
    // permanent failures (missing source, unsupported format, over-limit…)
    // stay marked failed and are never retried.
    requeueRetryableFailedArtifacts(openLibrary.connection, {
      priority: options.priority ?? 0,
      ...(options.assetIds === undefined ? {} : { assetIds: selectedIds }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
  const repairComponents = options.repairFailed
    ? this.availableAutoRepairComponents(openLibrary)
    : new Set<MediaAutoRepairComponent>();
  const repairEnqueued = options.repairFailed
    ? this.enqueueFailedMediaRepairs(
      openLibrary,
      repairComponents,
      options.priority ?? 0,
    )
    : 0;
  if (options.repairFailed && repairComponents.size > 0) {
    this.diagnose(
      'media-auto-repair.enqueued',
      new Error('Automatic media repair wave evaluated.'),
      {
        libraryId,
        components: [...repairComponents],
        enqueuedCount: repairEnqueued,
      },
    );
  }
  if (repairComponents.size > 0) {
    const attempted = this.autoRepairAttemptedByLibrary.get(libraryId)
      ?? new Set<MediaAutoRepairComponent>();
    for (const component of repairComponents) attempted.add(component);
    this.autoRepairAttemptedByLibrary.set(libraryId, attempted);
  }
  // A previous RAW run could have persisted the generic OCIO failure before
  // the RAW-specific default-sRGB route existed, or a generic OIIO failure
  // while the media bundle lacked a RAW reader. Re-open only those
  // RAW-scoped failures; other decode failures remain terminal until an
  // explicit user retry.
  const legacyPathRepairEnqueued = options.retryFailed
    ? requeueLegacyOiioPathFailures(openLibrary.connection, {
      libraryPath: openLibrary.summary.libraryPath,
      assetIds: selectedIds,
      limit,
    })
    : 0;
  const legacyRawRepairEnqueued = options.retryFailed
    ? this.requeueLegacyRawColorTransformFailures(openLibrary, {
      assetIds: selectedIds,
      limit,
    })
    : 0;
  const importedNormalizationEnqueued = options.skipStaleRepair
    ? 0
    : this.enqueueImportedThumbnailNormalizationJobs(openLibrary, {
      ...(options.assetIds === undefined ? {} : { assetIds: selectedIds }),
      limit,
    });
  let enqueued = repairEnqueued + legacyPathRepairEnqueued + legacyRawRepairEnqueued + importedNormalizationEnqueued;
  // Model extensions join the queue (slice E): the offscreen
  // GPU renderer in Main produces model thumbnails, stored as the standard
  // `thumbnail` artifact. The dedupe below (terminal artifact / active job)
  // applies to models exactly like images, so no duplicate renders occur.
  // Documents (PDF first-page render in the Worker, HTML offscreen capture in
  // Main) must join too — without them the enqueue gate never
  // emits generate_thumbnail rows, so document cards stay on the generic icon
  // even though `assetSupportsThumbnail` declares them thumbnail-capable.
  const supportedExtensions = [
    ...IMAGE_EXTENSIONS.map((extension) => extension.slice(1)),
    ...VIDEO_EXTENSIONS.map((extension) => extension.slice(1)),
    ...AUDIO_EXTENSION_NAMES,
    ...MODEL_EXTENSIONS.map((extension) => extension.slice(1)),
    ...DOCUMENT_EXTENSIONS.map((extension) => extension.slice(1)),
    // font cards render a real sample line offscreen in Main.
    ...FONT_EXTENSIONS.map((extension) => extension.slice(1)),
  ];
  for (const extension of this._pluginThumbnailExtensions.get(libraryId) ?? []) {
    if (!supportedExtensions.includes(extension)) supportedExtensions.push(extension);
  }
  const videoExtensions = VIDEO_EXTENSIONS.map((extension) => extension.slice(1));
  const nowInvalidate = new Date().toISOString();
  if (options.skipStaleRepair) {
    // Background fill only inserts missing generate_thumbnail rows.
  } else {
  this.invalidateStalePrimaryArtifacts(openLibrary, selectedIds);
  // CU-D7: invalidate pre-gifstill GIF thumbs so page-0 black frames requeue.
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind = 'thumbnail'
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND generator_version NOT LIKE '%gifstill%'
          AND generator_version NOT LIKE ?
          AND generator_version NOT LIKE ?
          AND generator_version NOT LIKE ?
          AND revision_id IN (
            SELECT current_revision_id FROM assets
             WHERE deleted_at IS NULL
               AND current_revision_id IS NOT NULL
               AND LOWER(relative_file_path) LIKE '%.gif'
          )`,
    )
    .run(
      nowInvalidate,
      'eagle-thumbnail@1%',
      'billfish-thumbnail@1%',
      `${IMPORTED_THUMBNAIL_GENERATOR_PREFIX}%`,
    );
  // ICO cards created before largest-page selection used
  // the first directory entry (often a 16px icon). Invalidate those rows so
  // the next queue wave regenerates them from the largest ICO page.
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind = 'thumbnail'
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND generator_version NOT LIKE '%ico-largest-v1%'
          AND revision_id IN (
            SELECT current_revision_id FROM assets
             WHERE deleted_at IS NULL
               AND current_revision_id IS NOT NULL
               AND LOWER(relative_file_path) LIKE '%.ico'
          )`,
    )
    .run(nowInvalidate);
  // vlx: requeue stale audio covers + missing/stale viewer strips.
  const audioExtensionSql = AUDIO_EXTENSION_NAMES
    .map(() => 'LOWER(a.relative_file_path) LIKE ?')
    .join(' OR ');
  const audioExtensionParams = AUDIO_EXTENSION_NAMES.map(
    (extension) => `%.${extension}`,
  );
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind IN ('thumbnail', 'video_poster')
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND generator_version NOT LIKE ?
          AND revision_id IN (
            SELECT a.current_revision_id FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.current_revision_id IS NOT NULL
               AND (${audioExtensionSql})
          )`,
    )
    .run(
      nowInvalidate,
      `%${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}%`,
      ...audioExtensionParams,
    );
  // Thumbnail ready but no viewer strip yet → invalidate thumb so both regenerate.
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind = 'thumbnail'
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND revision_id IN (
            SELECT a.current_revision_id FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.current_revision_id IS NOT NULL
               AND (${audioExtensionSql})
               AND NOT EXISTS (
                 SELECT 1 FROM revision_artifacts poster
                  WHERE poster.revision_id = a.current_revision_id
                    AND poster.kind = 'video_poster'
                    AND poster.status = 'ready'
                    AND poster.invalidated_at IS NULL
               )
          )`,
    )
    .run(nowInvalidate, ...audioExtensionParams);
  // viewer strip ready but no 4:3 grid cover → requeue.
  // Do not serve video_poster in the browse grid (wide aspect).
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind = 'video_poster'
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND revision_id IN (
            SELECT a.current_revision_id FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.current_revision_id IS NOT NULL
               AND (${audioExtensionSql})
               AND NOT EXISTS (
                 SELECT 1 FROM revision_artifacts thumb
                  WHERE thumb.revision_id = a.current_revision_id
                    AND thumb.kind = 'thumbnail'
                    AND thumb.status = 'ready'
                    AND thumb.invalidated_at IS NULL
               )
          )`,
    )
    .run(nowInvalidate, ...audioExtensionParams);
  // CU-D8: GIFs with a ready thumb but no duration/frame metadata requeue once.
  openLibrary.connection
    .prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE kind = 'thumbnail'
          AND status = 'ready'
          AND invalidated_at IS NULL
          AND revision_id IN (
            SELECT a.current_revision_id
              FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.current_revision_id IS NOT NULL
               AND LOWER(a.relative_file_path) LIKE '%.gif'
               AND NOT EXISTS (
                 SELECT 1 FROM revision_artifacts meta
                  WHERE meta.revision_id = a.current_revision_id
                    AND meta.kind = 'extracted_metadata'
                    AND meta.status = 'ready'
                    AND meta.invalidated_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM revision_artifacts preserved
                  WHERE preserved.revision_id = a.current_revision_id
                    AND preserved.kind = 'thumbnail'
                    AND preserved.status = 'ready'
                    AND preserved.invalidated_at IS NULL
                    AND (
                      preserved.generator_version LIKE 'eagle-thumbnail@1%'
                      OR preserved.generator_version LIKE 'billfish-thumbnail@1%'
                      OR preserved.generator_version LIKE '${IMPORTED_THUMBNAIL_GENERATOR_PREFIX}%'
                    )
               )
          )`,
    )
    .run(nowInvalidate);
  }
  // scenes scheduling with explicit ids (notably the visible
  // browse wave) also BOOST already-queued preview jobs of those assets —
  // the enqueue SQL below skips assets with an active job, so without this
  // the current view would stay behind a mutation flood that queued first.
  // Only raises priority (never lowers); dead/terminal jobs are untouched.
  if (selectedIds.length > 0 && options.priority !== undefined) {
    openLibrary.connection
      .prepare(
        `UPDATE jobs
            SET priority = MAX(priority, ?), updated_at = ?
          WHERE library_id = ?
            AND asset_id IN (${selectedIds.map(() => '?').join(',')})
            AND kind IN ('generate_thumbnail', 'generate_video_poster')
            AND status = 'queued'`,
      )
      .run(options.priority, new Date().toISOString(), libraryId, ...selectedIds);
  }
  const selectedSql = selectedIds.length > 0
    ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
    : '';
  // 真实 NAS 生产库事故第二轮归因，2026-08-23：offline
  // linked 文件夹的源不可达，其资产的缩略图任务必然以 SOURCE_NOT_FOUND
  // 失败——在 SMB 上每个失败还是一次 journal 写事务。7,164 个这样的任务
  // 就是持续数分钟的 Worker 风暴（实测把 startup 突发拖过 15s 超时）。
  // 入队阶段直接跳过；根恢复（offline→available）后下一个场景自动补上。
  const notOfflineLinkedFolderSql = `
          AND NOT EXISTS (
            SELECT 1 FROM linked_folders loff
             WHERE loff.folder_id = a.linked_folder_id
               AND loff.status = 'offline'
          )`;
  const hiddenSequenceMemberSql = hasTable(openLibrary.connection, 'asset_sequence_frames')
    ? `
          AND NOT EXISTS (
            SELECT 1
              FROM asset_sequence_frames hidden_sequence_frame
             WHERE hidden_sequence_frame.asset_id = a.asset_id
               AND hidden_sequence_frame.position > 0
          )`
    : '';
  const extensionSql = supportedExtensions
    .map(() => 'LOWER(a.relative_file_path) LIKE ?')
    .join(' OR ');
  const sourceDimensionColumns = artifactColumns.has('width') && artifactColumns.has('height')
    ? `,
       (SELECT source_metadata.width
          FROM revision_artifacts source_metadata
         WHERE source_metadata.revision_id = a.current_revision_id
           AND source_metadata.kind = 'extracted_metadata'
           AND source_metadata.status = 'ready'
           AND source_metadata.invalidated_at IS NULL
         ORDER BY source_metadata.generated_at DESC
         LIMIT 1) AS source_width,
       (SELECT source_metadata.height
          FROM revision_artifacts source_metadata
         WHERE source_metadata.revision_id = a.current_revision_id
           AND source_metadata.kind = 'extracted_metadata'
           AND source_metadata.status = 'ready'
           AND source_metadata.invalidated_at IS NULL
         ORDER BY source_metadata.generated_at DESC
         LIMIT 1) AS source_height`
    : ', NULL AS source_width, NULL AS source_height';
  const sourceDirectExtensionSql = SOURCE_DIRECT_IMAGE_EXTENSIONS
    .map(() => 'LOWER(a.relative_file_path) LIKE ?')
    .join(' OR ');
  const sourceDirectCandidateSql = artifactColumns.has('width') && artifactColumns.has('height')
    ? `
          AND NOT (
            (${sourceDirectExtensionSql})
            AND source_revision.byte_size BETWEEN 1 AND ${SOURCE_DIRECT_MAX_BYTES}
            AND EXISTS (
              SELECT 1 FROM revision_artifacts source_metadata
               WHERE source_metadata.revision_id = a.current_revision_id
                 AND source_metadata.kind = 'extracted_metadata'
                 AND source_metadata.status = 'ready'
                 AND source_metadata.invalidated_at IS NULL
                 AND source_metadata.width > 0
                 AND source_metadata.height > 0
                 AND source_metadata.width <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                 AND source_metadata.height <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                 AND source_metadata.width * source_metadata.height <= ${SOURCE_DIRECT_MAX_PIXELS}
               ORDER BY source_metadata.generated_at DESC
               LIMIT 1
            )
          )`
    : '';
  const queryLimit = limit === undefined ? '' : 'LIMIT ?';
  // background fill (no assetIds) drains most-recently
  // imported assets first (created_at DESC, path as a deterministic
  // tiebreaker) instead of pure path-alphabetical order — the assets the
  // user just imported surface their thumbnails first, which is what a
  // fresh large import actually wants to see.
  // explicit-id waves (visible/mutation/linked)
  // must keep the CALLER's order — the browse list order is what the user
  // sees top-to-bottom, so re-sorting by created_at DESC made the bottom
  // of the viewport finish before the top. The SQL IN result is re-ordered
  // in JS by the caller's id sequence before the insert loop.
  const rows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id, a.relative_file_path,
              source_revision.byte_size AS source_byte_size
              ${sourceDimensionColumns}
         FROM assets a
         JOIN revisions source_revision ON source_revision.revision_id = a.current_revision_id
        WHERE a.deleted_at IS NULL
          AND a.current_revision_id IS NOT NULL
          AND a.availability = 'available'
          ${selectedSql}
          ${notOfflineLinkedFolderSql}
          ${hiddenSequenceMemberSql}
          AND (${extensionSql})
          ${sourceDirectCandidateSql}
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts ra
            WHERE ra.revision_id = a.current_revision_id
              AND ra.kind IN ('thumbnail', 'video_poster')
              AND ra.status IN ('ready', 'failed')
              AND ra.invalidated_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.asset_id = a.asset_id
              AND j.kind = 'generate_thumbnail'
              AND j.status IN ('queued', 'running', 'paused')
          )
          AND NOT EXISTS (
            SELECT 1 FROM explicit_ignored_paths ip
             WHERE ip.location_kind = a.location_kind
               AND ip.linked_folder_id = COALESCE(a.linked_folder_id, '')
               AND (
                 (ip.path_kind = 'folder'
                   AND (ip.relative_path = ''
                        OR a.relative_file_path = ip.relative_path
                        OR LOWER(a.relative_file_path) LIKE LOWER(ip.relative_path) || '/%'))
                 OR (ip.path_kind = 'asset'
                     AND ip.relative_path = a.relative_file_path)
                 OR (ip.path_kind = 'extension'
                     AND LOWER(a.relative_file_path) LIKE '%.' || LOWER(ip.relative_path))
               )
          )
          AND NOT EXISTS (
            SELECT 1 FROM gitignore_ignored_paths gi
             WHERE a.location_kind = 'managed'
               AND gi.path_kind = 'asset'
               AND gi.relative_path = a.relative_file_path
          )
        ORDER BY a.created_at DESC, a.relative_file_path
        ${queryLimit}`,
    )
    .all(
      ...selectedIds,
      ...supportedExtensions.map((extension) => `%.${extension}`),
      ...(artifactColumns.has('width') && artifactColumns.has('height')
        ? SOURCE_DIRECT_IMAGE_EXTENSIONS.map((extension) => `%${extension}`)
        : []),
      ...(limit === undefined ? [] : [limit]),
    ) as Array<{
      asset_id: string;
      current_revision_id: string;
      relative_file_path: string;
      source_byte_size: number;
      source_width: number | null;
      source_height: number | null;
    }>;
  if (selectedIds.length > 0) {
    // keep the caller's id order for explicit
    // waves so the user's top-of-viewport assets enqueue first.
    const order = new Map(selectedIds.map((id, index) => [id, index]));
    rows.sort(
      (left, right) =>
        (order.get(left.asset_id) ?? 0) - (order.get(right.asset_id) ?? 0),
    );
  }

  const now = new Date().toISOString();
  // ignored assets never enter the thumbnail queue.
  const schedulableIds = new Set(this.filterIgnoredAssetIds(
    libraryId,
    rows.map((row) => row.asset_id),
  ));
  const insert = openLibrary.connection.prepare(
    `INSERT OR IGNORE INTO jobs
       (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
        attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', ?, 0.0, 0, ?, ?)`,
  );

  for (const row of rows) {
    if (!schedulableIds.has(row.asset_id)) continue;
    const detectedMediaType = LibraryService.detectMediaType(row.relative_file_path);
    const mediaType = detectedMediaType === 'other'
      && this.claimsPluginThumbnail(libraryId, row.relative_file_path)
      ? 'image'
      : detectedMediaType;
    const sourceDirect = isSourceDirectPreview({
      fileName: row.relative_file_path,
      mediaType: LibraryService.toSummaryMediaType(mediaType),
      byteSize: row.source_byte_size,
      width: row.source_width,
      height: row.source_height,
    });
    const admission = admitArtifactJob({
      assetId: row.asset_id,
      revisionId: row.current_revision_id,
      currentRevisionId: row.current_revision_id,
      mediaType,
      jobKind: 'generate_thumbnail',
      availability: 'available',
      ignored: false,
      sourceDirect,
      retryFailed: options.retryFailed,
    });
    if (!admission.admitted) continue;
    const inserted = insert.run(
      randomUUID(), libraryId, row.asset_id, row.current_revision_id,
      options.priority ?? 0, now, now,
    );
    enqueued += inserted.changes;
  }

  if (options.skipStaleRepair) {
    // Light visible-window waves are only allowed to claim the primary
    // preview lane. Metadata, palette, proxy, and contact-sheet work is
    // secondary and must not make a scrollbar jump wait behind extra SQL
    // scans or newly queued derivatives.
    // Source-direct images do not create a primary thumbnail job, so queue
    // their bounded palette work here instead of waiting for the absent
    // thumbnail-completed event to fan it out.
    this.enqueueReadyPaletteJobs(openLibrary, {
      ...(options.assetIds === undefined ? {} : { assetIds: selectedIds }),
      ...(limit === undefined ? {} : { limit }),
      priority: options.priority ?? -10,
    });
    return enqueued;
  }

  // Video AI consumes the timestamped contact sheet, not the browsing
  // poster. Probe metadata is therefore its own durable, higher-priority
  // job (the contact sheet itself is generated lazily at
  // analysis time) while poster and WebM work continue independently.
  const videoMetadataRows = openLibrary.connection
    .prepare(
      `SELECT a.asset_id, a.current_revision_id
         FROM assets a
        WHERE a.deleted_at IS NULL
          AND a.current_revision_id IS NOT NULL
          AND a.availability = 'available'
          ${selectedSql}
          ${notOfflineLinkedFolderSql}
          AND (${videoExtensions.map(() => 'LOWER(a.relative_file_path) LIKE ?').join(' OR ')})
          AND ${this.explicitIgnoreSql(openLibrary.connection, 'a')}
        ORDER BY a.created_at DESC, a.relative_file_path
        ${queryLimit}`,
    )
    .all(
      ...selectedIds,
      ...videoExtensions.map((extension) => `%.${extension}`),
      ...(limit === undefined ? [] : [limit]),
    ) as Array<{ asset_id: string; current_revision_id: string }>;
  if (selectedIds.length > 0) {
    const order = new Map(selectedIds.map((id, index) => [id, index]));
    videoMetadataRows.sort(
      (left, right) =>
        (order.get(left.asset_id) ?? 0) - (order.get(right.asset_id) ?? 0),
    );
  }
  for (const row of videoMetadataRows) {
    this.enqueueVideoMetadataJob(
      openLibrary,
      row.asset_id,
      row.current_revision_id,
      (options.priority ?? 0) + 50,
    );
  }

  // RAW card generation is deliberately independent from the EXIF/IPTC/XMP
  // parser. Keep the metadata admission bounded and lower priority so the
  // embedded-JPEG/OIIO card path is the first useful result after open.
  // Do not fold these secondary admissions into the thumbnail enqueue
  // count — callers and tests treat that number as generate_thumbnail rows.
  this.enqueueRawImageMetadataJobs(openLibrary, {
    ...(options.assetIds === undefined ? {} : { assetIds: selectedIds }),
    ...(limit === undefined ? {} : { limit }),
  });
  // JPEG/PNG/TIFF/WebP/AVIF metadata uses the same bounded exifr projection
  // as RAW files, but is admitted separately so the historical RAW backfill
  // cursor and retry policy remain compatible with existing libraries.
  this.enqueueRawImageMetadataJobs(openLibrary, {
    ...(options.assetIds === undefined ? {} : { assetIds: selectedIds }),
    ...(limit === undefined ? {} : { limit }),
    extensions: 'embedded',
  });

  // Native audio is source-first just like native video. Its waveform cover
  // and viewer strip are still generated above, but an Ogg playback proxy is
  // not useful until the browser actually reports a source decode failure.
  // The viewer requests `audio_proxy` explicitly on that failure path.

  // AI contact sheets are no longer proactively scheduled.
  // Their only consumer is on-demand AI video analysis, which now generates
  // the sheet lazily (ensureVideoContactSheet). Proactively generating them
  // flooded converted libraries with doomed FFmpeg batches on every open.

  // Existing ready thumbnails/posters (for example after reopening a library
  // created by an older build) receive their missing local palettes too.
  this.enqueueReadyPaletteJobs(openLibrary, options);

  return enqueued;
}

/** Requeue RAW failures caused by an old transform route or missing reader. */
export function requeueLegacyRawColorTransformFailures(this: LibraryService, openLibrary: OpenLibrary, options: { assetIds: string[]; limit?: number }): number {
  const selectedIds = options.assetIds;
  const selectedSql = selectedIds.length > 0
    ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
    : '';
  const extensionMatch = rawImageExtensionMatchSql(openLibrary.connection, 'a');
  const limitSql = options.limit === undefined ? '' : 'LIMIT ?';
  const rows = openLibrary.connection
    .prepare(
      `SELECT ra.artifact_id, a.relative_file_path
         FROM revision_artifacts ra
         JOIN assets a ON a.current_revision_id = ra.revision_id
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND ra.kind = 'thumbnail'
          AND ra.status = 'failed'
          AND ra.invalidated_at IS NULL
          AND COALESCE(ra.generator_version, '') NOT LIKE '%${OIIO_LITERAL_PATHS_MARK}%'
          AND (
            (
              ra.error_code = 'OIIO_COLOR_TRANSFORM_FAILED'
              AND COALESCE(ra.generator_version, '') NOT LIKE '%raw-default-srgb%'
            )
            OR ra.error_code = 'OIIO_GENERATION_FAILED'
          )
          ${selectedSql}
          AND ${extensionMatch.sql}
          AND NOT EXISTS (
            SELECT 1
              FROM jobs active
             WHERE active.asset_id = a.asset_id
               AND active.revision_id = a.current_revision_id
               AND active.kind = 'generate_thumbnail'
               AND active.status IN ('queued', 'running', 'paused')
          )
        ORDER BY a.relative_file_path
        ${limitSql}`,
    )
    .all(
      ...selectedIds,
      ...extensionMatch.params,
      ...(options.limit === undefined ? [] : [options.limit]),
    ) as Array<{ artifact_id: string; relative_file_path: string }>;
  const rawRows = rows.filter((row) => isRawImageExtension(row.relative_file_path));
  if (rawRows.length === 0) return 0;

  const now = new Date().toISOString();
  const invalidate = openLibrary.connection.prepare(
    `UPDATE revision_artifacts
        SET invalidated_at = ?
      WHERE artifact_id = ?
        AND status = 'failed'
        AND invalidated_at IS NULL`,
  );
  let repaired = 0;
  openLibrary.connection.transaction(() => {
    for (const row of rawRows) {
      repaired += invalidate.run(now, row.artifact_id).changes;
    }
  })();
  return repaired;
}

/**
* Process a bounded wave of media jobs. Returns the number of jobs processed
* (success + failure + an in-flight pause/cancel).
*/
export async function processThumbnailQueue(this: LibraryService, libraryId: string, options: {
      maxJobs?: number;
      /** Restrict a pump to one media lane; omitted preserves full-queue behavior. */
      jobKinds?: readonly MediaJobKind[];
      /** Current viewport image cards may use the bounded interactive lane. */
      interactive?: boolean;
      /**
       * Mutable claim scope updated by the Worker when a newer visible window
       * arrives while this queue is awaiting native media work. Undefined
       * keeps the original queue-wide scope; an array limits future claims.
       */
      claimAssetIdsRef?: { current: readonly string[] | undefined };
      /**
       * Restrict a visible-window pump to the latest viewport asset ids.
       * Background pumps omit this so overlay `IN (...)` can fall back to the
       * persistent queue once those ids have no queued work.
       */
      assetIds?: readonly string[];
      /** 收编：Stop claiming more jobs when a newer queue scene supersedes this pump. */
      signal?: AbortSignal;
      onResult?: (result: {
        assetId: string;
        artifactId?: string;
        errorCode?: string;
        width?: number;
        height?: number;
        durationMs?: number;
        revisionId?: string;
        previewKind?: 'source' | null;
        previewRevisionId?: string | null;
      }) => void;
      /** Fired once a durable visual input is ready for automatic AI. */
      onAiInputReady?: (event: { assetId: string; artifactId: string }) => void;
      /** Notify the renderer when a secondary artifact changes Inspector data. */
      onDerivedReady?: (event: {
        assetId: string;
        kind: SecondaryMediaJobKind;
        width?: number;
        height?: number;
        durationMs?: number;
        revisionId?: string;
        previewKind?: 'source' | null;
        previewRevisionId?: string | null;
      }) => void;
      pluginMediaProvider?: (input: {
        assetId: string;
        signal: AbortSignal;
        asset?: {
          assetId: string;
          displayName: string;
          relativeFilePath: string;
          currentRevisionId: string;
        };
      }) => Promise<string | null>;
      /** Slice E: offscreen renderer for model assets (null keeps the legacy no-op). */
      modelThumbnailRenderer?: ModelThumbnailRenderer;
      /** renders the AI four-view sheet via the offscreen page. */
      modelAiViewsRenderer?: (
        input: ModelThumbnailRendererInput,
      ) => Promise<ModelThumbnailRenderOutcome>;
    } = {}): Promise<number> {
  if (options.modelAiViewsRenderer) {
    this.modelAiViewsRenderer = options.modelAiViewsRenderer;
  }
  const openLibrary = this.requireOpenLibrary(libraryId);
  this.cancelQueuedHiddenSequenceMemberJobs(openLibrary);
  this.repairUndisplayablePngThumbnails(openLibrary);
  const jobKinds = options.jobKinds ?? MEDIA_JOB_KINDS;
  if (jobKinds.length === 0) return 0;
  if (options.signal?.aborted) return 0;
  const processArtifactColumns = columnsFor(openLibrary.connection, 'revision_artifacts');
  const claimSourceDimensionColumns = processArtifactColumns.has('width') && processArtifactColumns.has('height')
    ? `,
           (SELECT source_metadata.width
              FROM revision_artifacts source_metadata
             WHERE source_metadata.revision_id = a.current_revision_id
               AND source_metadata.kind = 'extracted_metadata'
               AND source_metadata.status = 'ready'
               AND source_metadata.invalidated_at IS NULL
             ORDER BY source_metadata.generated_at DESC
             LIMIT 1) AS source_width,
           (SELECT source_metadata.height
              FROM revision_artifacts source_metadata
             WHERE source_metadata.revision_id = a.current_revision_id
               AND source_metadata.kind = 'extracted_metadata'
               AND source_metadata.status = 'ready'
               AND source_metadata.invalidated_at IS NULL
             ORDER BY source_metadata.generated_at DESC
             LIMIT 1) AS source_height`
    : ', NULL AS source_width, NULL AS source_height';
  const pumpAssetIds = options.assetIds === undefined
    ? undefined
    : [...new Set(options.assetIds)].slice(0, 100);
  const buildAssetClause = (assetIds: readonly string[] | undefined): string => assetIds === undefined
    ? ''
    : assetIds.length === 0
      ? 'AND 1 = 0'
      : `AND asset_id IN (${assetIds.map(() => '?').join(',')})`;
  const assetClause = buildAssetClause(pumpAssetIds);
  // Primary previews must not be held behind a secondary FFmpeg derivative
  // for the same revision. This matters even with a single FFmpeg decoder
  // slot: a proxy claimed first can hold that slot while the poster waits
  // forever for a user-visible result (the proxy may be waiting on an
  // encoder or a slow source). Metadata jobs are intentionally excluded:
  // either they or poster jobs may start a revision-scoped full ffprobe and
  // share the result without waiting for the other durable job. The
  // claim-time guard also covers the second queue
  // worker, which could otherwise see the primary as `running` and still
  // claim the secondary job concurrently. A proxy-only pump keeps its
  // explicit playback request independent of this browse-lane preference.
  const primaryPreviewKinds = new Set<MediaJobKind>([
    'generate_thumbnail',
    'generate_video_poster',
  ]);
  const secondaryFfmpegKinds = [
    'generate_contact_sheet',
    'generate_webm_proxy',
    'generate_audio_proxy',
  ] as const;
  const pendingSecondaryFfmpegJob = openLibrary.connection.prepare(
    `SELECT 1
       FROM jobs
      WHERE library_id = ?
        AND asset_id = ?
        AND revision_id = ?
        AND kind IN (${secondaryFfmpegKinds.map(() => '?').join(',')})
        AND status IN ('queued', 'running', 'paused')
      LIMIT 1`,
  );
  // A primary preview completing during this bounded wave must not
  // immediately unlock a proxy/contact-sheet job and consume the same
  // wave's remaining budget. Besides preserving the wave contract, this
  // keeps a newly visible page from turning one primary result into a
  // secondary FFmpeg chain before the next scheduling boundary. Jobs that
  // were already succeeded before this wave remain eligible; only a primary
  // row whose terminal update happened after the wave began is deferred.
  const waveStartedAtIso = new Date().toISOString();
  const deferSecondaryAfterPrimarySql = options.maxJobs !== undefined
    && jobKinds.some((kind) => primaryPreviewKinds.has(kind))
    ? `
        AND NOT (
          jobs.kind IN (${secondaryFfmpegKinds.map((kind) => `'${kind}'`).join(', ')})
          AND EXISTS (
            SELECT 1
              FROM jobs completed_primary
             WHERE completed_primary.library_id = jobs.library_id
               AND completed_primary.asset_id = jobs.asset_id
               AND completed_primary.revision_id = jobs.revision_id
               AND completed_primary.kind IN ('generate_thumbnail', 'generate_video_poster')
               AND completed_primary.status = 'succeeded'
               AND completed_primary.updated_at >= ?
          )
        )`
    : '';
  const primaryPreviewClaimGuard = jobKinds.some((kind) => primaryPreviewKinds.has(kind))
    ? `
        AND (
          jobs.kind IN ('generate_thumbnail', 'generate_video_poster')
          OR jobs.kind NOT IN (${secondaryFfmpegKinds.map((kind) => `'${kind}'`).join(', ')})
          OR NOT EXISTS (
            SELECT 1
              FROM jobs primary_job
             WHERE primary_job.library_id = jobs.library_id
               AND primary_job.asset_id = jobs.asset_id
               AND primary_job.revision_id = jobs.revision_id
               AND primary_job.kind IN ('generate_thumbnail', 'generate_video_poster')
               AND primary_job.status IN ('queued', 'running', 'paused')
          )
        )`
    : '';

  // Existing libraries can contain durable thumbnail rows created before
  // the source-direct admission policy was introduced. Claim-time guards
  // keep those rows safe. An explicit visible/reconciliation asset scope
  // can additionally prune its queued rows before native work starts; a
  // queue-wide pre-scan is deliberately avoided because LIMIT would not
  // bound the JOIN work over a large history.
  if (jobKinds.some((kind) => primaryPreviewKinds.has(kind))) {
    const now = new Date().toISOString();
    const sourceDirectExtensionSql = SOURCE_DIRECT_IMAGE_EXTENSIONS
      .map((extension) => `LOWER(source_asset.relative_file_path) LIKE '%${extension}'`)
      .join(' OR ');
    if (
      pumpAssetIds !== undefined
      && processArtifactColumns.has('width')
      && processArtifactColumns.has('height')
    ) {
      const sourceDirectRows = pumpAssetIds.length === 0
        ? []
        : openLibrary.connection
        .prepare(
          `SELECT jobs.asset_id, jobs.revision_id, source_metadata.width, source_metadata.height
             FROM jobs
             JOIN assets source_asset
               ON source_asset.asset_id = jobs.asset_id
              AND source_asset.current_revision_id = jobs.revision_id
             JOIN revisions source_revision
               ON source_revision.revision_id = jobs.revision_id
             JOIN revision_artifacts source_metadata
               ON source_metadata.revision_id = jobs.revision_id
              AND source_metadata.kind = 'extracted_metadata'
              AND source_metadata.status = 'ready'
              AND source_metadata.invalidated_at IS NULL
              AND source_metadata.width > 0
              AND source_metadata.height > 0
              AND source_metadata.width <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
              AND source_metadata.height <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
              AND source_metadata.width * source_metadata.height <= ${SOURCE_DIRECT_MAX_PIXELS}
            WHERE jobs.library_id = ?
              AND jobs.status = 'queued'
              AND jobs.kind = 'generate_thumbnail'
              AND COALESCE(jobs.error_code, '') <> '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
              AND jobs.asset_id IN (${pumpAssetIds.map(() => '?').join(',')})
              AND source_asset.deleted_at IS NULL
              AND source_asset.availability = 'available'
              AND source_revision.byte_size BETWEEN 1 AND ${SOURCE_DIRECT_MAX_BYTES}
              AND (${sourceDirectExtensionSql})`,
        )
        .all(libraryId, ...pumpAssetIds) as Array<{
          asset_id: string;
          revision_id: string;
          width: number;
          height: number;
        }>;
      openLibrary.connection
        .prepare(
          `UPDATE jobs
              SET status = 'cancelled', error_code = 'SOURCE_DIRECT', updated_at = ?
            WHERE library_id = ?
              AND status = 'queued'
              AND kind = 'generate_thumbnail'
              AND COALESCE(error_code, '') <> '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
              ${assetClause}
              AND EXISTS (
                SELECT 1
                  FROM assets source_asset
                  JOIN revisions source_revision
                    ON source_revision.revision_id = source_asset.current_revision_id
                 WHERE source_asset.asset_id = jobs.asset_id
                   AND source_asset.current_revision_id = jobs.revision_id
                   AND source_asset.deleted_at IS NULL
                   AND source_asset.availability = 'available'
                   AND source_revision.byte_size > 0
                   AND source_revision.byte_size <= ${SOURCE_DIRECT_MAX_BYTES}
                   AND (${sourceDirectExtensionSql})
                   AND EXISTS (
                     SELECT 1
                       FROM revision_artifacts source_metadata
                      WHERE source_metadata.revision_id = jobs.revision_id
                        AND source_metadata.kind = 'extracted_metadata'
                        AND source_metadata.status = 'ready'
                        AND source_metadata.invalidated_at IS NULL
                        AND source_metadata.width > 0
                        AND source_metadata.height > 0
                        AND source_metadata.width <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                        AND source_metadata.height <= ${SOURCE_DIRECT_MAX_LONG_EDGE_PX}
                        AND source_metadata.width * source_metadata.height <= ${SOURCE_DIRECT_MAX_PIXELS}
                   )
              )`,
        )
        .run(now, libraryId, ...(pumpAssetIds ?? []));
      for (const row of sourceDirectRows) {
        options.onResult?.({
          assetId: row.asset_id,
          errorCode: 'SOURCE_DIRECT',
          width: row.width,
          height: row.height,
          revisionId: row.revision_id,
          previewKind: 'source',
          previewRevisionId: row.revision_id,
        });
      }
    }
    // Use the same media-aware policy as claim-time admission for both
    // thumbnail and video-poster jobs. `generate_thumbnail` produces
    // `video_poster` for videos; ready rows also need the current revision,
    // a live artifact row, and a generator family that is still current.
    // Imported normalization jobs, failed rows, and running jobs are left
    // to their existing paths.
    const readyArtifactJobKinds: ArtifactJobKind[] = [
      ...(jobKinds.includes('generate_thumbnail') ? ['generate_thumbnail' as const] : []),
      ...(jobKinds.includes('generate_video_poster') ? ['generate_video_poster' as const] : []),
    ];
    if (readyArtifactJobKinds.length > 0 && pumpAssetIds !== undefined) {
      // Claim pruning is intentionally limited to an explicit asset scope.
      // A queue-wide JOIN over a large history would still scan/sort that
      // history before LIMIT can help. The normal unscoped claim below is
      // already bounded by maxJobs and re-checks the same artifact policy
      // before decoder admission, so it converges ready rows one at a time
      // without a repeated queue-wide prune scan.
      const readyArtifactCandidateLimit = Math.max(
        1,
        Math.min(100, Math.trunc(options.maxJobs ?? workerMediaDecodeWaveSize())),
      );
      const readyArtifactJobs = openLibrary.connection
        .prepare(
          `SELECT jobs.job_id, jobs.kind AS job_kind,
                  ready_asset.relative_file_path, ready_artifact.kind AS artifact_kind,
                  ready_artifact.generator_version,
                  jobs.priority, jobs.created_at
             FROM jobs INDEXED BY jobs_asset_kind_status
             JOIN assets ready_asset
               ON ready_asset.asset_id = jobs.asset_id
              AND ready_asset.current_revision_id = jobs.revision_id
             JOIN revision_artifacts ready_artifact
               ON ready_artifact.revision_id = jobs.revision_id
              AND ready_artifact.kind IN ('thumbnail', 'video_poster')
              AND ready_artifact.status = 'ready'
              AND ready_artifact.invalidated_at IS NULL
            WHERE jobs.library_id = ?
              AND jobs.status = 'queued'
              AND jobs.kind IN (${readyArtifactJobKinds.map(() => '?').join(',')})
              AND COALESCE(jobs.error_code, '') <> '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
              ${pumpAssetIds === undefined
                ? ''
                : pumpAssetIds.length === 0
                  ? 'AND 1 = 0'
                  : `AND jobs.asset_id IN (${pumpAssetIds.map(() => '?').join(',')})`}
            ORDER BY jobs.priority DESC, jobs.created_at, jobs.job_id
            LIMIT ?`,
        )
        .all(
          libraryId,
          ...readyArtifactJobKinds,
          ...(pumpAssetIds ?? []),
          readyArtifactCandidateLimit,
        ) as Array<{
          job_id: string;
          job_kind: string;
          relative_file_path: string;
          artifact_kind: string;
          generator_version: string;
          priority: number;
          created_at: string;
        }>;
      const readyCurrentJobIds = [...new Set(
        readyArtifactJobs
          .filter((row) => {
            const mediaType = LibraryService.detectMediaType(row.relative_file_path);
            const artifactKind = artifactKindForJob(
              row.job_kind as ArtifactJobKind,
              mediaType,
            );
            return artifactKind === row.artifact_kind
              && (row.artifact_kind === 'thumbnail' || row.artifact_kind === 'video_poster')
              && this.primaryArtifactGeneratorIsCurrent(
                row.relative_file_path,
                row.artifact_kind,
                row.generator_version,
              );
          })
          .map((row) => row.job_id),
      )];
      if (readyCurrentJobIds.length > 0) {
        openLibrary.connection.transaction(() => {
          for (let offset = 0; offset < readyCurrentJobIds.length; offset += 500) {
            const batch = readyCurrentJobIds.slice(offset, offset + 500);
            openLibrary.connection
              .prepare(
                `UPDATE jobs
                    SET status = 'cancelled', error_code = 'ARTIFACT_READY', updated_at = ?
                  WHERE library_id = ?
                    AND status = 'queued'
                    AND job_id IN (${batch.map(() => '?').join(',')})`,
              )
              .run(now, libraryId, ...batch);
          }
        })();
      }
    }
  }
  // The visible wave is a latency budget, not a general FIFO pump. Video
  // posters share the primary job kind with images, but their FFmpeg path
  // is deliberately single-flight and can take materially longer. If a
  // video happens to be older than an image in the same viewport, claiming
  // it first consumes one of the interactive workers without improving the
  // image-card gate. Keep image jobs ahead of other primary media only for
  // the visible wave; background/import ordering remains unchanged.
  const interactiveImageFirstOrder = options.interactive
    ? `CASE WHEN jobs.kind = 'generate_thumbnail' AND EXISTS (
           SELECT 1
             FROM assets visible_asset
            WHERE visible_asset.asset_id = jobs.asset_id
              AND (${IMAGE_EXTENSIONS
                .map((extension) => `LOWER(visible_asset.relative_file_path) LIKE '%${extension}'`)
                .join(' OR ')})
         ) THEN 1 ELSE 0 END DESC, `
    : '';
  // Imported previews are already ready copies. Their low-priority
  // normalization must never consume a visible-wave slot just because the
  // visible asset has no missing primary job; leave it to the background
  // queue after the interaction window yields.
  const interactiveImportedNormalizationGuard = options.interactive
    ? `AND NOT (
        jobs.kind = 'generate_thumbnail'
        AND COALESCE(jobs.error_code, '') = '${IMPORTED_THUMBNAIL_NORMALIZATION_JOB}'
      )`
    : '';
  const hiddenSequenceClaimGuard = hasTable(openLibrary.connection, 'asset_sequence_frames')
    ? `AND NOT EXISTS (
          SELECT 1
            FROM asset_sequence_frames hidden_sequence_frame
           WHERE hidden_sequence_frame.asset_id = jobs.asset_id
             AND hidden_sequence_frame.position > 0
        )`
    : '';
  const nextJobQuery = (claimAssetIds: readonly string[] | undefined) => {
    const rankOrder = viewportClaimRankOrderSql(claimAssetIds);
    return openLibrary.connection.prepare(
    `SELECT job_id, asset_id, revision_id, kind, priority, attempt_count, error_code
       FROM jobs
      WHERE library_id = ?
        AND kind IN (${jobKinds.map(() => '?').join(',')})
        AND status = 'queued'
        ${buildAssetClause(claimAssetIds)}
        ${primaryPreviewClaimGuard}
        ${interactiveImportedNormalizationGuard}
        ${hiddenSequenceClaimGuard}
        ${deferSecondaryAfterPrimarySql}
        AND (
          error_code IS NULL
          OR error_code NOT IN ('JOB_LEASE_LOST', '${MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE}')
          OR updated_at <= ?
        )
      ORDER BY ${interactiveImageFirstOrder}${rankOrder.sql}priority DESC, created_at
      LIMIT 1`,
  );
  };
  const normalizedClaimAssetIds = (assetIds: readonly string[] | undefined): string[] | undefined =>
    assetIds === undefined ? undefined : uniqueAssetIdsInOrder(assetIds, VIEWPORT_CLAIM_ID_LIMIT);
  const claimAssetIdsKey = (assetIds: readonly string[] | undefined): string | undefined =>
    assetIds === undefined ? undefined : [...assetIds].toSorted().join('\u0000');
  let nextJobAssetIds: readonly string[] | undefined = pumpAssetIds;
  let nextJobAssetKey = claimAssetIdsKey(nextJobAssetIds);
  let nextJob = nextJobQuery(nextJobAssetIds);
  const executeClaimQuery = (): unknown => {
    const rankOrder = viewportClaimRankOrderSql(nextJobAssetIds);
    return nextJob.get(
      libraryId,
      ...jobKinds,
      ...(nextJobAssetIds ?? []),
      ...(deferSecondaryAfterPrimarySql === '' ? [] : [waveStartedAtIso]),
      new Date(Date.now() - MEDIA_RESOURCE_RETRY_DELAY_MS).toISOString(),
      ...rankOrder.params,
    );
  };
  const adoptClaimAssetIds = (assetIds: readonly string[] | undefined): void => {
    nextJobAssetIds = assetIds;
    nextJobAssetKey = claimAssetIdsKey(assetIds);
    nextJob = nextJobQuery(nextJobAssetIds);
  };
  const claimNextJob = (): unknown => {
    const requestedAssetIds = options.claimAssetIdsRef?.current ?? pumpAssetIds;
    const currentAssetIds = normalizedClaimAssetIds(requestedAssetIds);
    const currentAssetKey = claimAssetIdsKey(currentAssetIds);
    if (currentAssetKey !== nextJobAssetKey) {
      adoptClaimAssetIds(currentAssetIds);
    }
    const scoped = executeClaimQuery();
    if (
      scoped !== undefined
      || !shouldFallbackViewportClaimToPersistentQueue({
        interactive: options.interactive === true,
        restrictedByAssetIds: options.assetIds !== undefined,
        scopedClaimIds: nextJobAssetIds,
      })
    ) {
      return scoped;
    }
    if (options.claimAssetIdsRef) {
      options.claimAssetIdsRef.current = undefined;
    }
    adoptClaimAssetIds(undefined);
    return executeClaimQuery();
  };

  let processed = 0;
  const decodeConcurrency = options.interactive
    ? workerMediaInteractiveDecodeConcurrency()
    : workerMediaDecodeConcurrency();
  const maxJobs = Math.max(
    1,
    Math.min(100, options.maxJobs ?? workerMediaDecodeWaveSize()),
  );
  // Media jobs run with a small fixed queue worker count. The per-lane
  // Sharp/FFmpeg/OIIO decoder semaphores cap native pressure independently;
  // CPU topology must never expand the memory budget. The claim UPDATE is atomic
  // (WHERE status = 'queued'), so concurrent workers never double-execute a
  // job. `budget` is reserved synchronously at claim time (before any await),
  // so a wave starts at most maxJobs jobs exactly; a lease-busy retry
  // returns its slot.
  const workerCount = Math.min(maxJobs, decodeConcurrency);
  const waveStartedAt = performance.now();
  logMediaQueueEvent('wave-start', {
    libraryId,
    maxJobs,
    workerCount,
    jobKinds,
    assetCount: pumpAssetIds?.length ?? null,
  });
  let budget = maxJobs;
  const claimedJobIds = new Set<string>();
  const pauseClaimedMediaJobs = (): void => {
    const now = new Date().toISOString();
    for (const jobId of claimedJobIds) {
      openLibrary.connection
        .prepare(
          "UPDATE jobs SET status = 'queued', progress = 0.0, updated_at = ? WHERE job_id = ? AND status = 'running'",
        )
        .run(now, jobId);
      this.activeMediaJobs.get(jobId)?.controller.abort();
    }
  };
  options.signal?.addEventListener('abort', pauseClaimedMediaJobs, { once: true });
  const runWorker = async (): Promise<void> => {
    // the per-job terminal UPDATE is the hottest write in the
    // queue loop (one statement + one WAL commit per job). Batch it: each
    // worker collects the jobs that reached the success path and flushes a
    // single multi-row UPDATE when its wave budget is exhausted. The
    // `status = 'running'` guard is preserved, so a job cancelled/paused or
    // lease-lost between the final check and the flush is left untouched —
    // identical semantics to the old per-job UPDATE, far fewer commits.
    const completedJobIds: string[] = [];
    let consecutiveLeaseBusy = 0;
    let hasAttemptedClaim = false;
    const flushCompletedJobs = (): void => {
      if (completedJobIds.length === 0) return;
      const placeholders = sqliteInPlaceholders(completedJobIds);
      openLibrary.connection
        .prepare(
          `UPDATE jobs
              SET status = 'succeeded', progress = 1.0, error_code = NULL, error_detail = NULL, updated_at = ?
            WHERE job_id IN (${placeholders})
              AND status = 'running'`,
        )
        .run(new Date().toISOString(), ...completedJobIds);
      completedJobIds.length = 0;
    };
    try {
    while (budget > 0) {
    if (hasAttemptedClaim) {
      await yieldBetweenMediaClaims();
      // The sibling queue worker may have consumed the final shared budget
      // while this worker was yielding. Re-check after the await; otherwise
      // both workers can pass the stale `while (budget > 0)` condition and
      // claim one job too many.
      if (budget <= 0) return;
    }
    hasAttemptedClaim = true;
    if (options.signal?.aborted) return;
    if (mediaResourceGuard.isCoolingDown()) return;
    budget -= 1;
    const job = claimNextJob() as {
      job_id: string;
      asset_id: string;
      revision_id: string;
      kind: MediaJobKind;
      priority: number;
      attempt_count: number;
      error_code: string | null;
    } | undefined;
    if (!job) return;
    const now = new Date().toISOString();
    const claimed = openLibrary.connection
      .prepare(
        "UPDATE jobs SET status = 'running', attempt_count = ?, updated_at = ? WHERE job_id = ? AND status = 'queued'",
      )
      .run(job.attempt_count + 1, now, job.job_id);
    if (claimed.changes === 0) continue;
    claimedJobIds.add(job.job_id);
    const jobStartedAt = performance.now();
    logMediaQueueEvent('job-start', {
      libraryId,
      jobId: job.job_id,
      assetId: job.asset_id,
      kind: job.kind,
      priority: job.priority,
      budgetRemaining: budget,
    });
    const isImportedThumbnailNormalization =
      job.kind === 'generate_thumbnail'
      && job.error_code === IMPORTED_THUMBNAIL_NORMALIZATION_JOB;

    // Admission is checked again after the durable claim. Queue insertion
    // and claim are separate SQLite turns, so an ignore rule, delete, source
    // availability change, or revision replacement can happen in between.
    // This prevents stale/unsupported work from reaching Sharp/FFmpeg/OIIO.
    const claimAsset = openLibrary.connection
      .prepare(
        `SELECT location_kind, linked_folder_id, relative_file_path,
                current_revision_id, availability, deleted_at,
                source_revision.byte_size AS source_byte_size
                ${claimSourceDimensionColumns}
           FROM assets a
           LEFT JOIN revisions source_revision
             ON source_revision.revision_id = a.current_revision_id
          WHERE a.asset_id = ?`,
      )
      .get(job.asset_id) as {
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
        deleted_at: string | null;
        source_byte_size: number | null;
        source_width: number | null;
        source_height: number | null;
      } | undefined;
    const detectedClaimMediaType = claimAsset
      ? LibraryService.detectMediaType(claimAsset.relative_file_path)
      : 'other';
    // Plugin-owned formats stay `other` for the viewer and native decoders.
    // Admission still needs an image thumbnail role so the provider can run.
    const claimMediaType = claimAsset
      && detectedClaimMediaType === 'other'
      && this.claimsPluginThumbnail(libraryId, claimAsset.relative_file_path)
      ? 'image'
      : detectedClaimMediaType;
    const claimSourceDirect = claimAsset
      ? isSourceDirectPreview({
          fileName: claimAsset.relative_file_path,
          mediaType: LibraryService.toSummaryMediaType(claimMediaType),
          byteSize: claimAsset.source_byte_size ?? 0,
          width: claimAsset.source_width,
          height: claimAsset.source_height,
        })
      : false;
    const claimIgnored = claimAsset
      ? this.isExplicitlyIgnored(
        openLibrary,
        claimAsset.location_kind,
        claimAsset.linked_folder_id,
        claimAsset.relative_file_path,
        'asset',
      )
      : false;
    const claimArtifactKind = artifactKindForJob(
      job.kind as ArtifactJobKind,
      claimMediaType,
    );
    const currentArtifact = claimAsset?.current_revision_id === job.revision_id
      && claimArtifactKind
        ? openLibrary.connection
          .prepare(
          `SELECT status, generator_version FROM revision_artifacts
             WHERE revision_id = ? AND kind = ? AND invalidated_at IS NULL
             LIMIT 1`,
          )
          .get(job.revision_id, claimArtifactKind) as {
            status: string;
            generator_version: string;
          } | undefined
      : undefined;
    const currentPrimaryArtifactIsCurrent = currentArtifact
      && currentArtifact.status === 'ready'
      && (claimArtifactKind === 'thumbnail' || claimArtifactKind === 'video_poster')
      ? this.primaryArtifactGeneratorIsCurrent(
        claimAsset?.relative_file_path ?? '',
        claimArtifactKind,
        currentArtifact.generator_version,
      )
      : true;
    const headerOnlyImageMetadata = job.kind === 'extract_metadata'
      && claimMediaType === 'image'
      && currentArtifact?.status === 'ready'
      && currentArtifact.generator_version.startsWith('image-header@');
    const siblingJob = openLibrary.connection
      .prepare(
        `SELECT 1 FROM jobs
           WHERE asset_id = ? AND revision_id = ? AND kind = ?
             AND job_id != ? AND status IN ('queued', 'running', 'paused')
           LIMIT 1`,
      )
      .get(job.asset_id, job.revision_id, job.kind, job.job_id);
    const claimAdmission = admitArtifactJob({
      assetId: job.asset_id,
      revisionId: job.revision_id,
      currentRevisionId: claimAsset?.current_revision_id ?? null,
      mediaType: claimMediaType,
      jobKind: job.kind as ArtifactJobKind,
      availability: claimAsset?.availability ?? 'missing',
      deleted: claimAsset === undefined || claimAsset.deleted_at !== null,
      ignored: claimIgnored,
      // A normalization job intentionally runs while the copied artifact is
      // still ready and while the source may qualify for source-direct
      // serving. It owns a replacement transaction, not a new primary row.
      sourceDirect: isImportedThumbnailNormalization ? false : claimSourceDirect,
      // A durable proxy row is created only by the explicit viewer fallback
      // path. Legacy automatic rows are rejected by the policy instead of
      // being allowed to consume another FFmpeg slot.
      explicitRequest: job.error_code === EXPLICIT_PROXY_FALLBACK_MARKER,
      readyArtifact: isImportedThumbnailNormalization
        ? false
        : currentArtifact?.status === 'ready'
          && !headerOnlyImageMetadata
          && currentPrimaryArtifactIsCurrent,
      failedArtifact: currentArtifact?.status === 'failed',
      retryFailed: true,
      activeJob: siblingJob !== undefined,
    });
    if (!claimAdmission.admitted) {
      const errorCode = claimAdmission.reason === 'ignored'
        ? 'ASSET_IGNORED'
        : claimAdmission.reason === 'stale-revision'
          ? 'STALE_REVISION'
          : claimAdmission.reason === 'already-ready'
            ? 'ARTIFACT_READY'
            : claimAdmission.reason === 'source-direct'
              ? 'SOURCE_DIRECT'
              : claimAdmission.reason === 'single-flight'
                ? 'SINGLE_FLIGHT'
                : claimAdmission.reason === 'unavailable'
                  ? 'SOURCE_NOT_FOUND'
                  : claimAdmission.reason === 'deleted'
                    ? 'ASSET_DELETED'
                    : 'ARTIFACT_NOT_ADMITTED';
      openLibrary.connection
        .prepare(
          "UPDATE jobs SET status = 'cancelled', error_code = ?, updated_at = ? WHERE job_id = ? AND status = 'running'",
        )
        .run(errorCode, new Date().toISOString(), job.job_id);
      if (
        claimAdmission.reason === 'source-direct'
        && claimAsset?.current_revision_id === job.revision_id
        && claimAsset.source_width != null
        && claimAsset.source_height != null
      ) {
        options.onResult?.({
          assetId: job.asset_id,
          errorCode: 'SOURCE_DIRECT',
          width: claimAsset.source_width,
          height: claimAsset.source_height,
          revisionId: job.revision_id,
          previewKind: 'source',
          previewRevisionId: job.revision_id,
        });
      }
      if (
        claimAdmission.reason === 'already-ready'
        && job.kind === 'extract_metadata'
        && claimMediaType === 'video'
        && claimAsset?.current_revision_id === job.revision_id
      ) {
        // A poster may have completed the shared ffprobe before this durable
        // metadata job is claimed. Publish the ready facts before cancelling
        // the redundant job so Inspector receives the same update as when
        // the metadata job itself performs the probe.
        const metadata = openLibrary.connection.prepare(
          `SELECT width, height, duration_ms
             FROM revision_artifacts
            WHERE revision_id = ?
              AND kind = 'extracted_metadata'
              AND status = 'ready'
              AND invalidated_at IS NULL
              AND generator_version = ?
            ORDER BY generated_at DESC, artifact_id DESC
            LIMIT 1`,
        ).get(job.revision_id, FFMPEG_METADATA_GENERATOR) as {
          width: number | null;
          height: number | null;
          duration_ms: number | null;
        } | undefined;
        if (metadata) {
          options.onDerivedReady?.({
            assetId: job.asset_id,
            kind: 'extract_metadata',
            revisionId: job.revision_id,
            ...(metadata.width == null ? {} : { width: metadata.width }),
            ...(metadata.height == null ? {} : { height: metadata.height }),
            ...(metadata.duration_ms == null ? {} : { durationMs: metadata.duration_ms }),
            previewKind: null,
            previewRevisionId: null,
          });
        }
      }
      processed += 1;
      continue;
    }

    let jobLease: LibraryJobLease;
    try {
      // media jobs run under full-decoder CPU saturation.
      // A 15s lease expired whenever the event loop stalled, producing
      // lease-lost failures + repair retries that added MORE load. 60s
      // tolerates ~3 missed 20s heartbeats before anyone steals the job.
      jobLease = await this.acquireJobLease(libraryId, job.job_id, {
        timeoutMs: 0,
        leaseDurationMs: MEDIA_JOB_LEASE_DURATION_MS,
      });
      logMediaQueueEvent('job-lease-acquired', {
        libraryId,
        jobId: job.job_id,
        assetId: job.asset_id,
        kind: job.kind,
        elapsedMs: Math.round((performance.now() - jobStartedAt) * 100) / 100,
      });
    } catch (error) {
      if (!(error instanceof LibraryWriteCoordinatorError)) throw error;
      const retryErrorCode = job.kind === 'generate_thumbnail'
        && job.error_code === IMPORTED_THUMBNAIL_NORMALIZATION_JOB
        ? IMPORTED_THUMBNAIL_NORMALIZATION_JOB
        : 'JOB_LEASE_BUSY';
      openLibrary.connection.prepare(
        'UPDATE jobs SET status = \'queued\', error_code = ?, updated_at = ? WHERE job_id = ? AND status = \'running\'',
      ).run(retryErrorCode, new Date().toISOString(), job.job_id);
      budget += 1;
      // adversarial-review fix: timeoutMs:0 makes claimJob
      // throw immediately, and the reset-to-queued above means the same
      // top-priority job is re-selected on the next iteration — a hot
      // microtask spin that starves every other Worker command for as long
      // as a foreign lease lives. Yield briefly and cap consecutive spins.
      consecutiveLeaseBusy += 1;
      if (consecutiveLeaseBusy >= 4) {
        await new Promise((resolveResolveTick) => setTimeout(resolveResolveTick, 250));
        consecutiveLeaseBusy = 0;
      }
      continue;
    }
    consecutiveLeaseBusy = 0;
    const jobHeartbeat = jobLease.startHeartbeat({
      leaseDurationMs: MEDIA_JOB_LEASE_DURATION_MS,
    });
    const controller = new AbortController();
    const previousArtifacts = this.mediaArtifactSnapshot(openLibrary, job.revision_id);
    const providerAssetRow = openLibrary.connection
      .prepare(
        `SELECT a.relative_file_path, r.byte_size
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.asset_id = ?`,
      )
      .get(job.asset_id) as { relative_file_path: string; byte_size: number | null } | undefined;
    let settleActiveJob!: () => void;
    const settled = new Promise<void>((resolve) => {
      settleActiveJob = resolve;
    });
    this.activeMediaJobs.set(job.job_id, {
      controller,
      libraryId,
      assetId: job.asset_id,
      settled,
    });

    try {
      if (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster') {
        // A primary job can outlive the source revision that created it
        // (for example, an external change can land while a proxy is
        // waiting). Do not let the primary lane regenerate the *current*
        // revision under a stale job row; cancel it before any decoder
        // starts so secondary jobs can make the same stale-revision
        // decision on this pump.
        const currentRevision = openLibrary.connection
          .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
          .get(job.asset_id) as { current_revision_id: string | null } | undefined;
        if (!currentRevision?.current_revision_id || currentRevision.current_revision_id !== job.revision_id) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ? AND status = 'running'",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
        let probedSourceSize: { width: number; height: number } | null = null;
        // Fresh linked images often have no dimensions yet. The queue used
        // to decode and encode a thumbnail before discovering that the
        // original qualified for source-direct serving. A bounded header
        // read resolves that policy first, without taking a Sharp slot.
        if (job.kind === 'generate_thumbnail'
          && !isImportedThumbnailNormalization
          && claimAsset
          && (claimAsset.source_width == null || claimAsset.source_height == null)
          && isSourceDirectPreviewCandidate({
            fileName: claimAsset.relative_file_path,
            mediaType: LibraryService.toSummaryMediaType(claimMediaType),
            byteSize: claimAsset.source_byte_size ?? 0,
          })) {
          try {
            probedSourceSize = await readImageDimensions(this.resolveAssetPath(libraryId, job.asset_id));
          } catch {
            // Preserve the decoder's existing missing/corrupt-source path.
          }
          if (controller.signal.aborted || this.mediaJobState(libraryId, job.job_id) !== 'running') {
            processed += 1;
            continue;
          }
          if (probedSourceSize) {
            const latest = openLibrary.connection.prepare(
              'SELECT current_revision_id FROM assets WHERE asset_id = ?',
            ).get(job.asset_id) as { current_revision_id: string | null } | undefined;
            if (latest?.current_revision_id !== job.revision_id) {
              openLibrary.connection.prepare(
                "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ? AND status = 'running'",
              ).run(new Date().toISOString(), job.job_id);
              processed += 1;
              continue;
            }
            jobLease.assertCurrent();
            this.persistExtractedImageDimensions(openLibrary, job.revision_id, probedSourceSize);
            if (isSourceDirectPreview({
              fileName: claimAsset.relative_file_path,
              mediaType: LibraryService.toSummaryMediaType(claimMediaType),
              byteSize: claimAsset.source_byte_size ?? 0,
              width: probedSourceSize.width,
              height: probedSourceSize.height,
            })) {
              const cancelled = openLibrary.connection.prepare(
                "UPDATE jobs SET status = 'cancelled', error_code = 'SOURCE_DIRECT', updated_at = ? WHERE job_id = ? AND status = 'running'",
              ).run(new Date().toISOString(), job.job_id);
              if (cancelled.changes > 0) {
                options.onResult?.({
                  assetId: job.asset_id,
                  errorCode: 'SOURCE_DIRECT',
                  width: probedSourceSize.width,
                  height: probedSourceSize.height,
                  revisionId: job.revision_id,
                  previewKind: 'source',
                  previewRevisionId: job.revision_id,
                });
              }
              processed += 1;
              continue;
            }
          }
        }
        const pluginArtifactId = !isImportedThumbnailNormalization && options.pluginMediaProvider
          ? await options.pluginMediaProvider({
            assetId: job.asset_id,
            signal: controller.signal,
            ...(providerAssetRow === undefined ? {} : {
              asset: {
                assetId: job.asset_id,
                displayName: path.basename(providerAssetRow.relative_file_path),
                relativeFilePath: providerAssetRow.relative_file_path,
                currentRevisionId: job.revision_id,
              },
            }),
          })
          : null;
        const generated = isImportedThumbnailNormalization
          ? await this.normalizeImportedThumbnailArtifact(
              openLibrary,
              {
                assetId: job.asset_id,
                revisionId: job.revision_id,
              },
              { signal: controller.signal },
            )
          : pluginArtifactId
            ? { artifactId: pluginArtifactId }
            : providerAssetRow !== undefined
                && LibraryService.detectMediaType(providerAssetRow.relative_file_path) === 'model'
              ? await this.processModelThumbnailJob(
                  openLibrary,
                  {
                    libraryId,
                    assetId: job.asset_id,
                    revisionId: job.revision_id,
                    relativeFilePath: providerAssetRow.relative_file_path,
                    byteSize: providerAssetRow.byte_size,
                  },
                  {
                    renderer: options.modelThumbnailRenderer,
                    signal: controller.signal,
                  },
                )
              : await this.generateThumbnail(
                { libraryId, assetId: job.asset_id },
                {
                  signal: controller.signal,
                  includeVideoMetadata: false,
                  includeRawMetadata: false,
                  sourceByteSize: claimAsset?.source_byte_size,
                  sourceWidth: claimAsset?.source_width ?? probedSourceSize?.width,
                  sourceHeight: claimAsset?.source_height ?? probedSourceSize?.height,
                  // Only image jobs use the interactive image lane. The
                  // lane is selected by user intent, never by source size,
                  // dimensions, or detected machine capacity.
                  lane: options.interactive
                    && claimMediaType === 'image'
                    ? 'interactive'
                    : 'background',
                },
              );
        logMediaQueueEvent('job-generated', {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
          elapsedMs: Math.round((performance.now() - jobStartedAt) * 100) / 100,
        });
        if (controller.signal.aborted || this.mediaJobState(libraryId, job.job_id) !== 'running') {
          this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
            libraryId,
            jobId: job.job_id,
            assetId: job.asset_id,
            preserveLateArtifacts: isImportedThumbnailNormalization,
          });
          processed += 1;
          continue;
        }
        // Native audio stays source-first after its waveform cover is ready.
        // Playback proxies are requested only by the renderer's explicit
        // source-decode failure path (`retryArtifact(audio_proxy)`).
        // animated GIFs no longer chain a WebM proxy off the
        // still thumbnail; they stay on the native image path everywhere.
        this.enqueuePaletteJob(openLibrary, job.asset_id, job.revision_id, -10);
        // generated stays null when the offscreen renderer failed with a
        // benign outcome (the failed artifact was already written and the
        // job was marked failed by the catch path) or when no renderer is
        // wired (legacy no-op); nothing is published either way.
        if (generated) {
          const mediaInfo = this.thumbnailArtifactMap(libraryId, [job.asset_id]).get(job.asset_id);
          options.onResult?.({
            assetId: job.asset_id,
            artifactId: generated.artifactId,
            ...(mediaInfo?.width ? { width: mediaInfo.width } : {}),
            ...(mediaInfo?.height ? { height: mediaInfo.height } : {}),
            ...(mediaInfo?.durationMs != null ? { durationMs: mediaInfo.durationMs } : {}),
          });
        }
      } else if (job.kind === 'extract_metadata') {
        const current = claimMediaType === 'image'
          ? await this.generateQueuedRawImageMetadata(
            libraryId,
            job.asset_id,
            job.revision_id,
            {
              signal: controller.signal,
              sourceWidth: claimAsset?.source_width,
              sourceHeight: claimAsset?.source_height,
            },
          )
          : await this.generateQueuedVideoMetadata(
            libraryId, job.asset_id, job.revision_id, { signal: controller.signal },
          );
        if (!current) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
        // contact sheets are generated on demand by AI video
        // analysis (ensureVideoContactSheet), not chained off metadata.
      } else if (job.kind === 'extract_palette') {
        if (!this.isPaletteEligibleAsset(openLibrary, job.asset_id, job.revision_id)) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'PALETTE_NOT_APPLICABLE', updated_at = ? WHERE job_id = ?",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
        const current = await this.generateQueuedPaletteArtifact(
          libraryId,
          job.asset_id,
          job.revision_id,
          { signal: controller.signal },
        );
        if (!current) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
      } else if (job.kind === 'generate_audio_proxy') {
        const current = await this.generateQueuedAudioProxy(
          libraryId, job.asset_id, job.revision_id, { signal: controller.signal },
        );
        if (!current) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
      } else {
        const current = await this.generateQueuedVideoArtifact(
          libraryId, job.asset_id, job.revision_id, job.kind,
          { signal: controller.signal },
        );
        if (!current) {
          openLibrary.connection.prepare(
            "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
          ).run(new Date().toISOString(), job.job_id);
          processed += 1;
          continue;
        }
      }
      if (controller.signal.aborted || this.mediaJobState(libraryId, job.job_id) !== 'running') {
        this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          preserveLateArtifacts: isImportedThumbnailNormalization,
        });
        processed += 1;
        continue;
      }
        jobLease.assertCurrent();
      mediaResourceGuard.recordHealthyCompletion();
      if (!primaryPreviewKinds.has(job.kind)) {
        let derivedWidth: number | undefined;
        let derivedHeight: number | undefined;
        let derivedDurationMs: number | undefined;
        let sourceDirectRoute: {
          previewKind: 'source' | null;
          previewRevisionId: string | null;
        } | undefined;
        if (job.kind === 'extract_metadata' && processArtifactColumns.has('width')) {
          const durationSelect = processArtifactColumns.has('duration_ms')
            ? ', duration_ms'
            : '';
          const extracted = openLibrary.connection
            .prepare(
              `SELECT width, height${durationSelect}
                 FROM revision_artifacts
                WHERE revision_id = ?
                  AND kind = 'extracted_metadata'
                  AND status = 'ready'
                  ${processArtifactColumns.has('invalidated_at') ? 'AND invalidated_at IS NULL' : ''}
                ORDER BY generated_at DESC, artifact_id DESC
                LIMIT 1`,
            )
            .get(job.revision_id) as {
              width: number | null;
              height: number | null;
              duration_ms?: number | null;
            } | undefined;
          if (extracted?.width && extracted.width > 0) derivedWidth = extracted.width;
          if (extracted?.height && extracted.height > 0) derivedHeight = extracted.height;
          if (extracted?.duration_ms != null && extracted.duration_ms >= 0) {
            derivedDurationMs = extracted.duration_ms;
          }
          if (claimAsset) {
            const sourceDirect = isSourceDirectPreview({
              fileName: claimAsset.relative_file_path,
              mediaType: LibraryService.toSummaryMediaType(claimMediaType),
              byteSize: claimAsset.source_byte_size ?? 0,
              width: extracted?.width,
              height: extracted?.height,
            });
            sourceDirectRoute = {
              previewKind: sourceDirect ? 'source' : null,
              previewRevisionId: sourceDirect ? job.revision_id : null,
            };
          }
        }
        options.onDerivedReady?.({
          assetId: job.asset_id,
          kind: job.kind as SecondaryMediaJobKind,
          ...(derivedWidth === undefined ? {} : { width: derivedWidth }),
          ...(derivedHeight === undefined ? {} : { height: derivedHeight }),
          ...(derivedDurationMs === undefined ? {} : { durationMs: derivedDurationMs }),
          ...(job.kind !== 'extract_metadata'
            ? {}
            : {
              revisionId: job.revision_id,
              previewKind: sourceDirectRoute?.previewKind ?? null,
              previewRevisionId: sourceDirectRoute?.previewRevisionId ?? null,
            }),
        });
      }
      // deferred to the worker's batched flush (see
      // flushCompletedJobs) — one multi-row UPDATE per worker instead of
      // one statement + WAL commit per job.
      completedJobIds.push(job.job_id);
      // A directly requested proxy/contact sheet is allowed to run in a
      // separate bounded lane, but its claim guard must see the poster's
      // terminal state. Flush only for this same-asset dependency; ordinary
      // image batches retain the one-flush-per-worker write behavior.
      if (
        primaryPreviewKinds.has(job.kind)
        && pendingSecondaryFfmpegJob.get(
          libraryId,
          job.asset_id,
          job.revision_id,
          ...secondaryFfmpegKinds,
        ) !== undefined
      ) {
        flushCompletedJobs();
      }
      if (job.kind === 'generate_contact_sheet') {
        const contactSheet = this.getCurrentArtifact(libraryId, job.asset_id, 'contact_sheet');
        if (contactSheet?.status === 'ready' && this.shouldAutoAnalyzeAsset(libraryId, job.asset_id)) {
          options.onAiInputReady?.({
            assetId: job.asset_id,
            artifactId: contactSheet.artifactId,
          });
        }
      } else if (job.kind === 'generate_thumbnail') {
        // Model AI uses a four-view render rather than the browse thumbnail,
        // but a successful model thumbnail proves that the offscreen model
        // renderer is initialized. Re-trigger the import-time AI enqueue at
        // this boundary so a race cannot leave the model job unprocessed.
        const asset = openLibrary.connection
          .prepare('SELECT relative_file_path FROM assets WHERE asset_id = ?')
          .get(job.asset_id) as { relative_file_path: string } | undefined;
        if (asset && LibraryService.detectMediaType(asset.relative_file_path) === 'model') {
          const thumbnail = this.getCurrentArtifact(libraryId, job.asset_id, 'thumbnail');
          if (thumbnail?.status === 'ready' && this.shouldAutoAnalyzeAsset(libraryId, job.asset_id)) {
            options.onAiInputReady?.({
              assetId: job.asset_id,
              artifactId: thumbnail.artifactId,
            });
          }
        }
      }
    } catch (error) {
      if (isStaleMediaRevisionError(error)) {
        this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
        });
        openLibrary.connection.prepare(
          `UPDATE jobs
              SET status = 'cancelled', error_code = 'STALE_REVISION',
                  error_detail = ?, updated_at = ?
            WHERE job_id = ? AND status = 'running'`,
        ).run(
          safeMediaJobErrorDetail('STALE_REVISION'),
          new Date().toISOString(),
          job.job_id,
        );
        this.diagnose('media-job.stale-revision', error, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
        });
        processed += 1;
        continue;
      }
      const resourceError = asMediaResourceExhaustedError(error, 'media-job');
      if (resourceError) {
        this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          preserveLateArtifacts: isImportedThumbnailNormalization,
        });
        const cooldownMs = mediaResourceGuard.recordFailure();
        const retryErrorCode = isImportedThumbnailNormalization
          ? IMPORTED_THUMBNAIL_NORMALIZATION_JOB
          : (
            (job.kind === 'generate_webm_proxy' || job.kind === 'generate_audio_proxy')
            && job.error_code === EXPLICIT_PROXY_FALLBACK_MARKER
          )
            ? EXPLICIT_PROXY_FALLBACK_MARKER
            : MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE;
        openLibrary.connection.prepare(
          `UPDATE jobs
              SET status = 'queued', error_code = ?,
                  error_detail = ?, updated_at = ?
            WHERE job_id = ? AND status = 'running'`,
        ).run(
          retryErrorCode,
          safeMediaJobErrorDetail(MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE),
          new Date().toISOString(),
          job.job_id,
        );
        this.diagnose('media-job.resource-exhausted', resourceError, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
          cooldownMs,
        });
        processed += 1;
        continue;
      }
      if (jobHeartbeat.error !== undefined || error instanceof LibraryWriteCoordinatorError) {
        this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          preserveLateArtifacts: isImportedThumbnailNormalization,
        });
        // Lease loss must not leave the job stuck in `running`; requeue so a
        // later wave (or process restart recovery) can claim it again.
        const retryErrorCode = isImportedThumbnailNormalization
          ? IMPORTED_THUMBNAIL_NORMALIZATION_JOB
          : (
            (job.kind === 'generate_webm_proxy' || job.kind === 'generate_audio_proxy')
            && job.error_code === EXPLICIT_PROXY_FALLBACK_MARKER
          )
            ? EXPLICIT_PROXY_FALLBACK_MARKER
            : 'JOB_LEASE_LOST';
        openLibrary.connection.prepare(
          "UPDATE jobs SET status = 'queued', error_code = ?, updated_at = ? WHERE job_id = ? AND status = 'running'",
        ).run(retryErrorCode, new Date().toISOString(), job.job_id);
        this.diagnose('media-job.lease-lost', error, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
        });
        processed += 1;
        continue;
      }
      const state = this.mediaJobState(libraryId, job.job_id);
      if (controller.signal.aborted || state === 'paused' || state === 'cancelled') {
        this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          preserveLateArtifacts: isImportedThumbnailNormalization,
        });
        this.diagnose('media-job.interrupted', error, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
          status: state,
        });
        processed += 1;
        continue;
      }
      const failedKind = job.kind === 'extract_palette'
        ? 'extracted_palette'
        : job.kind === 'extract_metadata'
          ? 'extracted_metadata'
        : job.kind === 'generate_contact_sheet'
          ? 'contact_sheet'
        : job.kind === 'generate_webm_proxy'
          ? 'webm_proxy'
          : job.kind === 'generate_audio_proxy'
            ? 'audio_proxy'
            : null;
      const failedArtifact = openLibrary.connection
        .prepare(
          `SELECT error_code FROM revision_artifacts
            WHERE revision_id = ? AND invalidated_at IS NULL AND status = 'failed'
              AND (? IS NULL OR kind = ?)
            ORDER BY generated_at DESC LIMIT 1`,
        )
        .get(job.revision_id, failedKind, failedKind) as { error_code: string | null } | undefined;
      const errorCode = isImportedThumbnailNormalization
        ? IMPORTED_THUMBNAIL_NORMALIZATION_JOB
        : job.kind === 'extract_metadata' && claimMediaType === 'image'
          ? 'RAW_METADATA_EXTRACTION_FAILED'
          : failedArtifact?.error_code
            ?? (job.kind === 'generate_thumbnail'
              ? 'THUMBNAIL_GENERATION_FAILED'
              : job.kind === 'extract_palette'
                ? 'PALETTE_EXTRACTION_FAILED'
                : 'MEDIA_PROCESSING_FAILED');
      openLibrary.connection
        .prepare(
          `UPDATE jobs
              SET status = 'failed', error_code = ?, error_detail = ?, updated_at = ?
            WHERE job_id = ? AND status = 'running'`,
        )
        .run(
          errorCode,
          safeMediaJobErrorDetail(errorCode),
          new Date().toISOString(),
          job.job_id,
        );
      this.diagnose('media-job.failed', error, {
        libraryId,
        jobId: job.job_id,
        assetId: job.asset_id,
        kind: job.kind,
        attemptCount: job.attempt_count + 1,
        errorCode,
      });
      if (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster') {
        const mediaInfo = this.thumbnailArtifactMap(libraryId, [job.asset_id]).get(job.asset_id);
        options.onResult?.({
          assetId: job.asset_id,
          errorCode,
          ...(mediaInfo?.width ? { width: mediaInfo.width } : {}),
          ...(mediaInfo?.height ? { height: mediaInfo.height } : {}),
        });
      }
    } finally {
      logMediaQueueEvent('job-finish', {
        libraryId,
        jobId: job.job_id,
        assetId: job.asset_id,
        kind: job.kind,
        elapsedMs: Math.round((performance.now() - jobStartedAt) * 100) / 100,
      });
      jobHeartbeat.stop();
      jobLease.release();
      this.activeMediaJobs.delete(job.job_id);
      claimedJobIds.delete(job.job_id);
      settleActiveJob();
    }
    processed += 1;
    if (processed >= maxJobs) return;
    }
    } finally {
      // Flush this worker's completed jobs before the wave returns so
      // callers/tests observe terminal `succeeded` state immediately.
      flushCompletedJobs();
    }
  };
  try {
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  } finally {
    options.signal?.removeEventListener('abort', pauseClaimedMediaJobs);
  }

  logMediaQueueEvent('wave-finish', {
    libraryId,
    processed,
    elapsedMs: Math.round((performance.now() - waveStartedAt) * 100) / 100,
  });

  return processed;
}

/** Return current image-thumbnail or video-poster state for asset summaries. */
export function thumbnailArtifactMap(this: LibraryService, libraryId: string, assetIds: string[]): Map<string, {
    status: 'ready' | 'pending' | 'failed' | null;
    artifactId: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  if (assetIds.length === 0) return new Map();
  // lenient read (0031 §1): libraries predating
  // revision_artifacts.status have no thumbnail artifacts to map.
  if (!columnsFor(openLibrary.connection, 'revision_artifacts').has('status')) {
    return new Map();
  }
  return readCatalogThumbnailArtifacts(openLibrary.connection, assetIds);
}

/** Return only statuses for callers that do not need artifact ids. */
export function thumbnailStatusMap(this: LibraryService, libraryId: string, assetIds: string[]): Map<string, 'ready' | 'pending' | 'failed' | null> {
  return new Map(
    [...this.thumbnailArtifactMap(libraryId, assetIds)]
      .map(([assetId, artifact]) => [assetId, artifact.status]),
  );
}

export function probeMissingAssetRecovery(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
  }): MissingAssetRecoveryProbe {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const row = openLibrary.connection
    .prepare(
      `SELECT a.location_kind, a.linked_folder_id, a.relative_file_path,
              a.current_revision_id, a.availability, a.deleted_at,
              r.revision_id AS revision_row_id, r.byte_size,
              r.content_fingerprint
         FROM assets a
         LEFT JOIN revisions r ON r.revision_id = a.current_revision_id
        WHERE a.asset_id = ?`,
    )
    .get(input.assetId) as {
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
      revision_row_id: string | null;
      byte_size: number | null;
      content_fingerprint: string | null;
    } | undefined;
  if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if ((row.availability !== 'missing' && row.revision_row_id !== null) || row.deleted_at !== null) {
    return {
      status: 'not-missing',
      candidateKind: null,
      contentVerified: false,
      checkedLocations: 0,
    };
  }

  const candidates: Array<{
    kind: 'managed-source' | 'trash' | 'linked-source';
    path: string;
    allowUnverifiedRecovery: boolean;
  }> = [];
  if (row.location_kind === 'managed') {
    try {
      const destination = this.portableDiskDestination(
        openLibrary,
        row.relative_file_path,
      );
      if (destination) {
        const sourcePath = path.join(
          this.assetsPath(openLibrary),
          ...destination.actualRelativePath.split('/'),
        );
        candidates.push({
          kind: 'managed-source',
          path: sourcePath,
          // A dangling revision is repaired from the source on the next
          // refresh; there is no historical fingerprint to compare yet.
          allowUnverifiedRecovery: row.revision_row_id === null,
        });
      }
    } catch {
      // A malformed or ambiguous managed path is not an automatic match.
    }
    candidates.push({
      kind: 'trash',
      path: this.trashPath(
        openLibrary,
        input.assetId,
        path.posix.basename(row.relative_file_path),
      ),
      allowUnverifiedRecovery: false,
    });
  } else if (row.linked_folder_id) {
    const linkedFolder = openLibrary.connection
      .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
      .get(row.linked_folder_id) as { absolute_root_path: string } | undefined;
    if (linkedFolder && realDirectoryExists(linkedFolder.absolute_root_path)) {
      const sourcePath = this.knownRecoveryFilePath(
        linkedFolder.absolute_root_path,
        row.relative_file_path,
      );
      if (sourcePath) {
        candidates.push({
          kind: 'linked-source',
          path: sourcePath,
          allowUnverifiedRecovery: row.revision_row_id === null,
        });
      }
    }
  }

  let unverifiedCandidateKind: 'managed-source' | 'trash' | 'linked-source' | null = null;
  let checkedLocations = 0;
  for (const candidate of candidates) {
    checkedLocations += 1;
    if (!realFileExists(candidate.path)) continue;
    if (row.content_fingerprint) {
      try {
        if (this.computeContentFingerprint(candidate.path) === row.content_fingerprint) {
          return {
            status: 'recoverable',
            candidateKind: candidate.kind,
            contentVerified: true,
            checkedLocations,
          };
        }
      } catch {
        // Treat an unreadable candidate as unavailable and continue probing.
      }
      continue;
    }
    unverifiedCandidateKind ??= candidate.kind;
    if (candidate.allowUnverifiedRecovery) {
      return {
        status: 'recoverable',
        candidateKind: candidate.kind,
        contentVerified: false,
        checkedLocations,
      };
    }
  }
  return {
    status: 'needs-location',
    candidateKind: unverifiedCandidateKind,
    contentVerified: false,
    checkedLocations,
  };
}

/**
* Read text for a text-classified asset with a hard byte cap.
* Managed and linked assets are editable. Trashed assets stay read-only.
*/
export function textAssetPreviewCacheKey(this: LibraryService, libraryId: string, assetId: string, revisionId: string, maxBytes: number): string {
  return `${libraryId}\0${assetId}\0${revisionId}\0${maxBytes}`;
}

export function readCachedTextAssetPreview(this: LibraryService, key: string): {
    assetId: string;
    revisionId: string;
    content: string;
    truncated: boolean;
    byteSize: number;
    lineCount: number;
    editable: boolean;
    mimeType: string;
  } | undefined {
  const entry = this.textAssetPreviewCache.get(key);
  if (!entry) return undefined;
  // Map insertion order is used as a tiny LRU. Reinsert on a hit so a
  // frequently visible text card does not evict itself during a scroll.
  this.textAssetPreviewCache.delete(key);
  this.textAssetPreviewCache.set(key, entry);
  return entry.value;
}

export function cacheTextAssetPreview(this: LibraryService, key: string, value: {
      assetId: string;
      revisionId: string;
      content: string;
      truncated: boolean;
      byteSize: number;
      lineCount: number;
      editable: boolean;
      mimeType: string;
    }): void {
  this.textAssetPreviewCache.delete(key);
  this.textAssetPreviewCache.set(key, { value });
  while (
    this.textAssetPreviewCache.size
    > LibraryService.TEXT_ASSET_PREVIEW_CACHE_LIMIT
  ) {
    const oldest = this.textAssetPreviewCache.keys().next().value;
    if (oldest === undefined) break;
    this.textAssetPreviewCache.delete(oldest);
  }
}

export function invalidateTextAssetPreviewCache(this: LibraryService, libraryId: string, assetId: string): void {
  const prefix = `${libraryId}\0${assetId}\0`;
  for (const key of this.textAssetPreviewCache.keys()) {
    if (key.startsWith(prefix)) this.textAssetPreviewCache.delete(key);
  }
}

export function clearTextAssetPreviewCache(this: LibraryService, libraryId: string): void {
  const prefix = `${libraryId}\0`;
  for (const key of this.textAssetPreviewCache.keys()) {
    if (key.startsWith(prefix)) this.textAssetPreviewCache.delete(key);
  }
}

/**
* Selection for file lifecycle operations (trash, restore, delete): image
* sequence members and, since PF, companion files of every primary.
*/
export function expandAssetIdsToSequenceMembers(this: LibraryService, openLibrary: OpenLibrary, assetIds: readonly string[]): string[] {
  const uniqueIds = this.withCompanionAssetIds(openLibrary, [...new Set(assetIds)]);
  if (uniqueIds.length === 0) return [];
  const sequenceRows = sqliteAllInChunks<string, { sequence_id: string }>({
    connection: openLibrary.connection,
    values: uniqueIds,
    buildSql: (placeholders) =>
      `SELECT DISTINCT sequence_id
         FROM asset_sequence_frames
        WHERE asset_id IN (${placeholders})`,
  });
  if (sequenceRows.length === 0) return uniqueIds;
  const memberRows = sqliteAllInChunks<string, { asset_id: string }>({
    connection: openLibrary.connection,
    values: sequenceRows.map((row) => row.sequence_id),
    buildSql: (placeholders) =>
      `SELECT DISTINCT asset_id
         FROM asset_sequence_frames
        WHERE sequence_id IN (${placeholders})`,
  });
  return [...new Set([...uniqueIds, ...memberRows.map((row) => row.asset_id)])];
}

export function previewRestoreAssets(this: LibraryService, input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId?: string | null;
  }): { hasNameConflicts: boolean } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const assetIds = input.assetIds;
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
    throw new LibraryServiceError('INVALID_SELECTION');
  }

  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    relative_file_path: string;
    deleted_at: string;
    trashed_from_relative_path: string;
    trashed_from_folder_id: string | null;
  }>({
    connection: openLibrary.connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, a.relative_file_path, a.deleted_at,
              a.trashed_from_relative_path, a.trashed_from_folder_id
         FROM assets a
        WHERE a.asset_id IN (${placeholders})
          AND a.deleted_at IS NOT NULL`,
  });

  const foundIds = new Set(rows.map((r) => r.asset_id));
  for (const id of assetIds) {
    if (!foundIds.has(id)) {
      const exists = openLibrary.connection
        .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
        .get(id);
      if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      throw new LibraryServiceError('ASSET_NOT_TRASHED');
    }
  }

  const rowById = new Map(rows.map((row) => [row.asset_id, row]));
  const orderedRows = assetIds.map((assetId) => rowById.get(assetId)!);

  const hasExplicitTarget = input.targetFolderId !== undefined;
  let targetFolder: ManagedFolderRow | undefined;
  if (typeof input.targetFolderId === 'string') {
    targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
  }

  for (const row of orderedRows) {
    const filename = path.posix.basename(row.trashed_from_relative_path);

    let targetFolderPath = '';
    if (targetFolder) {
      targetFolderPath = targetFolder.relative_path;
    } else if (!hasExplicitTarget && row.trashed_from_folder_id) {
      const origFolder = openLibrary.connection
        .prepare('SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?')
        .get(row.trashed_from_folder_id) as { folder_id: string; relative_path: string } | undefined;
      if (origFolder) {
        targetFolderPath = origFolder.relative_path;
      }
    }

    const destRelativePath = targetFolderPath
      ? path.posix.join(targetFolderPath, filename)
      : filename;
    const destIdentity = portablePathIdentity(destRelativePath);
    const activeConflict = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed'
              AND deleted_at IS NULL AND asset_id != ?`,
      )
      .get(destIdentity, row.asset_id);
    const diskConflict = this.portableDiskDestination(openLibrary, destRelativePath);
    if (activeConflict || diskConflict) {
      return { hasNameConflicts: true };
    }
  }

  return { hasNameConflicts: false };
}

/**
* Covers for trash folder cards keyed by tombstone id (whvm).
*/
export function trashedFolderCoverArtifactMap(this: LibraryService, openLibrary: OpenLibrary, tombstoneIds: string[]): Map<string, string[]> {
  const covers = new Map<string, string[]>();
  if (tombstoneIds.length === 0) return covers;
  const rows = withSqliteInPredicate(
    openLibrary.connection,
    'a.trashed_from_tombstone_id',
    tombstoneIds,
    (sql, params) =>
      openLibrary.connection
        .prepare(
          `SELECT a.trashed_from_tombstone_id AS tombstone_id,
                  ra.artifact_id AS artifact_id
             FROM assets a
             JOIN revision_artifacts ra
               ON ra.revision_id = a.current_revision_id
              AND ra.invalidated_at IS NULL
              AND ra.status = 'ready'
              AND ra.kind = CASE
                WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                  OR LOWER(a.relative_file_path) LIKE '%.webm'
                  OR LOWER(a.relative_file_path) LIKE '%.mov'
                  OR LOWER(a.relative_file_path) LIKE '%.avi'
                  OR LOWER(a.relative_file_path) LIKE '%.wmv'
                  OR LOWER(a.relative_file_path) LIKE '%.mkv'
                  OR LOWER(a.relative_file_path) LIKE '%.m4v'
                  OR LOWER(a.relative_file_path) LIKE '%.flv'
                THEN 'video_poster'
                ELSE 'thumbnail'
              END
            WHERE a.deleted_at IS NOT NULL
              AND ${sql}
            ORDER BY a.trashed_from_tombstone_id, a.relative_file_path`,
        )
        .all(...params) as Array<{ tombstone_id: string; artifact_id: string }>,
  );

  for (const row of rows) {
    const existing = covers.get(row.tombstone_id) ?? [];
    if (existing.length >= 3) continue;
    existing.push(row.artifact_id);
    covers.set(row.tombstone_id, existing);
  }
  return covers;
}

export function relinkBatchPreview(this: LibraryService, input: {
    libraryId: string;
    newRootPath: string;
  }): { matchedCount: number; unmatchedCount: number; totalCount: number; examples: Array<{ relativeFilePath: string; matched: boolean }> } {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  let newRoot: string;
  try {
    newRoot = normalizeAbsolutePath(input.newRootPath);
  } catch (error) {
    throw serviceError(error, 'INVALID_IMPORT_SOURCE');
  }

  if (!realDirectoryExists(newRoot)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
  }
  this.assertNoSymlinkEscape(newRoot);

  const rows = this.batchRelinkRows(openLibrary);
  const matches = this.batchRelinkMatches(openLibrary, newRoot, rows);

  let matchedCount = 0;
  let unmatchedCount = 0;
  const examples: Array<{ relativeFilePath: string; matched: boolean }> = [];

  for (const row of rows) {
    const matched = matches.has(row.asset_id);

    if (matched) matchedCount += 1;
    else unmatchedCount += 1;

    if (examples.length < 8) {
      // Use only relative fragment (not absolute)
      const displaySegments = row.relative_file_path.split('/');
      const fragment = displaySegments.slice(-2).join('/');
      examples.push({ relativeFilePath: fragment, matched });
    }
  }

  return {
    matchedCount,
    unmatchedCount,
    totalCount: rows.length,
    examples,
  };
}

export function previewGitignore(this: LibraryService, libraryId: string, content: string): GitignorePreview {
  const openLibrary = this.requireOpenLibrary(libraryId);
  return diffGitignoreHits(
    this.collectGitignorePreviewCandidates(openLibrary),
    openLibrary.gitignoreMatcher,
    parseGitignore(content, openLibrary.summary.storageLayout === 'root' ? '' : 'Assets'),
  );
}

export function collectGitignorePreviewCandidates(this: LibraryService, openLibrary: OpenLibrary): GitignorePreviewCandidate[] {
  const byKey = new Map<string, GitignorePreviewCandidate>();
  const add = (candidate: GitignorePreviewCandidate) => {
    if (candidate.relativePath.length === 0) return;
    byKey.set(gitignorePreviewCandidateKey(candidate), candidate);
  };
  const linkedFolders = hasTable(openLibrary.connection, 'linked_folders')
    ? openLibrary.connection.prepare(
      `SELECT folder_id, display_name, status, absolute_root_path
         FROM linked_folders`,
    ).all() as Array<{
      folder_id: string;
      display_name: string;
      status: 'available' | 'offline';
      absolute_root_path: string;
    }>
    : [];
  const linkedNames = new Map(linkedFolders.map((folder) => [folder.folder_id, folder.display_name]));
  const linkedDisplayName = (linkedFolderId: string, relativePath: string): string => {
    const rootName = linkedNames.get(linkedFolderId);
    return rootName === undefined ? relativePath : `${rootName}/${relativePath}`;
  };

  if (hasTable(openLibrary.connection, 'managed_folders')) {
    const managedFolders = openLibrary.connection.prepare(
      `SELECT relative_path FROM managed_folders ORDER BY relative_path`,
    ).all() as Array<{ relative_path: string }>;
    for (const folder of managedFolders) {
      add({
        locationKind: 'managed',
        linkedFolderId: null,
        relativePath: folder.relative_path,
        pathKind: 'folder',
        displayName: folder.relative_path,
      });
    }
  }

  if (hasTable(openLibrary.connection, 'assets')) {
    const managedAssets = openLibrary.connection.prepare(
      `SELECT relative_file_path AS relative_path
         FROM assets
        WHERE location_kind = 'managed' AND deleted_at IS NULL
        ORDER BY relative_file_path`,
    ).all() as Array<{ relative_path: string }>;
    for (const asset of managedAssets) {
      add({
        locationKind: 'managed',
        linkedFolderId: null,
        relativePath: asset.relative_path,
        pathKind: 'asset',
        displayName: asset.relative_path,
      });
    }

    const linkedAssets = openLibrary.connection.prepare(
      `SELECT linked_folder_id, relative_file_path AS relative_path
         FROM assets
        WHERE location_kind = 'linked' AND deleted_at IS NULL AND linked_folder_id IS NOT NULL
        ORDER BY linked_folder_id, relative_file_path`,
    ).all() as Array<{ linked_folder_id: string; relative_path: string }>;
    const linkedPathsByFolder = new Map<string, string[]>();
    for (const asset of linkedAssets) {
      const paths = linkedPathsByFolder.get(asset.linked_folder_id);
      if (paths) paths.push(asset.relative_path);
      else linkedPathsByFolder.set(asset.linked_folder_id, [asset.relative_path]);
      add({
        locationKind: 'linked',
        linkedFolderId: asset.linked_folder_id,
        relativePath: asset.relative_path,
        pathKind: 'asset',
        displayName: linkedDisplayName(asset.linked_folder_id, asset.relative_path),
      });
    }
    for (const [linkedFolderId, paths] of linkedPathsByFolder) {
      for (const prefix of collectLinkedDirectoryPrefixes(paths)) {
        add({
          locationKind: 'linked',
          linkedFolderId,
          relativePath: prefix,
          pathKind: 'folder',
          displayName: linkedDisplayName(linkedFolderId, prefix),
        });
      }
    }
  }

  const libraryId = openLibrary.summary.libraryId;
  for (const folder of linkedFolders) {
    const prefixes = this.indexedLinkedDirectoryPrefixes(
      openLibrary,
      folder.folder_id,
      this.getLinkedFolderRules({ libraryId, folderId: folder.folder_id }),
      true,
    );
    for (const prefix of prefixes) {
      add({
        locationKind: 'linked',
        linkedFolderId: folder.folder_id,
        relativePath: prefix,
        pathKind: 'folder',
        displayName: linkedDisplayName(folder.folder_id, prefix),
      });
    }
  }

  return [...byKey.values()];
}

export function previewAutomationImport(this: LibraryService, input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    expandImageSequences?: boolean;
    imageSequenceFps?: number;
  }): AutomationImportPlan {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  if (this.linkedFolderRowForImport(openLibrary, input.targetFolderId)) {
    throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
      reason: 'SOURCE_NOT_FOUND',
    });
  }
  const targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
  const { entries } = this.enumerateImportSources({
    sourceKind: input.sourceKind,
    sourcePaths: input.sourcePaths,
    targetPrefix: targetFolder?.relative_path ?? '',
    expandImageSequences: input.expandImageSequences === true,
  });
  const seenDestinations = new Map<string, number>();
  const destinationDirectoryCache = new ImportDestinationDirectoryCache();
  const contentHashCache = new Map<string, string>();
  const seenContentHashes = new Set<string>();
  const sequenceBatchPaths = new Set<string>();
  for (const candidate of detectImageSequences(
    entries.map((entry) => entry.destinationRelativePath),
  )) {
    for (const frame of candidate.frames) sequenceBatchPaths.add(frame.value);
  }
  const sourceStates: AutomationImportPlan['sourceStates'] = [];
  let suspectedDuplicateCount = 0;
  let libraryDuplicateCount = 0;
  let nameConflictCount = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    const entrySha256 = sha256FileAtPath(entry.sourcePath);
    contentHashCache.set(entry.sourcePath, entrySha256);
    sourceStates.push({
      sourcePath: entry.sourcePath,
      stateToken: createHash('sha256')
        .update(`${entry.sourcePath}\0${entry.byteSize}\0${entrySha256}`, 'utf8')
        .digest('hex'),
    });
    totalBytes += entry.byteSize;
    const identity = portablePathIdentity(entry.destinationRelativePath);
    let existingSize = seenDestinations.get(identity);
    let existingAbsolutePath: string | undefined;
    if (existingSize === undefined) {
      const destination = this.portableDiskDestination(
        openLibrary,
        entry.destinationRelativePath,
        destinationDirectoryCache,
      );
      existingSize = destination?.size;
      if (destination && destination.size !== -1) {
        existingAbsolutePath = this.folderPath(openLibrary, destination.actualRelativePath);
      }
    }
    const conflictKind = this.classifyImportEntryConflict({
      openLibrary,
      entry,
      entrySha256,
      existingSize,
      existingAbsolutePath,
      contentHashCache,
      seenContentHashes,
      ignoreBatchContentHash: sequenceBatchPaths.has(entry.destinationRelativePath),
    });
    if (conflictKind === 'suspected-duplicate') {
      suspectedDuplicateCount += 1;
      if (existingSize === undefined) libraryDuplicateCount += 1;
    } else if (conflictKind === 'name-conflict') {
      nameConflictCount += 1;
    } else {
      seenContentHashes.add(entrySha256);
      seenDestinations.set(identity, entry.byteSize);
    }
  }
  const changeSequence = this.getChangeSequence(input.libraryId);
  return {
    libraryId: input.libraryId,
    planHash: createAutomationImportPlanHash({
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
      ...(input.imageSequenceFps === undefined ? {} : { imageSequenceFps: input.imageSequenceFps }),
      ...(input.expandImageSequences === undefined ? {} : { expandImageSequences: input.expandImageSequences }),
      expectedChangeSequence: changeSequence,
      sourceStates,
    }),
    changeSequence,
    fileCount: entries.length,
    totalBytes,
    suspectedDuplicateCount,
    libraryDuplicateCount,
    nameConflictCount,
    sourceStates,
  };
}

// ── Library Export / Import ────────────────────────────────────────

export function nextImportProgressSequence(this: LibraryService, importId: string, phase: ImportProgressEvent['phase']): number {
  const sequence = (this.importProgressSequences.get(importId) ?? 0) + 1;
  if (phase === 'complete' || phase === 'cancelled' || phase === 'failed') {
    this.importProgressSequences.delete(importId);
  } else {
    this.importProgressSequences.set(importId, sequence);
  }
  return sequence;
}


export function runFfmpeg(this: LibraryService, command: string, args: string[], options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      memory?: Omit<MediaNativeMemoryEstimate, 'decoder'>;
    } = {}): Promise<SpawnResult> {
  const { memory, ...spawnOptions } = options;
  const boundedArgs = constrainFfmpegDecoderArgs(command, args);
  const memoryBytes = estimateMediaNativeMemoryBytes({ decoder: 'ffmpeg', ...memory });
  return mediaNativeMemoryBudget.run(
    spawnOptions.signal,
    memoryBytes,
    async () => {
      try {
        const result = await this.spawnFn(command, boundedArgs, spawnOptions);
        if (mediaResourceFailureFromSpawnResult(result)) {
          throw asMediaResourceExhaustedError(result, 'ffmpeg')
            ?? new Error('FFmpeg reported native resource pressure.');
        }
        return result;
      } catch (error) {
        throw asMediaResourceExhaustedError(error, 'ffmpeg') ?? error;
      }
    },
    {
      key: 'ffmpeg',
      limit: () => mediaFfmpegConcurrencyLimit(this.availablePhysicalMemoryBytes()),
    },
  );
}

export function availablePhysicalMemoryBytes(this: LibraryService): number | undefined {
  let bytes: number | undefined;
  try {
    bytes = this.options.availablePhysicalMemoryBytesForTests
      ? this.options.availablePhysicalMemoryBytesForTests()
      : systemAvailablePhysicalMemoryBytes();
  } catch {
    bytes = undefined;
  }

  if (Number.isSafeInteger(bytes) && bytes! > 0) {
    this.reportedMemoryProbeUnavailable = false;
    return bytes;
  }

  if (!this.reportedMemoryProbeUnavailable) {
    this.reportedMemoryProbeUnavailable = true;
    this.diagnose(
      'media-memory.probe-unavailable',
      new Error('System physical memory is unavailable; FFmpeg concurrency uses the conservative limit.'),
      { fallback: 'conservative', maxConcurrentFfmpeg: mediaFfmpegConcurrencyLimit(undefined) },
    );
  }
  return undefined;
}

// ── Thumbnails & Artifacts ─────────────────────────────────────────

/**
* Resolve the absolute filesystem path for an asset (no MIME lookup).
*/
/**
* Quarter-turn a bakeable still image's pixels and record a new revision.
* Sequences, video, and formats we cannot rewrite return `{ baked: false }`.
*/
export async function rotateImageContent(this: LibraryService, libraryId: string, assetId: string, direction: 'clockwise' | 'counter-clockwise'): Promise<{ baked: true; revisionId: string } | { baked: false }> {
  const openLibrary = this.requireOpenLibrary(libraryId);
  this.assertLibraryWritable(openLibrary);
  const asset = openLibrary.connection
    .prepare(
      `SELECT asset_id, location_kind, linked_folder_id, relative_file_path,
              current_revision_id, deleted_at, availability
         FROM assets
        WHERE asset_id = ?`,
    )
    .get(assetId) as {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      linked_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string | null;
      deleted_at: string | null;
      availability: 'available' | 'missing';
    } | undefined;
  if (!asset || asset.deleted_at || asset.availability !== 'available' || !asset.current_revision_id) {
    throw new LibraryServiceError('ASSET_NOT_FOUND');
  }
  if (
    LibraryService.detectMediaType(asset.relative_file_path) !== 'image'
    || !isBakeableStillImageFile(asset.relative_file_path)
    || this.assetBelongsToImageSequence(openLibrary, assetId)
  ) {
    return { baked: false };
  }
  const absolutePath = this.resolveAssetPath(libraryId, assetId);
  const now = new Date().toISOString();
  const revisionId = randomUUID();
  const previousRevisionId = asset.current_revision_id;
  const revisionColumns = columnsFor(openLibrary.connection, 'revisions');
  const record = openLibrary.connection.transaction(() => {
    const stat = statSync(absolutePath);
    const fingerprint = revisionColumns.has('content_fingerprint')
      ? sha256FileAtPath(absolutePath)
      : null;
    if (fingerprint === null) {
      openLibrary.connection
        .prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, 'replace', ?)`,
        )
        .run(
          revisionId,
          asset.asset_id,
          previousRevisionId,
          stat.size,
          stat.mtime.toISOString(),
          path.posix.basename(asset.relative_file_path),
          now,
        );
    } else {
      openLibrary.connection
        .prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at, content_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, 'replace', ?, ?)`,
        )
        .run(
          revisionId,
          asset.asset_id,
          previousRevisionId,
          stat.size,
          stat.mtime.toISOString(),
          path.posix.basename(asset.relative_file_path),
          now,
          fingerprint,
        );
    }
    openLibrary.connection
      .prepare(
        `UPDATE assets
            SET current_revision_id = ?, availability = 'available', updated_at = ?
          WHERE asset_id = ?`,
      )
      .run(revisionId, now, asset.asset_id);
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ? AND invalidated_at IS NULL`,
      )
      .run(now, previousRevisionId);
    const insertJob = openLibrary.connection.prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority,
          progress, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 300, 0.0, 0, ?, ?)`,
    );
    for (const kind of ['generate_thumbnail', 'extract_metadata'] as const) {
      insertJob.run(randomUUID(), libraryId, asset.asset_id, revisionId, kind, now, now);
    }
  });
  try {
    await rotateStillImageFile(absolutePath, direction, () => {
      record();
    });
  } catch (error) {
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
  }
  this.emitClientAssetsChanged(libraryId, 1, true);
  return { baked: true, revisionId };
}

/** Generate a contact sheet (grid of sampled frames). */
export async function generateContactSheet(this: LibraryService, input: { libraryId: string; assetId: string }, openLibrary: OpenLibrary, assetPath: string, revisionId: string, ffmpegPath: string, artifactsDir: string, durationSec: number, dimensions: { width: number; height: number }, ffprobePath: string, execution: MediaExecutionContext): Promise<string> {
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.jpg`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

  // the AI contact sheet must stay within a 2048 long edge
  // while showing at least 16 frames. Large videos shrink each frame to a
  // ~509 cell (4×4 baseline); small videos keep their native size, which
  // lets the grid grow to more frames.
  const { width, height } = dimensions;
  const TARGET_EDGE = 2048;
  const MARGIN = 2;
  const PADDING = 2;
  const longEdge = Math.max(width, height);
  const baselineCell = Math.floor((TARGET_EDGE - 2 * PADDING - 2 * MARGIN * 4) / 4);
  const frameEdge = Math.min(baselineCell, longEdge);
  const frameW = Math.max(2, Math.round((frameEdge * width / longEdge) / 2) * 2);
  const frameH = Math.max(2, Math.round((frameEdge * height / longEdge) / 2) * 2);
  const columns = Math.max(4, Math.min(20,
    Math.floor((TARGET_EDGE - 2 * PADDING + MARGIN) / (frameW + MARGIN))));
  const rows = Math.max(4, Math.min(20,
    Math.floor((TARGET_EDGE - 2 * PADDING + MARGIN) / (frameH + MARGIN))));
  const frameCount = columns * rows;
  const interval = durationSec / frameCount;

  // drawtext stamps the current frame time (HH:MM:SS.mmm) at the bottom
  // right of every frame. The bundled DejaVu Sans font keeps the LGPL
  // build independent of fontconfig/system fonts.
  const fontPath = resolveBundledFontPath();
  const escapedFontPath = fontPath
    ? escapeFfmpegFilterPath(fontPath)
    : null;
  const fontSize = Math.max(14, Math.round(frameH * 0.12));
  const keyframeCount = await this.countVideoKeyframes(ffprobePath, assetPath, execution);
  const useKeyframeFastPath = keyframeCount !== null && keyframeCount >= 16;
  const filterGraph = [
    `fps=1/${interval}`,
    `scale=${frameW}:${frameH}:flags=lanczos`,
    escapedFontPath
      ? `drawtext=fontfile='${escapedFontPath}':text='%{pts\\:hms}':x=w-tw-8:y=h-th-8:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.5`
      : null,
    `tile=${columns}x${rows}:margin=2:padding=2:color=#1a1a1a`,
  ].filter((part): part is string => part !== null).join(',');

  try {
    const result = await this.runFfmpeg(ffmpegPath, [
      '-y',
      ...(useKeyframeFastPath ? ['-skip_frame', 'nokey'] : []),
      '-i', assetPath,
      '-vf', filterGraph,
      '-frames:v', '1',
      '-q:v', '5',
      '-update', '1',
      artifactAbsPath,
    ], { signal: execution.signal });

    if (result.exitCode !== 0) {
      console.error('[CONTACT-SHEET-FFMPEG-ERR]', result.stderr.slice(-800));
      throw new Error(`ffmpeg contact sheet exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
    }

    const outputStat = statSync(artifactAbsPath);
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, generated_at)
         VALUES (?, ?, 'contact_sheet', 'image/jpeg', ?, ?, ?, 'ready', ?)`,
      )
      .run(artifactId, revisionId, outputStat.size, artifactRelPath,
        `ffmpeg@${FFMPEG_VERSION}`, new Date().toISOString());

    return artifactId;
  } catch (error) {
    if (execution.signal?.aborted) {
      rmSync(artifactAbsPath, { force: true });
      throw error;
    }
    this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'contact_sheet',
      'image/jpeg', artifactRelPath, `ffmpeg@${FFMPEG_VERSION}`, error);
    throw error;
  }
}

export async function getExrPlanes(this: LibraryService, revisionId: string, assetPath: string): Promise<ExrPlaneDescriptor[]> {
  const cached = this.exrPlanesByRevision.get(revisionId);
  if (cached) return cached;
  try {
    const nativeInput = await inspectMediaNativeInput(assetPath, {});
    const result = await this.runOiio(resolveOiiotoolPath(), [
      '--info', '-v', '-a', assetPath,
    ], { memory: nativeInput });
    if (result.exitCode !== 0) return [{ index: 0, label: 'Part 0' }];
    const planes = parseExrPlaneDescriptors(result.stdout.toString('utf-8'));
    this.exrPlanesByRevision.set(revisionId, planes);
    return planes;
  } catch (error) {
    this.diagnose('oiio.exr-plane-info', error, { revisionId });
    return [{ index: 0, label: 'Part 0' }];
  }
}

/**
* Companion-texture mapping for a model asset (model.resolve-companions).
*
* Returns every library asset inside the model's own directory (recursive),
* excluding the model itself — the index slice C uses to rewrite OBJ+MTL /
* FBX external texture references by relative path. Read-only; only
* relative paths and ids cross the boundary, never absolute paths.
*/
export function resolveModelCompanions(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
  }): ModelCompanionAsset[] {
  const openLibrary = this.requireOpenLibrary(input.libraryId);
  const asset = openLibrary.connection
    .prepare(
      `SELECT relative_file_path, current_revision_id, availability
         FROM assets
        WHERE asset_id = ? AND deleted_at IS NULL`,
    )
    .get(input.assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
    } | undefined;
  if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
  if (asset.availability === 'missing') {
    throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
  }
  if (!isSupportedModelExtension(asset.relative_file_path)) {
    throw new LibraryServiceError('UNSUPPORTED_MEDIA_TYPE');
  }
  return queryModelCompanionAssets(openLibrary.connection, asset.relative_file_path);
}


/**
* Read the current `extracted_metadata` artifact JSON for an asset.
* Pending / missing / failed return a safe status with null metadata
* so Inspector can show an empty tech line without throwing (REQ-VIEW-003).
*/
export function getExtractedMetadata(this: LibraryService, input: {
    libraryId: string;
    assetId: string;
  }): ExtractedMetadataResult {
  const openLibrary = this.requireOpenLibrary(input.libraryId);

  const assetRow = openLibrary.connection
    .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
    .get(input.assetId) as { asset_id: string } | undefined;
  if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

  // fonts have no `extracted_metadata` artifact — the facts
  // live in the font file's own `name`/`head`/`OS-2`/`maxp` tables, so they
  // are read on demand (a header parse, not a full decode).
  const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
  if (LibraryService.detectMediaType(absolutePath) === 'font') {
    const fontMetadata = this.readAssetFontMetadata(absolutePath);
    if (!fontMetadata) {
      return {
        assetId: input.assetId,
        status: 'failed',
        metadata: null,
        metadataCompleteness: 'complete',
        errorCode: 'FONT_METADATA_UNREADABLE',
      };
    }
    // Run the partial font facts through the shared schema so the result has
    // exactly the same shape as every other extracted-metadata payload.
    const parsedFont = extractedVideoMetadataSchema.safeParse(
      fontMetadataToExtractedFields(fontMetadata),
    );
    return {
      assetId: input.assetId,
      status: parsedFont.success ? 'ready' : 'failed',
      metadata: parsedFont.success ? parsedFont.data : null,
      metadataCompleteness: 'complete',
      errorCode: parsedFont.success ? null : 'EXTRACTED_METADATA_INVALID',
    };
  }

  const artifact = this.getCurrentArtifact(
    input.libraryId,
    input.assetId,
    'extracted_metadata',
  );
  if (!artifact) {
    return {
      assetId: input.assetId,
      status: 'missing',
      metadata: null,
      metadataCompleteness: 'complete',
      errorCode: null,
    };
  }

  const status =
    artifact.status === 'ready'
      ? 'ready'
      : artifact.status === 'failed'
        ? 'failed'
        : 'pending';

  if (status !== 'ready') {
    return {
      assetId: input.assetId,
      status,
      metadata: null,
      metadataCompleteness: 'complete',
      errorCode: artifact.errorCode,
    };
  }

  try {
    const absPath = this.getArtifactAbsolutePath(
      input.libraryId,
      artifact.artifactId,
    );
    const raw = JSON.parse(readFileSync(absPath, 'utf-8')) as unknown;
    const parsed = extractedVideoMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        assetId: input.assetId,
        status: 'failed',
        metadata: null,
        metadataCompleteness: 'complete',
        errorCode: 'EXTRACTED_METADATA_INVALID',
      };
    }
    return {
      assetId: input.assetId,
      status: 'ready',
      metadata: parsed.data as ExtractedVideoMetadata,
      metadataCompleteness: artifact.generatorVersion.startsWith('image-header@')
        ? 'header-only'
        : 'complete',
      errorCode: null,
    };
  } catch {
    return {
      assetId: input.assetId,
      status: 'failed',
      metadata: null,
      metadataCompleteness: 'complete',
      errorCode: 'EXTRACTED_METADATA_UNREADABLE',
    };
  }
}


export async function listZipEntries(this: LibraryService, input: { libraryId: string; assetId: string }): Promise<{
    assetId: string;
    revisionId: string;
    status: 'ready' | 'unreadable';
    truncated: boolean;
    files: Array<{ index: number; name: string; uncompressedSize: number }>;
  }> {
  const located = this.zipAssetAbsolutePath(input);
  try {
    const listing = await listZipArchiveFiles(located.absolutePath);
    return {
      assetId: input.assetId,
      revisionId: located.revisionId,
      status: listing.status,
      truncated: listing.truncated,
      files: listing.files,
    };
  } catch {
    return {
      assetId: input.assetId,
      revisionId: located.revisionId,
      status: 'unreadable',
      truncated: false,
      files: [],
    };
  }
}

export async function readZipEntry(this: LibraryService, input: { libraryId: string; assetId: string; index: number }): Promise<{
    assetId: string;
    index: number;
    name: string;
    uncompressedSize: number;
    kind: 'image' | 'text' | 'unavailable';
    mimeType?: string;
    bytesBase64?: string;
    text?: string;
    truncated?: boolean;
  }> {
  const located = this.zipAssetAbsolutePath(input);
  const entry = await readZipArchiveEntry(located.absolutePath, input.index);
  if (!entry) {
    return {
      assetId: input.assetId,
      index: input.index,
      name: 'entry',
      uncompressedSize: 0,
      kind: 'unavailable',
    };
  }
  return { assetId: input.assetId, index: input.index, ...entry };
}
