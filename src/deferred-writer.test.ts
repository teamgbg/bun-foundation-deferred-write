// @system codegen
// @status generated
// @edit change the suite in the owned-suites band, then re-run codegen. Hand-edits are overwritten.
//
// This suite's assertions are OWNED by the codegen band: the band module
// carries them verbatim, this file is the emission, and hand edits here are
// overwritten on the next run. The rationale each assertion carries moved
// with it into the band.

import { expect, test } from "bun:test";
import { createDeferredWriter } from "./create-deferred-writer.ts";
import { deferredWriteRegistry } from "./registry.ts";
import type { DeferredWriteEvent } from "./types.ts";

function uniqueName(prefix: string): string {
	return `${prefix}:${Math.random().toString(36).slice(2)}`;
}

test("enqueue is sync and non-blocking", () => {
	const writer = createDeferredWriter<number>({
		name: uniqueName("t1"),
		flush: async () => {},
		flushIntervalMs: 100_000, // disable timer
		maxBufferSize: 99_999, // disable auto-flush
	});
	const start = Date.now();
	for (let i = 0; i < 1000; i++) writer.enqueue(i);
	const elapsed = Date.now() - start;
	expect(elapsed).toBeLessThan(50);
	expect(writer.stats().bufferSize).toBe(1000);
});

test("periodic timer flushes the buffer", async () => {
	const flushed: number[][] = [];
	const writer = createDeferredWriter<number>({
		name: uniqueName("t2"),
		flush: async (entries) => {
			flushed.push(entries);
		},
		flushIntervalMs: 30,
	});
	writer.enqueue(1);
	writer.enqueue(2);
	writer.enqueue(3);
	await new Promise((r) => setTimeout(r, 80));
	expect(flushed.length).toBeGreaterThanOrEqual(1);
	expect(flushed[0]).toEqual([1, 2, 3]);
});

test("buffer-full triggers immediate flush", async () => {
	const flushed: number[][] = [];
	const writer = createDeferredWriter<number>({
		name: uniqueName("t3"),
		flush: async (entries) => {
			flushed.push(entries);
		},
		flushIntervalMs: 100_000, // disable timer
		maxBufferSize: 3,
	});
	writer.enqueue(1);
	writer.enqueue(2);
	writer.enqueue(3);
	await new Promise((r) => setTimeout(r, 20));
	expect(flushed.length).toBe(1);
	expect(flushed[0]).toEqual([1, 2, 3]);
});

test("flush failure keeps entries in buffer for retry", async () => {
	const events: DeferredWriteEvent[] = [];
	let mode: "fail" | "ok" = "fail";
	const flushed: number[][] = [];
	const writer = createDeferredWriter<number>({
		name: uniqueName("t4"),
		flush: async (entries) => {
			if (mode === "fail") throw new Error("upstream down");
			flushed.push(entries);
		},
		flushIntervalMs: 30,
		emit: (e) => events.push(e),
	});
	writer.enqueue(10);
	writer.enqueue(20);

	await new Promise((r) => setTimeout(r, 80));
	expect(writer.stats().failedFlushes).toBeGreaterThanOrEqual(1);
	expect(writer.stats().bufferSize).toBeGreaterThanOrEqual(2);
	expect(events.some((e) => e.kind === "flush-failed")).toBe(true);

	mode = "ok";
	await new Promise((r) => setTimeout(r, 60));
	expect(flushed.length).toBeGreaterThanOrEqual(1);
	expect(flushed[0]).toEqual([10, 20]);
});

test("drain flushes outstanding entries on shutdown", async () => {
	const flushed: number[][] = [];
	const writer = createDeferredWriter<number>({
		name: uniqueName("t5"),
		flush: async (entries) => {
			flushed.push(entries);
		},
		flushIntervalMs: 100_000, // disable timer; rely on drain
	});
	writer.enqueue(1);
	writer.enqueue(2);
	await writer.drain();
	expect(flushed.length).toBe(1);
	expect(flushed[0]).toEqual([1, 2]);
	// after drain, enqueue is a no-op
	writer.enqueue(99);
	expect(writer.stats().bufferSize).toBe(0);
});

test("hardBufferLimit drops oldest when exceeded", () => {
	const writer = createDeferredWriter<number>({
		name: uniqueName("t6"),
		flush: async () => {
			throw new Error("never flushes");
		},
		flushIntervalMs: 100_000,
		maxBufferSize: 99999,
		hardBufferLimit: 5,
	});
	for (let i = 0; i < 10; i++) writer.enqueue(i);
	expect(writer.stats().bufferSize).toBe(5);
});

test("disable makes enqueue a no-op", () => {
	const writer = createDeferredWriter<number>({
		name: uniqueName("t7"),
		flush: async () => {},
		flushIntervalMs: 100_000,
	});
	writer.disable();
	writer.enqueue(1);
	expect(writer.stats().bufferSize).toBe(0);
	writer.enable();
	writer.enqueue(1);
	expect(writer.stats().bufferSize).toBe(1);
});

test("registry exposes every writer", async () => {
	const name = uniqueName("t8");
	createDeferredWriter<number>({
		name,
		flush: async () => {},
		flushIntervalMs: 100_000,
	});
	const all = deferredWriteRegistry.getAll();
	expect(all.some((s) => s.name === name)).toBe(true);
});

test("duplicate name throws at registration", () => {
	const name = uniqueName("t9");
	createDeferredWriter<number>({
		name,
		flush: async () => {},
		flushIntervalMs: 100_000,
	});
	expect(() =>
		createDeferredWriter<number>({
			name,
			flush: async () => {},
			flushIntervalMs: 100_000,
		}),
	).toThrow();
});
