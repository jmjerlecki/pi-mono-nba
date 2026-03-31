import type { Component } from "../tui.js";
import { Container } from "../tui.js";
import { stripAnsiSequences } from "../utils.js";

const DEFAULT_ESTIMATED_HEIGHT = 3;

interface CachedRender {
	height: number;
	lines?: string[];
	plainLines?: string[];
	width?: number;
}

export interface VirtualizedContainerChildOptions {
	collapseWhenBrowsingHistory?: boolean;
}

export class VirtualizedContainer extends Container {
	private cachedRenders: CachedRender[] = [];
	private childOptions: VirtualizedContainerChildOptions[] = [];
	private cachedOffsets: number[] = [0];
	private offsetsDirty = true;
	private lastWidth = -1;
	private browsingHistory = false;

	override addChild(component: Component, options: VirtualizedContainerChildOptions = {}): void {
		super.addChild(component);
		this.childOptions.push(options);
		this.cachedRenders.push({ height: this.estimateHeight(component) });
		this.offsetsDirty = true;
	}

	override removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index === -1) {
			return;
		}
		super.removeChild(component);
		this.childOptions.splice(index, 1);
		this.cachedRenders.splice(index, 1);
		this.offsetsDirty = true;
	}

	override clear(): void {
		super.clear();
		this.cachedRenders = [];
		this.childOptions = [];
		this.cachedOffsets = [0];
		this.offsetsDirty = false;
	}

	setBrowsingHistory(browsingHistory: boolean): void {
		if (this.browsingHistory === browsingHistory) {
			return;
		}
		this.browsingHistory = browsingHistory;
		this.offsetsDirty = true;
	}

	override invalidate(): void {
		super.invalidate();
		for (const cached of this.cachedRenders) {
			cached.lines = undefined;
			cached.plainLines = undefined;
			cached.width = undefined;
		}
		this.offsetsDirty = true;
	}

	override render(width: number): string[] {
		return this.renderLineSlice(width, 0, this.getTotalLineCount(width));
	}

	getTotalLineCount(width: number): number {
		this.syncWidth(width);
		const offsets = this.getOffsets();
		return offsets[offsets.length - 1] ?? 0;
	}

	renderLineSlice(width: number, startLine: number, endLine: number): string[] {
		this.syncWidth(width);
		if (startLine >= endLine || this.children.length === 0) {
			return [];
		}

		let rendered = this.renderLineSliceInternal(width, startLine, endLine);
		if (rendered.changedHeights) {
			rendered = this.renderLineSliceInternal(width, startLine, endLine);
		}
		return rendered.lines;
	}

	getPlainTextLines(width: number): string[] {
		this.syncWidth(width);
		const plainLines: string[] = [];
		for (let i = 0; i < this.children.length; i++) {
			const cached = this.renderChild(width, i);
			plainLines.push(...cached.plainLines);
		}
		return plainLines;
	}

	renderTrailingLines(width: number, lineCount: number): { lines: string[]; startLine: number; totalLines: number } {
		this.syncWidth(width);
		if (lineCount <= 0 || this.children.length === 0) {
			return { lines: [], startLine: 0, totalLines: this.getTotalLineCount(width) };
		}

		let rendered = this.renderTrailingLinesInternal(width, lineCount);
		if (rendered.changedHeights) {
			rendered = this.renderTrailingLinesInternal(width, lineCount);
		}

		return {
			lines: rendered.lines,
			startLine: Math.max(0, rendered.totalLines - rendered.lines.length),
			totalLines: rendered.totalLines,
		};
	}

	private renderLineSliceInternal(
		width: number,
		startLine: number,
		endLine: number,
	): { lines: string[]; changedHeights: boolean } {
		const totalLines = this.getTotalLineCount(width);
		if (totalLines === 0) {
			return { lines: [], changedHeights: false };
		}

		const clampedStart = Math.max(0, Math.min(startLine, totalLines));
		const clampedEnd = Math.max(clampedStart, Math.min(endLine, totalLines));
		const offsets = this.getOffsets();
		let childIndex = this.findChildIndex(offsets, clampedStart);
		const lines: string[] = [];
		let changedHeights = false;

		while (childIndex < this.children.length && offsets[childIndex] < clampedEnd) {
			const childStart = offsets[childIndex] ?? 0;
			const beforeHeight = this.cachedRenders[childIndex]?.height ?? DEFAULT_ESTIMATED_HEIGHT;
			const cached = this.renderChild(width, childIndex);
			if (cached.height !== beforeHeight) {
				changedHeights = true;
			}

			const sliceStart = Math.max(0, clampedStart - childStart);
			const sliceEnd = Math.min(cached.lines.length, clampedEnd - childStart);
			if (sliceEnd > sliceStart) {
				lines.push(...cached.lines.slice(sliceStart, sliceEnd));
			}
			childIndex++;
		}

		return { lines, changedHeights };
	}

	private renderTrailingLinesInternal(
		width: number,
		lineCount: number,
	): { lines: string[]; totalLines: number; changedHeights: boolean } {
		const chunks: string[][] = [];
		let remaining = lineCount;
		let changedHeights = false;

		for (let i = this.children.length - 1; i >= 0 && remaining > 0; i--) {
			const beforeHeight = this.cachedRenders[i]?.height ?? DEFAULT_ESTIMATED_HEIGHT;
			const cached = this.renderChild(width, i);
			if (cached.height !== beforeHeight) {
				changedHeights = true;
			}

			const sliceStart = Math.max(0, cached.lines.length - remaining);
			chunks.unshift(cached.lines.slice(sliceStart));
			remaining -= cached.lines.length;
		}

		return {
			lines: chunks.flat(),
			totalLines: this.getTotalLineCount(width),
			changedHeights,
		};
	}

	private renderChild(width: number, index: number): Required<CachedRender> {
		const cached = this.cachedRenders[index];
		if (!cached) {
			return { height: 0, lines: [], plainLines: [], width };
		}
		if (this.isCollapsed(index)) {
			return { height: 0, lines: [], plainLines: [], width };
		}
		if (cached.width === width && cached.lines && cached.plainLines) {
			return cached as Required<CachedRender>;
		}

		const lines = this.children[index]?.render(width) ?? [];
		const plainLines = lines.map((line) => stripAnsiSequences(line).replace(/\t/g, "   "));
		const nextHeight = lines.length;
		if (cached.height !== nextHeight) {
			this.offsetsDirty = true;
		}
		cached.height = nextHeight;
		cached.lines = lines;
		cached.plainLines = plainLines;
		cached.width = width;
		return cached as Required<CachedRender>;
	}

	private getOffsets(): number[] {
		if (!this.offsetsDirty && this.cachedOffsets.length === this.children.length + 1) {
			return this.cachedOffsets;
		}

		const offsets = new Array<number>(this.children.length + 1);
		offsets[0] = 0;
		for (let i = 0; i < this.children.length; i++) {
			offsets[i + 1] =
				offsets[i] + (this.isCollapsed(i) ? 0 : (this.cachedRenders[i]?.height ?? DEFAULT_ESTIMATED_HEIGHT));
		}
		this.cachedOffsets = offsets;
		this.offsetsDirty = false;
		return offsets;
	}

	private syncWidth(width: number): void {
		if (width <= 0 || width === this.lastWidth) {
			return;
		}

		if (this.lastWidth > 0) {
			const ratio = this.lastWidth / width;
			for (const cached of this.cachedRenders) {
				cached.height = Math.max(1, Math.round(cached.height * ratio));
				cached.lines = undefined;
				cached.plainLines = undefined;
				cached.width = undefined;
			}
			this.offsetsDirty = true;
		}

		this.lastWidth = width;
	}

	private estimateHeight(component: Component): number {
		return component.constructor.name === "Spacer" ? 1 : DEFAULT_ESTIMATED_HEIGHT;
	}

	private isCollapsed(index: number): boolean {
		return this.browsingHistory && Boolean(this.childOptions[index]?.collapseWhenBrowsingHistory);
	}

	private findChildIndex(offsets: number[], lineIndex: number): number {
		let left = 0;
		let right = this.children.length;
		while (left < right) {
			const mid = Math.floor((left + right) / 2);
			if ((offsets[mid + 1] ?? 0) <= lineIndex) {
				left = mid + 1;
			} else {
				right = mid;
			}
		}
		return Math.min(left, this.children.length);
	}
}
