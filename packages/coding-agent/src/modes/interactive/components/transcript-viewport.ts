import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export class TranscriptViewportComponent implements Component {
	private offsetFromBottom = 0;
	private lastAvailableHeight = 0;

	constructor(
		private readonly transcript: Component,
		private readonly getAvailableHeight: (width: number) => number,
		private readonly getPinnedContext?: () => string | undefined,
	) {}

	invalidate(): void {
		this.transcript.invalidate?.();
	}

	isAtLatest(): boolean {
		return this.offsetFromBottom === 0;
	}

	scrollPageUp(): void {
		this.offsetFromBottom += this.getPageStep();
	}

	scrollPageDown(): void {
		this.offsetFromBottom = Math.max(0, this.offsetFromBottom - this.getPageStep());
	}

	jumpToLatest(): void {
		this.offsetFromBottom = 0;
	}

	render(width: number): string[] {
		const lines = this.transcript.render(width);
		const availableHeight = Math.max(0, this.getAvailableHeight(width));
		this.lastAvailableHeight = availableHeight;
		if (availableHeight <= 0) {
			return [];
		}

		const maxOffset = Math.max(0, lines.length - availableHeight);
		this.offsetFromBottom = Math.min(this.offsetFromBottom, maxOffset);
		if (lines.length <= availableHeight && this.offsetFromBottom === 0) {
			return lines;
		}

		const start = Math.max(0, lines.length - availableHeight - this.offsetFromBottom);
		const end = Math.min(lines.length, start + availableHeight);
		const hiddenAbove = start;
		const hiddenBelow = Math.max(0, lines.length - end);
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

	private renderOverflowLine(width: number, direction: "earlier" | "newer", hiddenLineCount: number): string {
		const label = theme.fg("dim", `... ${hiddenLineCount} ${direction} line${hiddenLineCount === 1 ? "" : "s"}`);
		return truncateToWidth(label, width, "");
	}

	private renderPinnedContext(width: number, context: string): string {
		return truncateToWidth(theme.fg("muted", `Prompt: ${context}`), width, theme.fg("dim", "..."));
	}
}
