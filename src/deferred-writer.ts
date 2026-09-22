/**
 * @system deferred-write
 * @status handwritten
 * @edit edit directly
 *
 * DeferredWriter<T> — hot-path-safe batched write surface. THE
 * canonical answer per constitution
 * `deferred-write-is-the-only-hot-path-log`. Closes the daemon-perf
 * class where blocking log writes dominate request latency.
 *
 * Contract:
 *   - enqueue(entry) — sub-µs in-memory push, never blocks the caller
 *   - background flush — periodic OR when buffer hits maxBufferSize OR
 *     when oldest entry exceeds maxBufferAgeMs
 *   - flush failures keep entries in the buffer for retry; no data
 *     loss as long as drain() runs on shutdown
 *   - hardBufferLimit drops OLDEST entries if the flush is permanently
 *     broken — prevents OOM
 *
 * Lifecycle:
 *   created (timer running) → enqueue/flush loop → drain() → stopped
 *
 * Shutdown:
 *   - drain() awaits the next flush, blocks until buffer is empty
 *   - must be wired into SIGTERM/SIGINT handlers by the consumer
 */

import type {
	DeferredWriteEvent,
	DeferredWriteOptions,
	DeferredWriteStats,
} from "./types.ts";

interface BufferEntry<T> {
	value: T;
	enqueuedAt: number;
}

export class DeferredWriter<T> {
	readonly name: string;
	private readonly flushFn: (entries: T[], ctx: unknown) => Promise<void>;
	private readonly flushIntervalMs: number;
	private readonly maxBufferSize: number;
	private readonly maxBufferAgeMs: number;
	private readonly hardBufferLimit: number;
	private readonly emit: (event: DeferredWriteEvent) => void;
	private readonly flushContext: unknown;

	private buffer: Array<BufferEntry<T>> = [];
	private enabled: boolean;
	private enqueuedTotal = 0;
	private flushedTotal = 0;
	private failedFlushes = 0;
	private lastFlushAt: number | null = null;
	private lastFlushDurationMs: number | null = null;
	private lastFlushedCount = 0;
	private pendingRetries = 0;
	private flushInFlight: Promise<void> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private stopped = false;

	constructor(options: DeferredWriteOptions<T> & { flushContext?: unknown }) {
		this.name = options.name;
		this.flushFn = options.flush;
		this.flushIntervalMs = options.flushIntervalMs ?? 5_000;
		this.maxBufferSize = options.maxBufferSize ?? 100;
		this.maxBufferAgeMs = options.maxBufferAgeMs ?? 30_000;
		this.hardBufferLimit = options.hardBufferLimit ?? 10_000;
		this.emit = options.emit ?? (() => {});
		this.flushContext = options.flushContext ?? null;
		this.enabled = options.enabled ?? true;
		this.startTimer();
	}

	private startTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.flushNow().catch(() => {});
		}, this.flushIntervalMs);
		// Don't keep the event loop alive solely for this timer.
		(this.timer as { unref?: () => void }).unref?.();
	}

	/**
	 * Hot path. Pushes one entry into the in-memory buffer and returns
	 * immediately. Caller never awaits a DB round-trip. Sync function
	 * (returns void, not Promise) to make the non-blocking contract
	 * surface in the type system.
	 */
	enqueue(value: T): void {
		if (this.stopped) return;
		if (!this.enabled) return;
		this.buffer.push({ value, enqueuedAt: Date.now() });
		this.enqueuedTotal++;
		this.emit({ writer: this.name, kind: "enqueued", count: 1 });

		// Drop oldest if hard limit exceeded — prevent OOM if flush is broken.
		while (this.buffer.length > this.hardBufferLimit) {
			this.buffer.shift();
			this.emit({ writer: this.name, kind: "buffer-full", count: 1 });
		}

		// Auto-flush triggers (non-blocking — fire and forget).
		if (this.buffer.length >= this.maxBufferSize) {
			void this.flushNow().catch(() => {});
		} else if (
			this.buffer.length > 0 &&
			Date.now() - this.buffer[0].enqueuedAt >= this.maxBufferAgeMs
		) {
			void this.flushNow().catch(() => {});
		}
	}

	/**
	 * Flush the current buffer NOW. Re-entrant: subsequent calls while
	 * a flush is in flight return the same promise (no thundering herd).
	 */
	async flushNow(): Promise<void> {
		if (this.flushInFlight) return this.flushInFlight;
		if (this.buffer.length === 0) return;

		const batch = this.buffer;
		this.buffer = [];
		const count = batch.length;
		const start = Date.now();

		this.flushInFlight = (async () => {
			try {
				await this.flushFn(
					batch.map((e) => e.value),
					this.flushContext,
				);
				this.flushedTotal += count;
				this.lastFlushAt = Date.now();
				this.lastFlushDurationMs = this.lastFlushAt - start;
				this.lastFlushedCount = count;
				this.emit({
					writer: this.name,
					kind: "flushed",
					count,
					durationMs: this.lastFlushDurationMs,
				});
			} catch (err) {
				// Push the batch back to the FRONT so the next flush retries
				// these before any newer entries.
				this.buffer.unshift(...batch);
				this.failedFlushes++;
				this.pendingRetries = this.buffer.length;
				const message = err instanceof Error ? err.message : String(err);
				this.emit({
					writer: this.name,
					kind: "flush-failed",
					count,
					error: message,
				});
			} finally {
				this.flushInFlight = null;
			}
		})();
		return this.flushInFlight;
	}

	/**
	 * Drain on shutdown. Blocks until buffer is empty OR until a flush
	 * fails (in which case entries remain — caller decides whether to
	 * retry or give up). Wire into SIGTERM/SIGINT handler.
	 */
	async drain(): Promise<void> {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		while (this.buffer.length > 0) {
			const before = this.buffer.length;
			await this.flushNow();
			if (this.buffer.length >= before) {
				// flush failed and didn't shrink the buffer — give up to
				// avoid an infinite loop. Entries remain in the buffer;
				// caller can inspect via stats().
				break;
			}
		}
		this.emit({ writer: this.name, kind: "drained" });
	}

	disable(): void {
		if (!this.enabled) return;
		this.enabled = false;
		this.emit({ writer: this.name, kind: "disabled" });
	}

	enable(): void {
		if (this.enabled) return;
		this.enabled = true;
		this.emit({ writer: this.name, kind: "enabled" });
	}

	stats(): DeferredWriteStats {
		return {
			name: this.name,
			bufferSize: this.buffer.length,
			enqueuedTotal: this.enqueuedTotal,
			flushedTotal: this.flushedTotal,
			failedFlushes: this.failedFlushes,
			lastFlushAt: this.lastFlushAt,
			lastFlushDurationMs: this.lastFlushDurationMs,
			lastFlushedCount: this.lastFlushedCount,
			pendingRetries: this.pendingRetries,
			enabled: this.enabled,
		};
	}
}
