import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export class TranscriptViewportComponent implements Component {
	constructor(
		private readonly transcript: Component,
		private readonly getAvailableHeight: (width: number) => number,
	) {}

	invalidate(): void {
		this.transcript.invalidate?.();
	}

	render(width: number): string[] {
		const lines = this.transcript.render(width);
		const availableHeight = Math.max(0, this.getAvailableHeight(width));
		if (availableHeight <= 0) {
			return [];
		}
		if (lines.length <= availableHeight) {
			return lines;
		}

		const hiddenLineCount = lines.length - availableHeight;
		if (availableHeight === 1) {
			return [this.renderOverflowLine(width, hiddenLineCount)];
		}

		const visibleLines = lines.slice(-(availableHeight - 1));
		return [this.renderOverflowLine(width, hiddenLineCount), ...visibleLines];
	}

	private renderOverflowLine(width: number, hiddenLineCount: number): string {
		const label = theme.fg("dim", `... ${hiddenLineCount} earlier line${hiddenLineCount === 1 ? "" : "s"}`);
		return truncateToWidth(label, width, "");
	}
}
