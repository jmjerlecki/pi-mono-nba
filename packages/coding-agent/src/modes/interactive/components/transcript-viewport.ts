import {
	type ScrollOverflowDirection,
	type ScrollOverflowInfo,
	type ScrollSearchResult,
	ScrollViewport,
	type ScrollViewportLineInfo,
	type ScrollViewportState,
} from "@mariozechner/pi-tui";

export type TranscriptViewportState = ScrollViewportState;
export type TranscriptOverflowInfo = ScrollOverflowInfo;
export type TranscriptOverflowDirection = ScrollOverflowDirection;
export type TranscriptSearchResult = ScrollSearchResult;
export type TranscriptViewportLineInfo = ScrollViewportLineInfo;

export class TranscriptViewportComponent extends ScrollViewport {}
