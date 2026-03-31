import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export interface ComposerStatusSnapshot {
	mode: "chat" | "bash";
	modelName: string;
	thinkingLabel?: string;
	isStreaming: boolean;
	statusText?: string;
	hints: string[];
}

function sanitizeInline(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return (
		text
			.replace(/[\r\n\t]+/g, " ")
			.replace(/ +/g, " ")
			.trim() || undefined
	);
}

function fitLine(left: string, right: string, width: number): string {
	if (width <= 0) return "";

	let effectiveRight = right;
	const maxRightWidth = Math.max(12, Math.floor(width * 0.45));
	if (visibleWidth(effectiveRight) > maxRightWidth) {
		effectiveRight = truncateToWidth(effectiveRight, maxRightWidth, theme.fg("dim", "..."));
	}

	const gap = 2;
	const availableLeft = width - gap - visibleWidth(effectiveRight);
	if (availableLeft <= 0) {
		return truncateToWidth(effectiveRight, width, theme.fg("dim", "..."));
	}

	const effectiveLeft =
		visibleWidth(left) > availableLeft ? truncateToWidth(left, availableLeft, theme.fg("dim", "...")) : left;
	const padding = " ".repeat(Math.max(gap, width - visibleWidth(effectiveLeft) - visibleWidth(effectiveRight)));
	return effectiveLeft + padding + effectiveRight;
}

export class ComposerStatusComponent implements Component {
	constructor(private readonly getSnapshot: () => ComposerStatusSnapshot) {}

	invalidate(): void {
		// Stateless: all data is read from the snapshot callback during render.
	}

	render(width: number): string[] {
		const snapshot = this.getSnapshot();
		const modeBadge =
			snapshot.mode === "bash"
				? theme.bold(theme.fg("bashMode", "[bash]"))
				: theme.bold(theme.fg("accent", "[chat]"));

		const stateLabel = snapshot.isStreaming ? theme.fg("warning", "[working]") : undefined;
		const thinkingLabel = snapshot.thinkingLabel ? theme.fg("muted", `think:${snapshot.thinkingLabel}`) : undefined;
		const modelLabel = theme.bold(snapshot.modelName);

		const left = [modeBadge, stateLabel, modelLabel, thinkingLabel].filter(Boolean).join(" ");
		const right = theme.fg("dim", sanitizeInline(snapshot.statusText) ?? "Ask, edit, or run bash");

		const separator = theme.fg("borderMuted", " | ");
		const hintsLine = snapshot.hints.join(separator);

		return [fitLine(left, right, width), truncateToWidth(hintsLine, width, theme.fg("dim", "..."))];
	}
}
