/**
 * @system deferred-write
 * @status handwritten
 * @edit edit directly
 *
 * Bootloader injection per constitution `configured-primitives`.
 * Consumers (services, daemons) call configure() at startup, providing
 * the flush context (typically a sql client) that each writer's
 * flush() closure receives. Tests bypass configure() by passing
 * flushContext directly on createDeferredWriter.
 */

interface DeferredWriteConfig {
	flushContext: unknown;
}

let _config: DeferredWriteConfig = { flushContext: null };

export function configure(config: Partial<DeferredWriteConfig>): void {
	_config = { ..._config, ...config };
}

export function getFlushContext(): unknown {
	return _config.flushContext;
}
