import type { Component } from "../tui.js";
import { sliceWithWidth, stripAnsiSequences, visibleWidth } from "../utils.js";

export interface ScrollViewportState {
	atLatest: boolean;
	hiddenAbove: number;
	hiddenBelow: number;
}

export type ScrollOverflowDirection = "earlier" | "newer";

export interface ScrollOverflowInfo {
	direction: ScrollOverflowDirection;
	hiddenLineCount: number;
	hiddenMatchCount: number;
	activeMatchHidden: boolean;
	query?: string;
}

export interface ScrollSearchResult {
	query: string;
	totalMatches: number;
	activeMatch: number;
	lineIndex: number;
}

export interface ScrollViewportLineInfo {
	lineIndex: number;
	containsMatch: boolean;
	isActiveMatch: boolean;
	matchOrdinal?: number;
	totalMatches?: number;
	query?: string;
}

export interface ScrollViewportOptions {
	getAvailableHeight: (width: number) => number;
	getPinnedContext?: () => string | undefined;
	getOverflowLine?: (width: number, info: ScrollOverflowInfo) => string;
	getPinnedContextLine?: (width: number, context: string) => string;
	highlightMatch?: (text: string, active: boolean) => string;
	decorateLine?: (width: number, line: string, info: ScrollViewportLineInfo) => string;
}

interface ScrollViewportLineSource extends Component {
	getTotalLineCount?(width: number): number;
	renderLineSlice?(width: number, startLine: number, endLine: number): string[];
	getPlainTextLines?(width: number): string[];
	getSearchMatches?(width: number, query: string): number[];
	getChildMetrics?(
		width: number,
		index: number,
	): { index: number; startLine: number; endLine: number; height: number } | undefined;
	getChildIndexAtLine?(width: number, lineIndex: number): number;
	renderTrailingLines?(width: number, lineCount: number): { lines: string[]; startLine: number; totalLines: number };
	setBrowsingHistory?(browsingHistory: boolean): void;
}

export class ScrollViewport implements Component {
	private offsetFromBottom = 0;
	private lastAvailableHeight = 0;
	private lastMaxOffset = 0;
	private lastState: ScrollViewportState = { atLatest: true, hiddenAbove: 0, hiddenBelow: 0 };
	private lastVisibleStart = 0;
	private lastRenderedWidth = 0;
	private lastSearchQuery = "";
	private lastSearchDisplayQuery = "";
	private lastSearchMatches: number[] = [];
	private lastSearchMatchIndex = -1;
	private lastSearchMatchOrdinalByLine = new Map<number, number>();

	constructor(
		private readonly content: Component,
		private readonly options: ScrollViewportOptions,
	) {}

	invalidate(): void {
		this.content.invalidate?.();
	}

	getState(): ScrollViewportState {
		return this.lastState;
	}

	getSearchQuery(): string | undefined {
		return this.lastSearchDisplayQuery || undefined;
	}

	getSearchSummary():
		| {
				query: string;
				totalMatches: number;
				activeMatch: number;
		  }
		| undefined {
		if (!this.lastSearchDisplayQuery || this.lastSearchMatches.length === 0) {
			return undefined;
		}
		return {
			query: this.lastSearchDisplayQuery,
			totalMatches: this.lastSearchMatches.length,
			activeMatch: this.lastSearchMatchIndex >= 0 ? this.lastSearchMatchIndex + 1 : 0,
		};
	}

	isAtLatest(): boolean {
		return this.offsetFromBottom === 0;
	}

	scrollPageUp(): void {
		this.offsetFromBottom += this.getPageStep();
	}

	scrollLineUp(): void {
		this.offsetFromBottom += 1;
	}

	scrollLineDown(): void {
		this.offsetFromBottom = Math.max(0, this.offsetFromBottom - 1);
	}

	scrollPageDown(): void {
		this.offsetFromBottom = Math.max(0, this.offsetFromBottom - this.getPageStep());
	}

	jumpToOldest(): void {
		this.offsetFromBottom = this.lastMaxOffset;
	}

	jumpToLatest(): void {
		this.offsetFromBottom = 0;
	}

	searchNext(query: string): ScrollSearchResult | undefined {
		return this.search(query, "next");
	}

	searchPrevious(query: string): ScrollSearchResult | undefined {
		return this.search(query, "prev");
	}

	render(width: number): string[] {
		this.lastRenderedWidth = width;
		const availableHeight = Math.max(0, this.options.getAvailableHeight(width));
		this.lastAvailableHeight = availableHeight;
		if (availableHeight <= 0) {
			this.lastVisibleStart = 0;
			this.lastState = { atLatest: true, hiddenAbove: 0, hiddenBelow: 0 };
			return [];
		}

		let browsingHistory = this.offsetFromBottom > 0;
		this.setBrowsingHistoryMode(browsingHistory);
		let totalLines = this.getTotalLineCount(width);
		let maxOffset = Math.max(0, totalLines - availableHeight);
		this.lastMaxOffset = maxOffset;
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		if (this.offsetFromBottom > 0 !== browsingHistory) {
			browsingHistory = this.offsetFromBottom > 0;
			this.setBrowsingHistoryMode(browsingHistory);
			totalLines = this.getTotalLineCount(width);
			maxOffset = Math.max(0, totalLines - availableHeight);
			this.lastMaxOffset = maxOffset;
			this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		}
		if (this.offsetFromBottom === 0) {
			const trailing = this.renderTrailingLines(width, availableHeight);
			if (trailing) {
				totalLines = trailing.totalLines;
				maxOffset = Math.max(0, totalLines - availableHeight);
				this.lastMaxOffset = maxOffset;
				const hiddenAbove = trailing.startLine;
				const hiddenBelow = Math.max(0, totalLines - (trailing.startLine + trailing.lines.length));
				this.lastVisibleStart = trailing.startLine;
				this.lastState = { atLatest: true, hiddenAbove, hiddenBelow };
				const highlightedTrailingLines = this.decorateVisibleLines(
					this.highlightVisibleLines(trailing.lines, trailing.startLine),
					trailing.startLine,
					width,
				);
				if (hiddenAbove === 0 && hiddenBelow === 0) {
					return highlightedTrailingLines;
				}

				const rendered: string[] = [];
				if (hiddenAbove > 0) {
					rendered.push(this.renderOverflowLine(width, "earlier", hiddenAbove, trailing.startLine));
				}
				rendered.push(...highlightedTrailingLines.slice(hiddenAbove > 0 ? 1 : 0));
				if (hiddenBelow > 0) {
					rendered.push(
						this.renderOverflowLine(width, "newer", hiddenBelow, trailing.startLine + trailing.lines.length),
					);
				}
				return rendered;
			}
		}
		if (totalLines <= availableHeight && this.offsetFromBottom === 0) {
			this.lastVisibleStart = 0;
			this.lastState = { atLatest: true, hiddenAbove: 0, hiddenBelow: 0 };
			return this.renderLineSlice(width, 0, totalLines);
		}

		let start = Math.max(0, totalLines - availableHeight - this.offsetFromBottom);
		let end = Math.min(totalLines, start + availableHeight);
		let visibleLines = this.renderLineSlice(width, start, end);
		const updatedTotalLines = this.getTotalLineCount(width);
		if (updatedTotalLines !== totalLines) {
			totalLines = updatedTotalLines;
			const resolvedMaxOffset = Math.max(0, totalLines - availableHeight);
			this.lastMaxOffset = resolvedMaxOffset;
			this.offsetFromBottom = Math.min(this.offsetFromBottom, resolvedMaxOffset);
			start = Math.max(0, totalLines - availableHeight - this.offsetFromBottom);
			end = Math.min(totalLines, start + availableHeight);
			visibleLines = this.renderLineSlice(width, start, end);
		}
		visibleLines = this.decorateVisibleLines(this.highlightVisibleLines(visibleLines, start), start, width);
		this.lastVisibleStart = start;
		const hiddenAbove = start;
		const hiddenBelow = Math.max(0, totalLines - end);
		this.lastState = {
			atLatest: this.offsetFromBottom === 0,
			hiddenAbove,
			hiddenBelow,
		};
		const pinnedContext = this.offsetFromBottom > 0 ? this.options.getPinnedContext?.() : undefined;

		if (hiddenAbove === 0 && hiddenBelow === 0) {
			return visibleLines;
		}

		const topReservedRows = Number(Boolean(pinnedContext) || hiddenAbove > 0);
		const bottomReservedRows = Number(hiddenBelow > 0);
		const overflowRows = topReservedRows + bottomReservedRows;
		const contentHeight = Math.max(0, availableHeight - overflowRows);

		if (contentHeight === 0) {
			if (pinnedContext && this.options.getPinnedContextLine) {
				return [this.options.getPinnedContextLine(width, pinnedContext)];
			}
			return [
				this.renderOverflowLine(
					width,
					hiddenAbove > 0 ? "earlier" : "newer",
					hiddenAbove || hiddenBelow,
					hiddenAbove > 0 ? 0 : end,
				),
			];
		}

		const trimmedVisibleLines = visibleLines.slice(topReservedRows > 0 ? 1 : 0, hiddenBelow > 0 ? -1 : undefined);
		const rendered: string[] = [];
		if (pinnedContext && this.options.getPinnedContextLine) {
			rendered.push(this.options.getPinnedContextLine(width, pinnedContext));
		} else if (hiddenAbove > 0) {
			rendered.push(this.renderOverflowLine(width, "earlier", hiddenAbove, 0));
		}
		rendered.push(...trimmedVisibleLines);
		if (hiddenBelow > 0) {
			rendered.push(this.renderOverflowLine(width, "newer", hiddenBelow, end));
		}
		return rendered;
	}

	private getPageStep(): number {
		return Math.max(1, this.lastAvailableHeight - 2);
	}

	private search(query: string, direction: "next" | "prev"): ScrollSearchResult | undefined {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			this.lastSearchQuery = "";
			this.lastSearchDisplayQuery = "";
			this.lastSearchMatches = [];
			this.lastSearchMatchIndex = -1;
			this.lastSearchMatchOrdinalByLine.clear();
			return undefined;
		}

		if (normalized !== this.lastSearchQuery) {
			this.lastSearchQuery = normalized;
			this.lastSearchDisplayQuery = query.trim();
			this.lastSearchMatches = this.getSearchMatches(this.lastRenderedWidth, normalized);
			this.lastSearchMatchIndex = -1;
			this.rebuildSearchMatchOrdinalIndex();
		}

		if (this.lastSearchMatches.length === 0) {
			return undefined;
		}

		if (this.lastSearchMatchIndex === -1) {
			const anchor = direction === "prev" ? this.lastVisibleStart - 1 : this.lastVisibleStart;
			this.lastSearchMatchIndex =
				direction === "prev" ? this.findPreviousMatchIndex(anchor) : this.findNextMatchIndex(anchor);
		} else {
			const total = this.lastSearchMatches.length;
			this.lastSearchMatchIndex =
				direction === "prev"
					? (this.lastSearchMatchIndex - 1 + total) % total
					: (this.lastSearchMatchIndex + 1) % total;
		}

		const lineIndex = this.lastSearchMatches[this.lastSearchMatchIndex];
		this.scrollToLine(lineIndex);
		return {
			query,
			totalMatches: this.lastSearchMatches.length,
			activeMatch: this.lastSearchMatchIndex + 1,
			lineIndex,
		};
	}

	private findNextMatchIndex(anchor: number): number {
		for (let i = 0; i < this.lastSearchMatches.length; i++) {
			if (this.lastSearchMatches[i] >= anchor) {
				return i;
			}
		}
		return 0;
	}

	private findPreviousMatchIndex(anchor: number): number {
		for (let i = this.lastSearchMatches.length - 1; i >= 0; i--) {
			if (this.lastSearchMatches[i] <= anchor) {
				return i;
			}
		}
		return this.lastSearchMatches.length - 1;
	}

	private scrollToLine(lineIndex: number): void {
		const availableHeight = Math.max(1, this.lastAvailableHeight);
		const totalLines = this.getTotalLineCount(this.lastRenderedWidth);
		const childAlignedStart = this.getChildAlignedStartLine(this.lastRenderedWidth, lineIndex, availableHeight);
		const maxStart = Math.max(0, totalLines - availableHeight);
		const fallbackStart = Math.max(0, Math.min(maxStart, lineIndex - Math.floor(availableHeight / 3)));
		const targetStart = childAlignedStart ?? fallbackStart;
		const targetEnd = Math.min(totalLines, targetStart + availableHeight);
		this.offsetFromBottom = Math.max(0, totalLines - targetEnd);
	}

	private renderOverflowLine(
		width: number,
		direction: ScrollOverflowDirection,
		hiddenLineCount: number,
		hiddenStartLine: number,
	): string {
		const hiddenEndLine = hiddenStartLine + hiddenLineCount;
		const hiddenMatchCount = this.countMatchesInRange(hiddenStartLine, hiddenEndLine);
		const activeLineIndex =
			this.lastSearchMatchIndex >= 0 ? this.lastSearchMatches[this.lastSearchMatchIndex] : undefined;
		const info: ScrollOverflowInfo = {
			direction,
			hiddenLineCount,
			hiddenMatchCount,
			activeMatchHidden:
				activeLineIndex !== undefined && activeLineIndex >= hiddenStartLine && activeLineIndex < hiddenEndLine,
			query: this.lastSearchDisplayQuery || undefined,
		};
		if (this.options.getOverflowLine) {
			return this.options.getOverflowLine(width, info);
		}

		const suffix = hiddenLineCount === 1 ? "" : "s";
		const matchSuffix =
			hiddenMatchCount > 0 ? ` | ${hiddenMatchCount} match${hiddenMatchCount === 1 ? "" : "es"}` : "";
		const text = `... ${hiddenLineCount} ${direction} line${suffix}${matchSuffix}`;
		return text.length > width ? text.slice(0, width) : text;
	}

	private highlightVisibleLines(lines: string[], startLine: number): string[] {
		if (!this.options.highlightMatch || !this.lastSearchQuery) {
			return lines;
		}

		return lines.map((line, index) => {
			const lineIndex = startLine + index;
			if (!this.lineContainsMatch(lineIndex)) {
				return line;
			}

			const plainLine = stripAnsiSequences(line).replace(/\t/g, "   ");
			const ranges = this.findMatchRanges(plainLine, this.lastSearchQuery);
			if (ranges.length === 0) {
				return line;
			}

			return this.decorateLineRanges(line, ranges, lineIndex === this.lastSearchMatches[this.lastSearchMatchIndex]);
		});
	}

	private decorateVisibleLines(lines: string[], startLine: number, width: number): string[] {
		if (!this.options.decorateLine) {
			return lines;
		}

		return lines.map((line, index) => {
			const lineIndex = startLine + index;
			const matchOrdinal = this.lastSearchMatchOrdinalByLine.get(lineIndex);
			return (
				this.options.decorateLine?.(width, line, {
					lineIndex,
					containsMatch: matchOrdinal !== undefined,
					isActiveMatch: matchOrdinal !== undefined && matchOrdinal - 1 === this.lastSearchMatchIndex,
					matchOrdinal,
					totalMatches: this.lastSearchMatches.length || undefined,
					query: this.lastSearchDisplayQuery || undefined,
				}) ?? line
			);
		});
	}

	private decorateLineRanges(line: string, ranges: Array<{ start: number; length: number }>, active: boolean): string {
		let result = "";
		let cursor = 0;
		const lineWidth = visibleWidth(line);

		for (const range of ranges) {
			if (range.start > cursor) {
				result += sliceWithWidth(line, cursor, range.start - cursor).text;
			}
			const segment = sliceWithWidth(line, range.start, range.length).text;
			result += this.options.highlightMatch?.(segment, active) ?? segment;
			cursor = range.start + range.length;
		}

		if (cursor < lineWidth) {
			result += sliceWithWidth(line, cursor, lineWidth - cursor).text;
		}
		return result;
	}

	private findMatchRanges(line: string, query: string): Array<{ start: number; length: number }> {
		const ranges: Array<{ start: number; length: number }> = [];
		let searchStart = 0;
		while (searchStart < line.length) {
			const index = line.toLowerCase().indexOf(query, searchStart);
			if (index === -1) {
				break;
			}
			ranges.push({ start: index, length: query.length });
			searchStart = index + query.length;
		}
		return ranges;
	}

	private lineContainsMatch(lineIndex: number): boolean {
		return this.lastSearchMatchOrdinalByLine.has(lineIndex);
	}

	private countMatchesInRange(start: number, end: number): number {
		if (this.lastSearchMatches.length === 0 || start >= end) {
			return 0;
		}
		const startIndex = this.findFirstMatchAtOrAfter(start);
		const endIndex = this.findFirstMatchAtOrAfter(end);
		return Math.max(0, endIndex - startIndex);
	}

	private getTotalLineCount(width: number): number {
		const content = this.content as ScrollViewportLineSource;
		if (content.getTotalLineCount) {
			return content.getTotalLineCount(width);
		}
		return this.content.render(width).length;
	}

	private renderLineSlice(width: number, startLine: number, endLine: number): string[] {
		const content = this.content as ScrollViewportLineSource;
		if (content.renderLineSlice) {
			return content.renderLineSlice(width, startLine, endLine);
		}
		return this.content.render(width).slice(startLine, endLine);
	}

	private getPlainTextLines(width: number): string[] {
		const content = this.content as ScrollViewportLineSource;
		if (content.getPlainTextLines) {
			return content.getPlainTextLines(width);
		}
		return this.content.render(width).map((line) => stripAnsiSequences(line).replace(/\t/g, "   "));
	}

	private getSearchMatches(width: number, query: string): number[] {
		const content = this.content as ScrollViewportLineSource;
		if (content.getSearchMatches) {
			return content.getSearchMatches(width, query);
		}
		const plainLines = this.getPlainTextLines(width);
		const matches: number[] = [];
		for (let i = 0; i < plainLines.length; i++) {
			if (plainLines[i].toLowerCase().includes(query)) {
				matches.push(i);
			}
		}
		return matches;
	}

	private renderTrailingLines(
		width: number,
		lineCount: number,
	): { lines: string[]; startLine: number; totalLines: number } | undefined {
		const content = this.content as ScrollViewportLineSource;
		return content.renderTrailingLines?.(width, lineCount);
	}

	private setBrowsingHistoryMode(browsingHistory: boolean): void {
		const content = this.content as ScrollViewportLineSource;
		content.setBrowsingHistory?.(browsingHistory);
	}

	private getChildAlignedStartLine(width: number, lineIndex: number, availableHeight: number): number | undefined {
		const content = this.content as ScrollViewportLineSource;
		if (!content.getChildIndexAtLine || !content.getChildMetrics) {
			return undefined;
		}

		const childIndex = content.getChildIndexAtLine(width, lineIndex);
		const metrics = content.getChildMetrics(width, childIndex);
		if (!metrics || metrics.height <= 0) {
			return undefined;
		}

		const headroom = Math.min(2, Math.max(0, availableHeight - metrics.height));
		const totalLines = this.getTotalLineCount(width);
		const maxStart = Math.max(0, totalLines - availableHeight);
		return Math.max(0, Math.min(maxStart, metrics.startLine - headroom));
	}

	private rebuildSearchMatchOrdinalIndex(): void {
		this.lastSearchMatchOrdinalByLine.clear();
		for (let i = 0; i < this.lastSearchMatches.length; i++) {
			this.lastSearchMatchOrdinalByLine.set(this.lastSearchMatches[i], i + 1);
		}
	}

	private findFirstMatchAtOrAfter(target: number): number {
		let low = 0;
		let high = this.lastSearchMatches.length;
		while (low < high) {
			const mid = Math.floor((low + high) / 2);
			if (this.lastSearchMatches[mid] < target) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low;
	}
}
