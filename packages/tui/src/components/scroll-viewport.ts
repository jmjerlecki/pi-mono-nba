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

export interface ScrollViewportOptions {
	getAvailableHeight: (width: number) => number;
	getPinnedContext?: () => string | undefined;
	getOverflowLine?: (width: number, info: ScrollOverflowInfo) => string;
	getPinnedContextLine?: (width: number, context: string) => string;
	highlightMatch?: (text: string, active: boolean) => string;
}

interface ScrollViewportLineSource extends Component {
	getTotalLineCount?(width: number): number;
	renderLineSlice?(width: number, startLine: number, endLine: number): string[];
	getPlainTextLines?(width: number): string[];
	renderTrailingLines?(width: number, lineCount: number): { lines: string[]; startLine: number; totalLines: number };
}

export class ScrollViewport implements Component {
	private offsetFromBottom = 0;
	private lastAvailableHeight = 0;
	private lastMaxOffset = 0;
	private lastState: ScrollViewportState = { atLatest: true, hiddenAbove: 0, hiddenBelow: 0 };
	private lastRenderedPlainLines: string[] = [];
	private lastVisibleStart = 0;
	private lastRenderedWidth = 0;
	private lastSearchQuery = "";
	private lastSearchDisplayQuery = "";
	private lastSearchMatches: number[] = [];
	private lastSearchMatchIndex = -1;

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

		let totalLines = this.getTotalLineCount(width);
		let maxOffset = Math.max(0, totalLines - availableHeight);
		this.lastMaxOffset = maxOffset;
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
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
				const highlightedTrailingLines = this.highlightVisibleLines(trailing.lines, trailing.startLine);
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
		visibleLines = this.highlightVisibleLines(visibleLines, start);
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
			return undefined;
		}

		if (normalized !== this.lastSearchQuery) {
			this.lastSearchQuery = normalized;
			this.lastSearchDisplayQuery = query.trim();
			this.lastRenderedPlainLines = this.getPlainTextLines(this.lastRenderedWidth);
			this.lastSearchMatches = [];
			for (let i = 0; i < this.lastRenderedPlainLines.length; i++) {
				if (this.lastRenderedPlainLines[i].toLowerCase().includes(normalized)) {
					this.lastSearchMatches.push(i);
				}
			}
			this.lastSearchMatchIndex = -1;
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
		const maxStart = Math.max(0, this.lastRenderedPlainLines.length - availableHeight);
		const targetStart = Math.max(0, Math.min(maxStart, lineIndex - Math.floor(availableHeight / 3)));
		const targetEnd = Math.min(this.lastRenderedPlainLines.length, targetStart + availableHeight);
		this.offsetFromBottom = Math.max(0, this.lastRenderedPlainLines.length - targetEnd);
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
		return this.lastSearchMatches.includes(lineIndex);
	}

	private countMatchesInRange(start: number, end: number): number {
		let count = 0;
		for (const lineIndex of this.lastSearchMatches) {
			if (lineIndex >= start && lineIndex < end) {
				count++;
			}
		}
		return count;
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

	private renderTrailingLines(
		width: number,
		lineCount: number,
	): { lines: string[]; startLine: number; totalLines: number } | undefined {
		const content = this.content as ScrollViewportLineSource;
		return content.renderTrailingLines?.(width, lineCount);
	}
}
