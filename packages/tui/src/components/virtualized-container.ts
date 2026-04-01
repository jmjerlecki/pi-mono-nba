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
	key?: string;
	estimatedHeight?: number;
	searchText?: string | (() => string | undefined);
	collapseWhenBrowsingHistory?: boolean;
}

export interface VirtualizedContainerChildMetrics {
	index: number;
	startLine: number;
	endLine: number;
	height: number;
}

export interface VirtualizedContainerSearchResult {
	childIndex: number;
	lineIndex: number;
	itemStartLine: number;
	itemEndLine: number;
}

export interface VirtualizedContainerWindow {
	lines: string[];
	startLine: number;
	endLine: number;
	totalLines: number;
	startChildIndex: number;
	endChildIndex: number;
}

type SearchTextComponent = Component & { getSearchText?(): string | undefined };

export class VirtualizedContainer extends Container {
	private cachedRenders: CachedRender[] = [];
	private childOptions: VirtualizedContainerChildOptions[] = [];
	private cachedOffsets: number[] = [0];
	private offsetsDirty = true;
	private lastWidth = -1;
	private browsingHistory = false;
	private searchResultsCache = new Map<string, VirtualizedContainerSearchResult[]>();
	private persistentHeightCache = new Map<string, number>();

	override addChild(component: Component, options: VirtualizedContainerChildOptions = {}): void {
		super.addChild(component);
		this.childOptions.push(options);
		const persistedHeight = options.key ? this.persistentHeightCache.get(options.key) : undefined;
		this.cachedRenders.push({
			height: persistedHeight ?? options.estimatedHeight ?? this.estimateHeight(component),
		});
		this.offsetsDirty = true;
		this.searchResultsCache.clear();
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
		this.searchResultsCache.clear();
	}

	override clear(): void {
		super.clear();
		this.cachedRenders = [];
		this.childOptions = [];
		this.cachedOffsets = [0];
		this.offsetsDirty = false;
		this.searchResultsCache.clear();
	}

	setBrowsingHistory(browsingHistory: boolean): void {
		if (this.browsingHistory === browsingHistory) {
			return;
		}
		this.browsingHistory = browsingHistory;
		this.offsetsDirty = true;
		this.searchResultsCache.clear();
	}

	override invalidate(): void {
		super.invalidate();
		for (const cached of this.cachedRenders) {
			cached.lines = undefined;
			cached.plainLines = undefined;
			cached.width = undefined;
		}
		this.offsetsDirty = true;
		this.searchResultsCache.clear();
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
		return this.getWindow(width, startLine, endLine).lines;
	}

	getWindow(width: number, startLine: number, endLine: number): VirtualizedContainerWindow {
		this.syncWidth(width);
		if (startLine >= endLine || this.children.length === 0) {
			const clampedStart = Math.max(0, startLine);
			return {
				lines: [],
				startLine: clampedStart,
				endLine: clampedStart,
				totalLines: this.getTotalLineCount(width),
				startChildIndex: 0,
				endChildIndex: 0,
			};
		}

		let rendered = this.renderWindowInternal(width, startLine, endLine);
		if (rendered.changedHeights) {
			rendered = this.renderWindowInternal(width, startLine, endLine);
		}

		return {
			lines: rendered.lines,
			startLine: rendered.startLine,
			endLine: rendered.endLine,
			totalLines: rendered.totalLines,
			startChildIndex: rendered.startChildIndex,
			endChildIndex: rendered.endChildIndex,
		};
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

	getSearchMatches(width: number, query: string): number[] {
		return this.getSearchResults(width, query).map((match) => match.lineIndex);
	}

	getSearchResults(width: number, query: string): VirtualizedContainerSearchResult[] {
		this.syncWidth(width);
		const loweredQuery = query.toLowerCase();
		const cacheKey = `${width}:${this.browsingHistory ? 1 : 0}:${loweredQuery}`;
		const cachedResults = this.searchResultsCache.get(cacheKey);
		if (cachedResults) {
			return cachedResults;
		}

		const results: VirtualizedContainerSearchResult[] = [];
		let lineOffset = 0;
		for (let i = 0; i < this.children.length; i++) {
			const child = this.renderChild(width, i);
			const itemStartLine = lineOffset;
			const itemEndLine = lineOffset + child.height;
			if (child.height === 0) {
				lineOffset = itemEndLine;
				continue;
			}

			let matchedRenderedLine = false;
			for (let j = 0; j < child.plainLines.length; j++) {
				if (child.plainLines[j].toLowerCase().includes(loweredQuery)) {
					results.push({
						childIndex: i,
						lineIndex: itemStartLine + j,
						itemStartLine,
						itemEndLine,
					});
					matchedRenderedLine = true;
				}
			}

			if (!matchedRenderedLine) {
				const searchText = this.getChildSearchText(i, child);
				if (searchText?.includes(loweredQuery)) {
					results.push({
						childIndex: i,
						lineIndex: itemStartLine,
						itemStartLine,
						itemEndLine,
					});
				}
			}

			lineOffset = itemEndLine;
		}

		this.searchResultsCache.set(cacheKey, results);
		return results;
	}

	getChildMetrics(width: number, index: number): VirtualizedContainerChildMetrics | undefined {
		this.syncWidth(width);
		if (index < 0 || index >= this.children.length) {
			return undefined;
		}

		const offsets = this.getOffsets();
		const child = this.renderChild(width, index);
		return {
			index,
			startLine: offsets[index] ?? 0,
			endLine: (offsets[index] ?? 0) + child.height,
			height: child.height,
		};
	}

	getChildIndexAtLine(width: number, lineIndex: number): number {
		this.syncWidth(width);
		const offsets = this.getOffsets();
		return this.findChildIndex(offsets, lineIndex);
	}

	renderTrailingLines(width: number, lineCount: number): { lines: string[]; startLine: number; totalLines: number } {
		const window = this.getTrailingWindow(width, lineCount);
		return {
			lines: window.lines,
			startLine: window.startLine,
			totalLines: window.totalLines,
		};
	}

	getTrailingWindow(width: number, lineCount: number): VirtualizedContainerWindow {
		this.syncWidth(width);
		if (lineCount <= 0 || this.children.length === 0) {
			return {
				lines: [],
				startLine: 0,
				endLine: 0,
				totalLines: this.getTotalLineCount(width),
				startChildIndex: 0,
				endChildIndex: 0,
			};
		}

		let rendered = this.renderTrailingWindowInternal(width, lineCount);
		if (rendered.changedHeights) {
			rendered = this.renderTrailingWindowInternal(width, lineCount);
		}

		return {
			lines: rendered.lines,
			startLine: rendered.startLine,
			endLine: rendered.startLine + rendered.lines.length,
			totalLines: rendered.totalLines,
			startChildIndex: rendered.startChildIndex,
			endChildIndex: rendered.endChildIndex,
		};
	}

	private renderWindowInternal(
		width: number,
		startLine: number,
		endLine: number,
	): {
		lines: string[];
		startLine: number;
		endLine: number;
		totalLines: number;
		startChildIndex: number;
		endChildIndex: number;
		changedHeights: boolean;
	} {
		const totalLines = this.getTotalLineCount(width);
		if (totalLines === 0) {
			return {
				lines: [],
				startLine: 0,
				endLine: 0,
				totalLines: 0,
				startChildIndex: 0,
				endChildIndex: 0,
				changedHeights: false,
			};
		}

		const clampedStart = Math.max(0, Math.min(startLine, totalLines));
		const clampedEnd = Math.max(clampedStart, Math.min(endLine, totalLines));
		const offsets = this.getOffsets();
		let childIndex = this.findChildIndex(offsets, clampedStart);
		const startChildIndex = childIndex;
		const lines: string[] = [];
		let changedHeights = false;
		let endChildIndex = childIndex;

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
			endChildIndex = childIndex;
		}

		return {
			lines,
			startLine: clampedStart,
			endLine: clampedStart + lines.length,
			totalLines,
			startChildIndex,
			endChildIndex,
			changedHeights,
		};
	}

	private renderTrailingWindowInternal(
		width: number,
		lineCount: number,
	): {
		lines: string[];
		startLine: number;
		totalLines: number;
		startChildIndex: number;
		endChildIndex: number;
		changedHeights: boolean;
	} {
		const chunks: string[][] = [];
		let remaining = lineCount;
		let changedHeights = false;
		let startChildIndex = this.children.length;
		let endChildIndex = this.children.length;

		for (let i = this.children.length - 1; i >= 0 && remaining > 0; i--) {
			const beforeHeight = this.cachedRenders[i]?.height ?? DEFAULT_ESTIMATED_HEIGHT;
			const cached = this.renderChild(width, i);
			if (cached.height !== beforeHeight) {
				changedHeights = true;
			}

			const sliceStart = Math.max(0, cached.lines.length - remaining);
			chunks.unshift(cached.lines.slice(sliceStart));
			remaining -= cached.lines.length;
			startChildIndex = i;
			if (endChildIndex === this.children.length) {
				endChildIndex = i + 1;
			}
		}

		const totalLines = this.getTotalLineCount(width);
		const lines = chunks.flat();
		const startLine = Math.max(0, totalLines - lines.length);
		return {
			lines,
			startLine,
			totalLines,
			startChildIndex: startChildIndex === this.children.length ? 0 : startChildIndex,
			endChildIndex: endChildIndex === this.children.length ? 0 : endChildIndex,
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
		const key = this.childOptions[index]?.key;
		if (key) {
			this.persistentHeightCache.set(key, nextHeight);
		}
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
		this.searchResultsCache.clear();
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

	private getChildSearchText(index: number, child: Required<CachedRender>): string | undefined {
		const optionText = this.childOptions[index]?.searchText;
		const explicitText =
			typeof optionText === "function"
				? optionText()
				: typeof optionText === "string"
					? optionText
					: (this.children[index] as SearchTextComponent | undefined)?.getSearchText?.();
		if (explicitText) {
			const normalized = explicitText.replace(/\s+/g, " ").trim().toLowerCase();
			if (normalized) {
				return normalized;
			}
		}

		const renderedText = child.plainLines.join("\n").trim().toLowerCase();
		return renderedText || undefined;
	}
}
