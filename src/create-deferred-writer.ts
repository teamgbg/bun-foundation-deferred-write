/**
 * @system deferred-write
 * @status handwritten
 * @edit edit directly
 *
 * Factory entry point. Mirrors createNotifyCache / createCache /
 * createWorkerPool. Auto-registers in the central registry, picks up
 * the flush context from the bootloader if configure() ran.
 */

import { getFlushContext } from "./configure.ts";
import { DeferredWriter } from "./deferred-writer.ts";
import { deferredWriteRegistry } from "./registry.ts";
import type { DeferredWriteOptions } from "./types.ts";

export function createDeferredWriter<T>(
	options: DeferredWriteOptions<T> & { flushContext?: unknown },
): DeferredWriter<T> {
	const writer = new DeferredWriter<T>({
		...options,
		flushContext: options.flushContext ?? getFlushContext(),
	});
	deferredWriteRegistry.register(writer);
	return writer;
}
