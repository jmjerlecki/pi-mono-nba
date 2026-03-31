import {
	type ScrollOverflowDirection,
	type ScrollSearchResult,
	ScrollViewport,
	type ScrollViewportState,
} from "@mariozechner/pi-tui";

export type TranscriptViewportState = ScrollViewportState;
export type TranscriptOverflowDirection = ScrollOverflowDirection;
export type TranscriptSearchResult = ScrollSearchResult;

export class TranscriptViewportComponent extends ScrollViewport {}
