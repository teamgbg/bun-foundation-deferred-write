/**
 * @system deferred-write
 * @status handwritten
 * @edit edit directly
 *
 * Process-global deferred-write registry singleton. Mirrors
 * CacheRegistry / NotifyCacheRegistry / WorkerPoolRegistry per
 * `cache-is-the-only-cache` precedent.
 */

import type { DeferredWriter } from "./deferred-writer.ts";
import type { DeferredWriteStats } from "./types.ts";

export interface DeferredWriterHandle {
	readonly name: string;
	stats(): DeferredWriteStats;
	disable(): void;
	enable(): void;
	drain(): Promise<void>;
}

class DeferredWriteRegistry {
	private readonly writers = new Map<string, DeferredWriterHandle>();

	register(writer: DeferredWriterHandle): void {
		if (this.writers.has(writer.name)) {
			throw new Error(
				`DeferredWriter "${writer.name}" is already registered in this process`,
			);
		}
		this.writers.set(writer.name, writer);
	}

	get<T>(name: string): DeferredWriter<T> | undefined {
		return this.writers.get(name) as DeferredWriter<T> | undefined;
	}

	getAll(): DeferredWriteStats[] {
		return Array.from(this.writers.values()).map((w) => w.stats());
	}

	disable(name: string): void {
		this.writers.get(name)?.disable();
	}

	enable(name: string): void {
		this.writers.get(name)?.enable();
	}

	async drainAll(): Promise<void> {
		for (const writer of this.writers.values()) {
			await writer.drain();
		}
	}
}

export const deferredWriteRegistry = new DeferredWriteRegistry();
