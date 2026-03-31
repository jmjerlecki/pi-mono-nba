import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import { theme } from "../theme/theme.js";

export interface TranscriptViewportState {
	atLatest: boolean;
	hiddenAbove: number;
	hiddenBelow: number;
}

export type TranscriptOverflowDirection = "earlier" | "newer";

export interface TranscriptSearchResult {
	query: string;
	totalMatches: number;
	activeMatch: number;
	lineIndex: number;
}

export class TranscriptViewportComponent implements Component {
	private offsetFromBottom = 0;
	private lastAvailableHeight = 0;
	private lastMaxOffset = 0;
	private lastState: TranscriptViewportState = { atLatest: true, hiddenAbove: 0, hiddenBelow: 0 };
	private lastRenderedPlainLines: string[] = [];
	private lastVisibleStart = 0;
	private lastSearchQuery = "";
	private lastSearchDisplayQuery = "";
	private lastSearchMatches: number[] = [];
	private lastSearchMatchIndex = -1;

	constructor(
		private readonly transcript: Component,
		private readonly getAvailableHeight: (width: number) => number,
		private readonly getPinnedContext?: () => string | undefined,
		private readonly getOverflowHint?: (direction: TranscriptOverflowDirection) => string | undefined,
	) {}

	invalidate(): void {
		this.transcript.invalidate?.();
	}

	isAtLatest(): boolean {
		return this.offsetFromBottom === 0;
	}

	getState(): TranscriptViewportState {
		return this.lastState;
	}

	getSearchQuery(): string | undefined {
		return this.lastSearchDisplayQuery || undefined;
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

	searchNext(query: string): TranscriptSearchResult | undefined {
		return this.search(query, "next");
	}

	searchPrevious(query: string): TranscriptSearchResult | undefined {
		return this.search(query, "prev");
	}

	render(width: number): string[] {
		const lines = this.transcript.render(width);
		this.lastRenderedPlainLines = lines.map((line) => stripAnsi(line).replace(/\t/g, "   "));
		const availableHeight = Math.max(0, this.getAvailableHeight(width));
		this.lastAvailableHeight = availableHeight;
		if (availableHeight <= 0) {
			return [];
		}

		const maxOffset = Math.max(0, lines.length - availableHeight);
		this.lastMaxOffset = maxOffset;
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		if (lines.length <= availableHeight && this.offsetFromBottom === 0) {
			return lines;
		}

		const start = Math.max(0, lines.length - availableHeight - this.offsetFromBottom);
		const end = Math.min(lines.length, start + availableHeight);
		this.lastVisibleStart = start;
		const hiddenAbove = start;
		const hiddenBelow = Math.max(0, lines.length - end);
		this.lastState = {
			atLatest: this.offsetFromBottom === 0,
			hiddenAbove,
			hiddenBelow,
		};
		const pinnedContext = this.offsetFromBottom > 0 ? this.getPinnedContext?.() : undefined;

		if (hiddenAbove === 0 && hiddenBelow === 0) {
			return lines.slice(start, end);
		}

		const visibleLines = lines.slice(start, end);
		const topReservedRows = Number(Boolean(pinnedContext) || hiddenAbove > 0);
		const bottomReservedRows = Number(hiddenBelow > 0);
		const overflowRows = topReservedRows + bottomReservedRows;
		const contentHeight = Math.max(0, availableHeight - overflowRows);

		if (contentHeight === 0) {
			if (pinnedContext) {
				return [this.renderPinnedContext(width, pinnedContext)];
			}
			return [this.renderOverflowLine(width, hiddenAbove > 0 ? "earlier" : "newer", hiddenAbove || hiddenBelow)];
		}

		const trimmedVisibleLines = visibleLines.slice(topReservedRows > 0 ? 1 : 0, hiddenBelow > 0 ? -1 : undefined);
		const rendered: string[] = [];
		if (pinnedContext) {
			rendered.push(this.renderPinnedContext(width, pinnedContext));
		} else if (hiddenAbove > 0) {
			rendered.push(this.renderOverflowLine(width, "earlier", hiddenAbove));
		}
		rendered.push(...trimmedVisibleLines);
		if (hiddenBelow > 0) {
			rendered.push(this.renderOverflowLine(width, "newer", hiddenBelow));
		}
		return rendered;
	}

	private getPageStep(): number {
		return Math.max(1, this.lastAvailableHeight - 2);
	}

	private search(query: string, direction: "next" | "prev"): TranscriptSearchResult | undefined {
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

	private renderOverflowLine(width: number, direction: "earlier" | "newer", hiddenLineCount: number): string {
		const countLabel = `${hiddenLineCount} ${direction} line${hiddenLineCount === 1 ? "" : "s"}`;
		const hint = this.getOverflowHint?.(direction);
		const label = hint ? `${countLabel} | ${hint}` : countLabel;
		return truncateToWidth(theme.fg("dim", `... ${label}`), width, "");
	}

	private renderPinnedContext(width: number, context: string): string {
		return truncateToWidth(theme.fg("muted", `Prompt: ${context}`), width, theme.fg("dim", "..."));
	}
}
