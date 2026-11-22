import { IMPORTED_THUMBNAIL_GENERATOR_PREFIX, IMPORTED_THUMBNAIL_NORMALIZATION_JOB } from './imported-thumbnail-policy';
import { default as path } from 'node:path';
import { type MediaNativeMemoryEstimate } from './media-memory-budget';
import type { MediaExecutionContext } from './media-process';
import { lstat as lstatAsync } from 'node:fs/promises';
import { readImageDimensions } from './image-dimensions';
import { AUDIO_WAVEFORM_COVER_GENERATOR_TAG } from '../../shared/audio-media';
import { openSync, readSync, closeSync } from 'node:fs';
import { MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE } from './media-resource-guard';
import { type IcoPageSize, parseIcoPageSizes } from './ico-page';

/**
 * Media generator ids, tool versions, job kinds and small media helpers (EXR planes, ICO sizes, ffmpeg arguments).
 */
export const SHARP_VERSION = '0.35.3';

/** Bumped when GIF still-page selection changes so stale black page-0 thumbs requeue. */
export const SHARP_THUMBNAIL_GENERATOR = `sharp@${SHARP_VERSION}-gifstill1`;

/** RAW cards may use a bounded embedded JPEG instead of demosaicing the sensor frame. */
export const RAW_EMBEDDED_THUMBNAIL_GENERATOR = `raw-embedded-jpeg@1;sharp@${SHARP_VERSION};max=512`;

/** Eagle/Billfish imports publish a copy immediately, then normalize in the background. */
export const IMPORTED_THUMBNAIL_GENERATOR = `${IMPORTED_THUMBNAIL_GENERATOR_PREFIX};sharp@${SHARP_VERSION};max=512;still1`;

/** Animated imported previews stay byte-for-byte intact but still need a durable completion marker. */
export const IMPORTED_ANIMATED_THUMBNAIL_GENERATOR = `${IMPORTED_THUMBNAIL_GENERATOR_PREFIX};preserved-animated@1`;

export function isTiffExtension(extensionOrFileName: string): boolean {
  const extension = extensionOrFileName.startsWith('.')
    ? extensionOrFileName.toLowerCase()
    : path.extname(extensionOrFileName).toLowerCase();
  return extension === '.tif' || extension === '.tiff';
}

export type MediaNativeMemoryEstimateInput = Omit<MediaNativeMemoryEstimate, 'decoder'>;

export async function inspectMediaNativeInput(
  assetPath: string,
  execution: MediaExecutionContext,
): Promise<MediaNativeMemoryEstimateInput> {
  let sourceByteSize = execution.sourceByteSize;
  if (!Number.isSafeInteger(sourceByteSize) || sourceByteSize! <= 0) {
    try {
      sourceByteSize = Number((await lstatAsync(assetPath)).size);
    } catch {
      sourceByteSize = null;
    }
  }

  let sourceWidth = execution.sourceWidth;
  let sourceHeight = execution.sourceHeight;
  if (
    !Number.isSafeInteger(sourceWidth)
    || !Number.isSafeInteger(sourceHeight)
    || sourceWidth! <= 0
    || sourceHeight! <= 0
  ) {
    const dimensions = await readImageDimensions(assetPath);
    sourceWidth = dimensions?.width ?? null;
    sourceHeight = dimensions?.height ?? null;
  }

  return { sourceByteSize, width: sourceWidth, height: sourceHeight };
}

// A generator writes the final artifact before committing its DB row. Keep
// recently-created unreferenced files out of the open-time sweep so a live
// media job cannot be mistaken for a crash orphan; the next reconciliation
// will remove it if it never becomes referenced.
export const ORPHAN_ARTIFACT_GRACE_MS = 5 * 60_000;

/**
 * the current browse/search page size
 * (BROWSE_PAGE_SIZE = 100). The `visible` thumbnail wave must cover the
 * window the user is looking at so a freshly imported library shows the
 * current page first while the import flood (mutation 300) fills in behind.
 * Bounded: a page is never more than this many assets, so the visible wave
 * cannot starve the rest of the catalogue.
 */
export const THUMBNAIL_VISIBLE_PAGE_SIZE = 100;

export const OIIO_VERSION = '3.1.12.0';

export const FFMPEG_VERSION = '8.1';

/**
 * media jobs run under full-decoder CPU saturation, where the
 * single Worker thread can stall well past a 15s lease between heartbeat
 * ticks. Media-job leases use their own longer window (heartbeat = 1/3 of it)
 * so transient stalls don't fail-and-requeue live work. Scoped to media jobs
 * on purpose: the writer lease keeps its short window for fast crash
 * reclaim.
 */
export const MEDIA_JOB_LEASE_DURATION_MS = 60_000;

export const MEDIA_RESOURCE_RETRY_DELAY_MS = 30_000;

export const RAW_IMAGE_METADATA_RETRY_DELAY_MS = 30_000;

export const RAW_IMAGE_METADATA_MAX_ATTEMPTS = 3;

export const EMBEDDED_IMAGE_METADATA_GENERATOR = 'exifr@7.1.3;embedded-image-metadata-v2';

export const FFMPEG_METADATA_GENERATOR = `ffprobe@${FFMPEG_VERSION};embedded-metadata-v1`;

/** Opaque ≈4:3 light-stage covers; stale strip/dark covers requeue. */
export const AUDIO_WAVEFORM_GENERATOR = `ffmpeg@${FFMPEG_VERSION}+${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}`;

export const VIDEO_PROXY_SCALE_FILTER =
  'scale=w=min(720\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2';

export type VideoProxyProfile = {
  codec: 'h264';
  encoder: string;
  extension: 'mp4' | 'webm';
  mimeType: 'video/mp4' | 'video/webm';
  args: string[];
};

export const KEEL_OCIO_CONFIG = 'ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5';

/**
 * Escape a local path before embedding it in an FFmpeg filtergraph option.
 *
 * FFmpeg parses filter options after the process has already received the
 * argument, so passing a Windows path as a normal argv value is not enough:
 * the drive-letter colon is treated as an option separator and backslashes
 * are interpreted as filter escapes. Normalising separators and escaping the
 * remaining filter metacharacters keeps bundled font paths valid on both
 * Windows and POSIX.
 */
export const DISPLAY_PREVIEW_KIND_SQL = `CASE
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
          END`;

/** One browser-paintable preview per asset. JPEG wins over a 16-bit PNG sibling. */
export function pngBitDepth(filePath: string): number | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const header = Buffer.alloc(26);
    if (readSync(fd, header, 0, header.length, 0) < header.length) return null;
    if (header.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') return null;
    if (header.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return header[24] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function singleDisplayArtifactJoin(alias: string, statusSql: string): string {
  // Prefer a ready display artifact over a later failed/pending row so a
  // terminal model-thumbnail failure stays visible without hiding a good card.
  const statusRank = statusSql.includes('chosen.status')
    ? `CASE chosen.status
                WHEN 'ready' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'generating' THEN 1
                WHEN 'failed' THEN 2
                ELSE 3
              END,`
    : '';
  return `LEFT JOIN revision_artifacts ${alias}
           ON ${alias}.artifact_id = (
             SELECT chosen.artifact_id
               FROM revision_artifacts chosen
              WHERE chosen.revision_id = a.current_revision_id
                AND chosen.kind = ${DISPLAY_PREVIEW_KIND_SQL}
                ${statusSql}
                AND chosen.invalidated_at IS NULL
              ORDER BY ${statusRank}
              CASE chosen.mime_type
                WHEN 'image/jpeg' THEN 0
                WHEN 'image/webp' THEN 1
                WHEN 'image/png' THEN 2
                ELSE 3
              END,
              chosen.rowid DESC
              LIMIT 1
           )`;
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

/**
 * Keep decoder and filter threads bounded for every bundled FFmpeg invocation.
 * Encoder-specific `-threads` settings remain untouched; this only adds the
 * input decoder and filter limits before the first `-i`. ffprobe is excluded
 * because it does not decode a video frame in these call sites.
 */
export function constrainFfmpegDecoderArgs(command: string, args: string[]): string[] {
  const executable = path.basename(command).toLowerCase();
  if (executable.includes('ffprobe')) return args;
  const inputIndex = args.indexOf('-i');
  if (inputIndex < 0) return args;
  const hasDecoderThreads = args.some((arg, index) => arg === '-threads:v' && index + 1 < args.length);
  const hasFilterThreads = args.some((arg, index) => arg === '-filter_threads' && index + 1 < args.length);
  const hasComplexFilterThreads = args.some((arg, index) => arg === '-filter_complex_threads' && index + 1 < args.length);
  const limits: string[] = [];
  if (!hasDecoderThreads) limits.push('-threads:v', '1');
  if (!hasFilterThreads) limits.push('-filter_threads', '1');
  if (!hasComplexFilterThreads) limits.push('-filter_complex_threads', '1');
  return limits.length === 0
    ? args
    : [...args.slice(0, inputIndex), ...limits, ...args.slice(inputIndex)];
}

export const MEDIA_JOB_KINDS = [
  'generate_thumbnail',
  'generate_video_poster',
  'extract_metadata',
  'generate_contact_sheet',
  'generate_webm_proxy',
  'generate_audio_proxy',
  'extract_palette',
] as const;

export type MediaJobKind = (typeof MEDIA_JOB_KINDS)[number];

export type SecondaryMediaJobKind = Exclude<MediaJobKind, 'generate_thumbnail' | 'generate_video_poster'>;

export type MediaJobStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

export function safeMediaJobErrorDetail(errorCode: string): string {
  switch (errorCode) {
    case MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE:
      return 'The system is under memory pressure. Media previews will retry after the load settles.';
    case 'FFMPEG_REQUIRED':
      return 'The media component needed for video thumbnails is unavailable. Reinstall or repair Keel.';
    case 'OIIO_REQUIRED':
      return 'The OpenImageIO component is unavailable. Reinstall or repair Keel.';
    case 'STALE_REVISION':
      return 'The source changed before media processing finished. Retry the current revision.';
    case 'RAW_METADATA_EXTRACTION_FAILED':
      return 'Camera metadata extraction failed; the job will retry after a backoff.';
    case 'PALETTE_SOURCE_NOT_READY':
      return 'The current preview image is not ready. Regenerate the thumbnail or video poster first.';
    case 'PALETTE_EXTRACTION_FAILED':
      return 'Local palette extraction failed. See the local Keel log for diagnostic details.';
    case IMPORTED_THUMBNAIL_NORMALIZATION_JOB:
      return 'The imported preview could not be normalized. The original imported preview remains available.';
    default:
      return 'Media processing failed. See the local Keel log for diagnostic details.';
  }
}

export type OiioArtifactErrorCode =
  | 'OIIO_REQUIRED'
  | 'OIIO_COLOR_TRANSFORM_FAILED'
  | 'OIIO_GENERATION_FAILED';

export type ExrPlaneDescriptor = {
  index: number;
  label: string;
};

/**
 * `oiiotool --info -v -a` reports each EXR part as `subimage N`. Depending on
 * the OIIO version and EXR writer, the name is either on that header in
 * parentheses or in a following `name:`/`oiio:subimagename:` metadata line.
 * Keep the parser deliberately conservative: an unfamiliar OIIO build still
 * gets a usable Part 0 preview rather than a guessed channel name.
 */
export function parseExrPlaneDescriptors(output: string): ExrPlaneDescriptor[] {
  const planes = new Map<number, { index: number; name?: string }>();
  let currentIndex: number | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const header = /^\s*subimage\s+(\d+)(?:\s*\(([^)]+)\))?\s*:?/iu.exec(line);
    if (header) {
      const index = Number(header[1]);
      if (!Number.isSafeInteger(index) || index < 0) {
        currentIndex = null;
        continue;
      }
      const name = header[2]?.trim();
      planes.set(index, { index, ...(name ? { name } : {}) });
      currentIndex = index;
      continue;
    }

    if (currentIndex === null) continue;
    const metadataName = /^\s*(?:name|oiio:subimagename):\s*"([^"]+)"\s*$/iu.exec(line);
    const name = metadataName?.[1]?.trim();
    if (name) planes.set(currentIndex, { index: currentIndex, name });
  }
  return planes.size > 0
    ? [...planes.values()]
      .sort((left, right) => left.index - right.index)
      .map(({ index, name }) => ({
        index,
        label: name ? `Part ${index}: ${name}` : `Part ${index}`,
      }))
    : [{ index: 0, label: 'Part 0' }];
}

export function readIcoPageSizesFromPath(assetPath: string): IcoPageSize[] {
  const handle = openSync(assetPath, 'r');
  try {
    const header = Buffer.alloc(6);
    if (readSync(handle, header, 0, header.length, 0) !== header.length) return [];
    const count = header.readUInt16LE(4);
    // An ICO directory is tiny. Guard the allocation if a malformed file
    // contains an unreasonable entry count.
    if (count === 0 || count > 1024) return [];
    const directory = Buffer.alloc(6 + count * 16);
    header.copy(directory, 0);
    if (readSync(handle, directory, 6, count * 16, 6) !== count * 16) return [];
    return parseIcoPageSizes(directory);
  } finally {
    closeSync(handle);
  }
}

export class OiioInvocationError extends Error {
  constructor(
    readonly artifactErrorCode: OiioArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OiioInvocationError';
  }
}
