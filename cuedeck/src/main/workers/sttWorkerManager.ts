import { utilityProcess, type UtilityProcess } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TranscriptResult, TranscriptSegment } from '../../shared/domain';
import { CoachError } from '../../shared/errors';
import { readJsonFile, writeJsonFile } from '../storage/jsonFile';

export interface ModelProgress {
  stage: 'downloading' | 'loading';
  file?: string;
  value?: number; // 0..100
}

interface ManifestEntry {
  modelId: string;
  installedAt: string;
  files: Array<{ name: string; bytes: number }>;
}

interface Manifest {
  version: 1;
  models: ManifestEntry[];
}

export interface EnsureModelOptions {
  /**
   * Let Transformers.js fetch missing model files from the network. Only an
   * explicit user download (`models:download`) sets this; warmup and
   * transcription load from disk and fail with MODEL_NOT_INSTALLED instead.
   */
  allowDownload?: boolean;
}

/** One model load in flight, shared by every caller that asked for it. */
interface PendingLoad {
  modelId: string;
  worker: UtilityProcess;
  controller: AbortController;
  waiters: number;
  listeners: Set<{ onProgress: (p: ModelProgress) => void }>;
  promise: Promise<void>;
}

/**
 * Owns the STT utility process and the local model manifest.
 * Cancellation kills the process (which aborts any in-flight download or
 * inference) and the next request respawns it.
 *
 * Model loads are single-flight: callers asking for the model already being
 * loaded join that load instead of restarting it. Each caller's signal only
 * detaches that caller; the load itself (and its worker) is aborted when the
 * last waiter leaves, or when a different model is requested.
 */
const INSTALLED_CACHE_MS = 10_000;

export class SttWorkerManager {
  private worker: UtilityProcess | null = null;
  private loadedModelId: string | null = null;
  private nextRequestId = 1;
  private status: 'idle' | 'loading' | 'ready' = 'idle';
  private pending: PendingLoad | null = null;
  private readonly installedCache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(
    private readonly workerPath: string,
    private readonly modelsDir: string,
  ) {}

  get manifestPath(): string {
    return path.join(this.modelsDir, 'manifest.json');
  }

  async readManifest(): Promise<Manifest> {
    const raw = (await readJsonFile(this.manifestPath).catch(() => null)) as Manifest | null;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.models)) return { version: 1, models: [] };
    return raw;
  }

  /**
   * Installed check = manifest read + one stat per model file. Readiness
   * probes call this for every catalog model, several times per settings
   * change, so results are memoized briefly; installs and removals clear it.
   */
  async isInstalled(modelId: string): Promise<boolean> {
    const cached = this.installedCache.get(modelId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.checkInstalled(modelId);
    this.installedCache.set(modelId, { value, expiresAt: Date.now() + INSTALLED_CACHE_MS });
    return value;
  }

  private async checkInstalled(modelId: string): Promise<boolean> {
    const manifest = await this.readManifest();
    const entry = manifest.models.find((m) => m.modelId === modelId);
    if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) return false;
    // Verify the recorded files are still present with the recorded sizes.
    for (const file of entry.files) {
      try {
        const stat = await fs.stat(path.join(this.modelsDir, file.name));
        if (stat.size !== file.bytes) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async removeModel(modelId: string): Promise<void> {
    this.installedCache.delete(modelId);
    const manifest = await this.readManifest();
    manifest.models = manifest.models.filter((m) => m.modelId !== modelId);
    await writeJsonFile(this.manifestPath, manifest);
    await fs
      .rm(path.join(this.modelsDir, ...modelId.split('/')), { recursive: true, force: true })
      .catch(() => undefined);
    if (this.pending?.modelId === modelId) this.abortLoad(this.pending);
    if (this.loadedModelId === modelId) this.stop();
  }

  getStatus(): { state: string; modelId: string | null } {
    return { state: this.status, modelId: this.loadedModelId };
  }

  private spawn(): UtilityProcess {
    if (this.worker) return this.worker;
    const worker = utilityProcess.fork(this.workerPath, [], { serviceName: 'cuedeck-stt' });
    this.worker = worker;
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.loadedModelId = null;
      this.status = 'idle';
    });
    return worker;
  }

  /** Kill the worker (freeing model memory); the next request respawns it. */
  stop(): void {
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    this.loadedModelId = null;
    this.status = 'idle';
  }

  /**
   * Ensure the model is loaded in the worker. Progress is reported through
   * `onProgress`. A load of the same model already in flight is joined; a
   * load of a different model is aborted (its waiters reject with an
   * AbortError) and replaced. `signal` detaches only this caller; the load
   * is aborted and its worker killed when the last waiter detaches.
   *
   * `options.allowDownload` (default false) is fixed by whoever starts the
   * load: a caller that joins an in-flight load inherits its policy. So a
   * download joining a warmup of the same model loads from disk only (and
   * fails with MODEL_NOT_INSTALLED if files are missing), and a warmup
   * joining a download waits for that download.
   *
   * Invariant: on any failure the half-loaded worker is killed (unless a
   * newer load already replaced it), so `getStatus` never sticks at
   * 'loading' and the next request starts from a clean process.
   */
  async ensureModel(
    modelId: string,
    onProgress: (p: ModelProgress) => void,
    signal: AbortSignal,
    options: EnsureModelOptions = {},
  ): Promise<void> {
    if (this.loadedModelId === modelId && this.status === 'ready') return;
    // 'abort' does not fire for an already-aborted signal, so check first.
    if (signal.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError');
    let load = this.pending;
    if (!load || load.modelId !== modelId) {
      if (load)
        this.abortLoad(load, new DOMException('replaced by a different model load', 'AbortError'));
      load = this.startLoad(modelId, options.allowDownload === true);
    }
    return this.join(load, onProgress, signal);
  }

  /** Abort a load: its waiters reject, and its worker is killed if still current. */
  private abortLoad(load: PendingLoad, reason?: unknown): void {
    if (this.pending === load) this.pending = null;
    load.controller.abort(reason ?? new DOMException('aborted', 'AbortError'));
    if (this.worker === load.worker) this.stop();
  }

  private startLoad(modelId: string, allowDownload: boolean): PendingLoad {
    this.stop();
    const worker = this.spawn();
    this.status = 'loading';
    const load: PendingLoad = {
      modelId,
      worker,
      controller: new AbortController(),
      waiters: 0,
      listeners: new Set(),
      promise: Promise.resolve(),
    };
    load.promise = this.loadInto(load, allowDownload);
    const clear = () => {
      if (this.pending === load) this.pending = null;
    };
    // Also marks the rejection handled when every waiter has already left.
    load.promise.then(clear, clear);
    this.pending = load;
    return load;
  }

  /** Wait on a shared load; this caller's abort detaches only this caller. */
  private join(
    load: PendingLoad,
    onProgress: (p: ModelProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const entry = { onProgress };
    load.waiters++;
    load.listeners.add(entry);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const detach = () => {
        settled = true;
        signal.removeEventListener('abort', onAbort);
        load.listeners.delete(entry);
        load.waiters--;
      };
      const onAbort = () => {
        if (settled) return;
        detach();
        // Only the last waiter leaving aborts the shared load.
        if (load.waiters === 0) this.abortLoad(load);
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      load.promise.then(
        () => {
          if (settled) return;
          detach();
          resolve();
        },
        (err: unknown) => {
          if (settled) return;
          detach();
          reject(err);
        },
      );
    });
  }

  /** Post the load to the load's worker and wait for it to finish. */
  private async loadInto(load: PendingLoad, allowDownload: boolean): Promise<void> {
    const { modelId, worker } = load;
    const signal = load.controller.signal;
    try {
      const wasInstalled = await this.isInstalled(modelId);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          cleanup();
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        };
        const onMessage = (event: { data?: unknown } | unknown) => {
          const msg = ((event as { data?: unknown }).data ?? event) as Record<string, unknown>;
          if (msg.type === 'load-progress') {
            const progress: ModelProgress = {
              stage: wasInstalled ? 'loading' : 'downloading',
              file: typeof msg.file === 'string' ? msg.file : undefined,
              value: typeof msg.progress === 'number' ? msg.progress : undefined,
            };
            for (const listener of [...load.listeners]) listener.onProgress(progress);
          } else if (msg.type === 'loaded') {
            cleanup();
            resolve();
          } else if (msg.type === 'load-error') {
            cleanup();
            reject(
              new CoachError('MODEL_NOT_INSTALLED', String(msg.detail ?? 'model load failed')),
            );
          }
        };
        const onExit = () => {
          cleanup();
          reject(new CoachError('MODEL_NOT_INSTALLED', 'model worker exited during load'));
        };
        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
          worker.removeListener('message', onMessage as never);
          worker.removeListener('exit', onExit);
        };
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        worker.on('message', onMessage as never);
        worker.on('exit', onExit);
        worker.postMessage({ type: 'load', modelId, cacheDir: this.modelsDir, allowDownload });
      });
      if (signal.aborted || this.worker !== worker) {
        throw signal.reason ?? new DOMException('aborted', 'AbortError');
      }
      this.loadedModelId = modelId;
      this.status = 'ready';
      if (!wasInstalled) await this.recordInstall(modelId);
    } catch (err) {
      if (this.worker === worker) this.stop();
      throw err;
    }
  }

  private async recordInstall(modelId: string): Promise<void> {
    const files: Array<{ name: string; bytes: number }> = [];
    const modelDir = path.join(this.modelsDir, ...modelId.split('/'));
    const walk = async (dir: string): Promise<void> => {
      let entries: Array<{ name: string; isDirectory(): boolean }> = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full);
          files.push({ name: path.relative(this.modelsDir, full), bytes: stat.size });
        }
      }
    };
    await walk(modelDir);
    const manifest = await this.readManifest();
    manifest.models = manifest.models.filter((m) => m.modelId !== modelId);
    manifest.models.push({ modelId, installedAt: new Date().toISOString(), files });
    await writeJsonFile(this.manifestPath, manifest);
    this.installedCache.delete(modelId);
  }

  /**
   * Transcribe Float32 PCM in the worker (loading the model first if
   * needed). Abort kills the worker process — the only way to interrupt an
   * in-flight inference — and the next request respawns it.
   */
  async transcribe(input: {
    audio: Float32Array;
    modelId: string;
    language?: string;
    signal: AbortSignal;
    onProgress: (p: ModelProgress) => void;
  }): Promise<TranscriptResult> {
    // Never downloads: a model missing from disk fails with MODEL_NOT_INSTALLED.
    await this.ensureModel(input.modelId, input.onProgress, input.signal);
    // A load of a different model may have replaced the worker meanwhile.
    if (this.loadedModelId !== input.modelId)
      throw new CoachError('MODEL_NOT_INSTALLED', 'model worker replaced');
    const worker = this.worker;
    if (!worker) throw new CoachError('MODEL_NOT_INSTALLED', 'model worker unavailable');
    const id = this.nextRequestId++;
    return new Promise<TranscriptResult>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        // Only kill our own worker; a newer request may have replaced it.
        if (this.worker === worker) this.stop();
        reject(input.signal.reason ?? new DOMException('aborted', 'AbortError'));
      };
      const onMessage = (event: { data?: unknown } | unknown) => {
        const msg = ((event as { data?: unknown }).data ?? event) as Record<string, unknown>;
        if (msg.type === 'transcript' && msg.id === id) {
          cleanup();
          resolve({
            text: String(msg.text ?? ''),
            segments: (msg.segments as TranscriptSegment[] | undefined) ?? undefined,
          });
        } else if (msg.type === 'transcribe-error' && msg.id === id) {
          cleanup();
          reject(
            new CoachError('PROVIDER_UNAVAILABLE', String(msg.detail ?? 'transcription failed')),
          );
        }
      };
      const onExit = () => {
        cleanup();
        reject(new CoachError('PROVIDER_UNAVAILABLE', 'model worker exited'));
      };
      const cleanup = () => {
        input.signal.removeEventListener('abort', onAbort);
        worker.removeListener('message', onMessage as never);
        worker.removeListener('exit', onExit);
      };
      // 'abort' does not fire for an already-aborted signal, so check first;
      // otherwise a pre-cancelled session would run a full inference.
      if (input.signal.aborted) {
        reject(input.signal.reason ?? new DOMException('aborted', 'AbortError'));
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
      worker.on('message', onMessage as never);
      worker.on('exit', onExit);
      worker.postMessage({ type: 'transcribe', id, audio: input.audio, language: input.language });
    });
  }
}
