import { execFileSync, type ChildProcess, spawn } from 'node:child_process';
import { resolveFfmpegPath, resolveFfprobePath, resolveOiiotoolPath } from './binary-resolver';
import { workerMediaDecodeConcurrency, workerMediaInteractiveDecodeConcurrency } from './media-concurrency';
import { type MediaNativeMemoryEstimate, estimateMediaNativeMemoryBytes, mediaNativeMemoryBudget } from './media-memory-budget';

/**
 * Media child processes (spawn with bounded output, shutdown), decoder concurrency and media-job logging, shared by the Library Service media methods.
 */
/** Result of a subprocess (ffmpeg, ffprobe, oiiotool) invocation. */
export interface SpawnResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

/** Injectable subprocess spawn function for testing. */
export type SpawnFunction = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<SpawnResult>;

export type MediaAutoRepairComponent = 'ffmpeg' | 'oiio';

export const MEDIA_COMPONENT_PROBE_TIMEOUT_MS = 2_500;

export const MEDIA_COMPONENT_PROBE_RETRY_MS = 30_000;

/**
 * Check the external media environment without starting a persistent media
 * job. This is intentionally a small capability probe: the actual generator
 * remains the source of truth for codec/filter compatibility.
 */
export function defaultMediaComponentProbe(component: MediaAutoRepairComponent): boolean {
  const canRun = (command: string, args: string[]): boolean => {
    try {
      execFileSync(command, args, {
        stdio: 'ignore',
        timeout: MEDIA_COMPONENT_PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  };

  if (component === 'ffmpeg') {
    return canRun(resolveFfmpegPath(), ['-version'])
      && canRun(resolveFfprobePath(), ['-version']);
  }
  return canRun(resolveOiiotoolPath(), ['--help']);
}

export const SPAWN_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;

export const SPAWN_STDERR_LIMIT_BYTES = 512 * 1024;

export class TailBuffer {
  private chunks: Buffer[] = [];
  private length = 0;

  constructor(private readonly limitBytes: number) {}

  append(chunk: Buffer): void {
    if (chunk.length >= this.limitBytes) {
      this.chunks = [chunk.subarray(chunk.length - this.limitBytes)];
      this.length = this.limitBytes;
      return;
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.limitBytes) {
      const first = this.chunks[0]!;
      const excess = this.length - this.limitBytes;
      if (first.length <= excess) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.length -= excess;
      }
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.length);
  }
}

export const activeMediaProcesses = new Set<ChildProcess>();

export function killMediaProcess(processHandle: ChildProcess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  if (processHandle.exitCode !== null) return;
  try {
    processHandle.kill(signal);
  } catch {
    // The process may have exited between the exitCode check and kill().
  }
}

/**
 * Terminate every real media child owned by this Worker. The Worker can be
 * asked to shut down while a queue promise is between awaits, so aborting the
 * job controller alone is not enough to prevent an ffmpeg orphan.
 */
export async function shutdownActiveMediaProcesses(timeoutMs = 1_000): Promise<void> {
  const processes = [...activeMediaProcesses];
  if (processes.length === 0) return;

  const closed = processes.map((processHandle) => new Promise<void>((resolve) => {
    if (processHandle.exitCode !== null) {
      resolve();
      return;
    }
    processHandle.once('close', () => resolve());
  }));
  for (const processHandle of processes) killMediaProcess(processHandle);
  await Promise.race([
    Promise.all(closed),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  for (const processHandle of [...activeMediaProcesses]) {
    killMediaProcess(processHandle, 'SIGKILL');
  }
}

/**
 * Keep Worker shutdown ordering testable: terminate external media children,
 * let the service abort/close its active jobs, then catch children that raced
 * the first pass.
 */
export async function shutdownWorkerResources(
  closeAllAsync: (timeoutMs: number) => Promise<void>,
  shutdownMediaProcesses: (timeoutMs: number) => Promise<void> = shutdownActiveMediaProcesses,
  timeoutMs = 500,
): Promise<void> {
  await shutdownMediaProcesses(timeoutMs);
  await closeAllAsync(timeoutMs);
  await shutdownMediaProcesses(timeoutMs);
}

/** Real subprocess spawn (child_process.spawn with defaults). */
export function defaultSpawnFn(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new DOMException('Media job was cancelled before the subprocess started.', 'AbortError'));
      return;
    }
    // Local media work has no honest wall-clock deadline: decode time depends
    // on the source and the user's filesystem. Only callers with an explicit
    // lifecycle/security reason may opt into a deadline.
    const timeoutMs = options?.timeoutMs;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const proc: ChildProcess = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeMediaProcesses.add(proc);

    const timer = timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        timedOut = true;
        killMediaProcess(proc);
        // Escalate to SIGKILL after 5s if still running.
        killTimer = setTimeout(() => killMediaProcess(proc, 'SIGKILL'), 5_000);
        killTimer.unref();
      }, timeoutMs);
    timer?.unref();

    const abort = (): void => {
      if (settled || aborted) return;
      aborted = true;
      killMediaProcess(proc);
      killTimer = setTimeout(() => killMediaProcess(proc, 'SIGKILL'), 5_000);
      killTimer.unref();
    };
    options?.signal?.addEventListener('abort', abort, { once: true });

    const stdoutTail = new TailBuffer(SPAWN_STDOUT_LIMIT_BYTES);
    const stderrTail = new TailBuffer(SPAWN_STDERR_LIMIT_BYTES);

    proc.stdout?.on('data', (chunk: Buffer) => stdoutTail.append(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrTail.append(chunk));

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options?.signal?.removeEventListener('abort', abort);
      activeMediaProcesses.delete(proc);
      settled = true;
      reject(err);
    });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options?.signal?.removeEventListener('abort', abort);
      activeMediaProcesses.delete(proc);
      settled = true;
      if (aborted) {
        reject(new DOMException('Media job cancelled; subprocess terminated.', 'AbortError'));
        return;
      }
      resolve({
        stdout: stdoutTail.toBuffer(),
        stderr: stderrTail.toBuffer().toString('utf-8'),
        exitCode: code ?? (timedOut ? -1 : (proc.signalCode ? -1 : 0)),
      });
    });
  });
}

export class AsyncSemaphore {
  private active = 0;
  private readonly waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  hasIdleCapacity(): boolean {
    return this.active < this.limit;
  }

  async run<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new DOMException('Media job cancelled.', 'AbortError');
      return await task();
    } finally {
      release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Media job cancelled.', 'AbortError'));
    }
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    return new Promise((resolve, reject) => {
      const waiter: {
        resolve: (release: () => void) => void;
        reject: (error: unknown) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DOMException('Media job cancelled while waiting for a decoder.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiting.push(waiter);
    });
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiting.length > 0) {
        const waiter = this.waiting.shift()!;
        waiter.signal?.removeEventListener('abort', waiter.abort!);
        if (waiter.signal?.aborted) {
          waiter.reject(new DOMException('Media job cancelled while waiting for a decoder.', 'AbortError'));
          continue;
        }
        waiter.resolve(this.releaseFactory());
        return;
      }
      this.active -= 1;
    };
  }
}

// A Library Worker may own several open libraries. These module-level gates
// therefore cap decoder pressure across all LibraryService instances and all
// libraries in the process, not merely within one queue drain.
// Image decode gets a small hard-capped pool; physical CPU topology may only
// reduce it on single-core machines, never expand native memory pressure.
// FFmpeg concurrency adapts to current system memory; OIIO remains single-flight
// because its frame buffers are large.
export const MEDIA_DECODE_CONCURRENCY = workerMediaDecodeConcurrency();

export const MEDIA_INTERACTIVE_DECODE_CONCURRENCY = workerMediaInteractiveDecodeConcurrency();

// Background image work remains limited to the original two slots. Two extra
// process-wide Sharp slots are available only to the interactive image lane;
// the native gate keeps background + interactive work at most the interactive
// cap even when more than one library is open.
export const sharpNativeDecoderSemaphore = new AsyncSemaphore(MEDIA_INTERACTIVE_DECODE_CONCURRENCY);

export const sharpDecoderSemaphore = new AsyncSemaphore(MEDIA_DECODE_CONCURRENCY);

export const interactiveSharpDecoderSemaphore = new AsyncSemaphore(MEDIA_INTERACTIVE_DECODE_CONCURRENCY);

export const oiioDecoderSemaphore = new AsyncSemaphore(1);

/** True when a visible/viewer Sharp job can start without aborting a running background decode. */
export function hasIdleForegroundImageSlot(): boolean {
  return interactiveSharpDecoderSemaphore.hasIdleCapacity()
    && sharpNativeDecoderSemaphore.hasIdleCapacity();
}

export type MediaDecodeLane = 'background' | 'interactive';

export function runSharpDecoder<T>(
  signal: AbortSignal | undefined,
  lane: MediaDecodeLane | undefined,
  task: () => Promise<T>,
  memory?: Omit<MediaNativeMemoryEstimate, 'decoder'>,
): Promise<T> {
  const laneSemaphore = lane === 'interactive'
    ? interactiveSharpDecoderSemaphore
    : sharpDecoderSemaphore;
  const memoryBytes = estimateMediaNativeMemoryBytes({ decoder: 'sharp', ...memory });
  return mediaNativeMemoryBudget.run(
    signal,
    memoryBytes,
    () => sharpNativeDecoderSemaphore.run(signal, () => laneSemaphore.run(signal, task)),
  );
}

export const MEDIA_QUEUE_LOG = process.env.KEEL_MEDIA_QUEUE_LOG === '1';

// 摘要命中/重算必须可观测，否则「面板关闭时不再全表扫描」无法作为
// 验收证据。与其它命令级诊断共用同一个开关（benchmark 已默认打开）。
export const JOB_SUMMARY_LOG = process.env.KEEL_WORKER_CMD_LOG === '1';

// 诊断用开关：置 0 即回到「每次读取都重算」的旧行为，用于同树 A/B 归因（生产不设即启用缓存）。
export const JOB_SUMMARY_CACHE_ENABLED = process.env.KEEL_JOB_SUMMARY_CACHE !== '0';

export function logMediaJobSummaryEvent(context: Record<string, unknown>): void {
  if (!JOB_SUMMARY_LOG) return;
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: 'media.job-summary',
    ...context,
  }));
}

export function logMediaQueueEvent(
  stage: string,
  context: Record<string, unknown>,
): void {
  if (!MEDIA_QUEUE_LOG) return;
  try {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: 'worker.media-queue',
      // AppLogger keeps the structured `context` object when forwarding Worker
      // stderr and intentionally drops sibling fields. Keep the phase inside
      // that object so queue diagnostics retain their correlation point.
      context: { mediaStage: stage, ...context },
    }));
  } catch {
    // Diagnostic logging must never affect media queue correctness.
  }
}

/**
 * A media wave may claim many jobs while native decoders are completing. Keep
 * the SQLite owner responsive between claims so interactive browse/page
 * messages can enter the Worker instead of waiting behind a microtask chain.
 * The first claim remains immediate; subsequent claims pay one event-loop
 * checkpoint, which is negligible beside real decoding and bounded DB work.
 */
export function yieldBetweenMediaClaims(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface MediaExecutionContext {
  signal?: AbortSignal;
  /** Video metadata has a durable queue job and may share a poster probe. */
  includeVideoMetadata?: boolean;
  /** Queue-owned RAW metadata is a separate low-priority durable job. */
  includeRawMetadata?: boolean;
  /** Visible image cards may use the bounded interactive Sharp lane. */
  lane?: MediaDecodeLane;
  /** Source facts already read during queue admission; avoids a second probe. */
  sourceByteSize?: number | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}

export interface VideoProbeResult {
  durationSec: number;
  width: number | null;
  height: number | null;
  hasAttachedPicture: boolean;
}

export function throwIfMediaExecutionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Media operation aborted.');
  }
}

export async function waitForSharedMediaOperation<T>(
  entry: {
    controller: AbortController;
    promise: Promise<T>;
    waiters: number;
  },
  signal: AbortSignal | undefined,
): Promise<T> {
  entry.waiters += 1;
  try {
    if (!signal) return await entry.promise;
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Media operation aborted.');
    }
    return await new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error('Media operation aborted.'));
      };
      const cleanup = (): void => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  } finally {
    entry.waiters -= 1;
    if (entry.waiters === 0 && !entry.controller.signal.aborted) {
      entry.controller.abort(new Error('All media operation waiters cancelled.'));
    }
  }
}

/**
 * Slice E: offscreen model-thumbnail renderer contract. The
 * Worker stays the queue/artifact owner; Main (via worker/index.ts) performs
 * the GPU render. `errorCode` may carry a MODEL_* code (render failure) or an
 * FBX_* code (conversion failure that preceded the render) — both are
 * benign-suppressed for the card (thumbnail-support.ts).
 */
export type ModelThumbnailRenderOutcome =
  | {
      status: 'ok';
      pngBytes: Uint8Array;
      width: number;
      height: number;
    }
  | {
      status: 'ok';
      frames: Array<{
        view: [number, number, number];
        pngBytes: Uint8Array;
        width: number;
        height: number;
      }>;
    }
  | {
      status: 'failed';
      errorCode: string;
      reason?: string;
    };

export interface ModelThumbnailRendererInput {
  libraryId: string;
  assetId: string;
  revisionId: string;
  relativeFilePath: string;
  byteSize: number | null;
  signal: AbortSignal;
  /** Multi-view render (AI four views) — omitted for the single thumbnail. */
  views?: ReadonlyArray<readonly [number, number, number]>;
}
