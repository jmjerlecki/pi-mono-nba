import {
	type ScrollOverflowDirection,
	type ScrollOverflowInfo,
	type ScrollSearchResult,
	ScrollViewport,
	type ScrollViewportState,
} from "@mariozechner/pi-tui";

export type TranscriptViewportState = ScrollViewportState;
export type TranscriptOverflowInfo = ScrollOverflowInfo;
export type TranscriptOverflowDirection = ScrollOverflowDirection;
export type TranscriptSearchResult = ScrollSearchResult;

export class TranscriptViewportComponent extends ScrollViewport {}
