import {
	type Component,
	Container,
	Spacer,
	Text,
	VirtualizedContainer,
	type VirtualizedContainerChildOptions,
} from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

interface ExpandableLike {
	setExpanded(expanded: boolean): void;
}

interface SearchTextProvider {
	getSearchText?(): string | undefined;
}

export interface TranscriptEntryOptions extends VirtualizedContainerChildOptions {
	leadingSpacer?: boolean;
}

export class TranscriptBlock extends Container {
	getSearchText(): string | undefined {
		const parts: string[] = [];
		for (const child of this.children) {
			const text = (child as SearchTextProvider).getSearchText?.();
			if (text) {
				parts.push(text);
			}
		}
		return parts.length > 0 ? parts.join("\n\n") : undefined;
	}

	setExpanded(expanded: boolean): void {
		for (const child of this.children) {
			(child as unknown as ExpandableLike).setExpanded?.(expanded);
		}
	}
}

export class TranscriptFeed extends VirtualizedContainer {
	appendComponent(component: Component, options: TranscriptEntryOptions = {}): Component {
		return this.appendComponents([component], options);
	}

	appendComponents(components: Component[], options: TranscriptEntryOptions = {}): Component {
		const block = new TranscriptBlock();
		if (options.leadingSpacer) {
			block.addChild(new Spacer(1));
		}
		for (const component of components) {
			block.addChild(component);
		}

		const { leadingSpacer: _leadingSpacer, ...childOptions } = options;
		super.addChild(block, childOptions);
		return block;
	}

	appendNotice(
		text: string,
		color: "dim" | "warning" | "error" | "accent",
		options: TranscriptEntryOptions = {},
	): Component {
		return this.appendComponents([new Text(theme.fg(color, text), 1, 0)], {
			...options,
			leadingSpacer: options.leadingSpacer ?? true,
			searchText: options.searchText ?? text,
		});
	}
}
