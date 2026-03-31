import { Container, type Focusable, getKeybindings, Input, Spacer, Text } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";

export interface TranscriptSearchRequest {
	query: string;
	direction: "next" | "prev";
}

export class TranscriptSearchComponent extends Container implements Focusable {
	private readonly input: Input;
	private readonly onSubmitRequest: (request: TranscriptSearchRequest) => void;
	private readonly onCancelRequest: () => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(initialQuery: string, onSubmit: (request: TranscriptSearchRequest) => void, onCancel: () => void) {
		super();
		this.onSubmitRequest = onSubmit;
		this.onCancelRequest = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", "Search Transcript"), 1, 0));
		this.addChild(new Spacer(1));

		this.input = new Input();
		this.input.setValue(initialQuery);
		this.input.onSubmit = (value) => this.onSubmitRequest({ query: value, direction: "next" });
		this.input.onEscape = () => this.onCancelRequest();
		this.addChild(this.input);

		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${keyHint("tui.select.confirm", "search")}  ${keyHint("app.transcript.searchNext", "next")}  ${keyHint("app.transcript.searchPrev", "prev")}  ${keyHint("tui.select.cancel", "cancel")}`,
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "app.transcript.searchNext")) {
			this.onSubmitRequest({ query: this.input.getValue(), direction: "next" });
			return;
		}
		if (kb.matches(data, "app.transcript.searchPrev")) {
			this.onSubmitRequest({ query: this.input.getValue(), direction: "prev" });
			return;
		}
		this.input.handleInput(data);
	}

	get width(): number {
		return 64;
	}
}
