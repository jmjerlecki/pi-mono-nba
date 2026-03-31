import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export interface ComposerQueueItem {
	kind: "steering" | "followUp";
	text: string;
}

export interface ComposerQueueSnapshot {
	items: ComposerQueueItem[];
	dequeueHint?: string;
}

function normalizeSingleLine(text: string): string {
	return text
		.replace(/[\r\n\t]+/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export class ComposerQueueComponent implements Component {
	constructor(private readonly getSnapshot: () => ComposerQueueSnapshot) {}

	invalidate(): void {
		// Stateless: render derives all content from the snapshot callback.
	}

	render(width: number): string[] {
		const snapshot = this.getSnapshot();
		if (snapshot.items.length === 0) {
			return [];
		}

		const lines: string[] = [];
		const visibleItems = snapshot.items.slice(0, 2);

		for (const item of visibleItems) {
			const label =
				item.kind === "steering"
					? theme.bold(theme.fg("warning", "[steer]"))
					: theme.bold(theme.fg("accent", "[follow-up]"));
			const preview = normalizeSingleLine(item.text);
			lines.push(truncateToWidth(`${label} ${preview}`, width, theme.fg("dim", "...")));
		}

		if (snapshot.items.length > visibleItems.length) {
			const remaining = snapshot.items.length - visibleItems.length;
			lines.push(
				truncateToWidth(
					theme.fg("dim", `+${remaining} more queued message${remaining === 1 ? "" : "s"}`),
					width,
					"",
				),
			);
		}

		if (snapshot.dequeueHint) {
			lines.push(truncateToWidth(theme.fg("dim", `↳ ${snapshot.dequeueHint} to edit queue`), width, ""));
		}

		return lines;
	}
}
