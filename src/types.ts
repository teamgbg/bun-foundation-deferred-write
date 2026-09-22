/**
 * @system deferred-write
 * @status handwritten
 * @edit edit directly
 *
 * Type contracts for @teamscala/deferred-write. The primitive accepts
 * writes on the hot path (returns immediately), batches them in an
 * in-memory buffer, and flushes in the background — closing the
 * canonical pattern from constitution
 * `deferred-write-is-the-only-hot-path-log`.
 */

export interface DeferredWriteStats {
	name: string;
	bufferSize: number;
	enqueuedTotal: number;
	flushedTotal: number;
	failedFlushes: number;
	lastFlushAt: number | null;
	lastFlushDurationMs: number | null;
	lastFlushedCount: number;
	pendingRetries: number;
	enabled: boolean;
}

export type DeferredWriteEventKind =
	| "enqueued"
	| "flushed"
	| "flush-failed"
	| "drained"
	| "buffer-full"
	| "disabled"
	| "enabled";

export interface DeferredWriteEvent {
	writer: string;
	kind: DeferredWriteEventKind;
	count?: number;
	durationMs?: number;
	error?: string;
}

export interface DeferredWriteOptions<T> {
	/** Unique name in the process. `<package>:<purpose>` convention. */
	name: string;
	/**
	 * Called with a non-empty batch on flush. Throwing keeps the entries
	 * in the buffer for retry; resolve === success.
	 */
	flush: (entries: T[], ctx: unknown) => Promise<void>;
	/** Periodic flush cadence. Default: 5_000 ms. */
	flushIntervalMs?: number;
	/** Auto-flush trigger when buffer hits this size. Default: 100. */
	maxBufferSize?: number;
	/**
	 * Absolute ceiling on per-entry age before forcing a flush. Default:
	 * 30_000 ms. Prevents starvation of the oldest entry when sustained
	 * writes never hit `maxBufferSize`.
	 */
	maxBufferAgeMs?: number;
	/**
	 * Hard cap on buffered entries. When exceeded, OLDEST entry is
	 * dropped to make room — emit("buffer-full"). Default: 10_000.
	 * Prevents unbounded memory growth when flush is broken.
	 */
	hardBufferLimit?: number;
	/** Optional event sink for observability. */
	emit?: (event: DeferredWriteEvent) => void;
	/** Initial enabled state. `false` makes enqueue() a no-op. Default: true. */
	enabled?: boolean;
}
