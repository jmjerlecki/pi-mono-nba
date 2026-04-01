/**
 * Utilities for formatting keybinding hints in the UI.
 */

import { getKeybindings, type Keybinding, type KeyId } from "@mariozechner/pi-tui";
import {
	APP_ACTION_TO_KEYBINDING,
	type AppAction,
	type AppKeybinding,
	type KeybindingsManager,
	resolveAppKeybinding,
} from "../../../core/keybindings.js";
import { theme } from "../theme/theme.js";

const EDITOR_ACTION_TO_KEYBINDING = {
	cursorUp: "tui.editor.cursorUp",
	cursorDown: "tui.editor.cursorDown",
	cursorLeft: "tui.editor.cursorLeft",
	cursorRight: "tui.editor.cursorRight",
	cursorWordLeft: "tui.editor.cursorWordLeft",
	cursorWordRight: "tui.editor.cursorWordRight",
	cursorLineStart: "tui.editor.cursorLineStart",
	cursorLineEnd: "tui.editor.cursorLineEnd",
	jumpForward: "tui.editor.jumpForward",
	jumpBackward: "tui.editor.jumpBackward",
	pageUp: "tui.editor.pageUp",
	pageDown: "tui.editor.pageDown",
	deleteCharBackward: "tui.editor.deleteCharBackward",
	deleteCharForward: "tui.editor.deleteCharForward",
	deleteWordBackward: "tui.editor.deleteWordBackward",
	deleteWordForward: "tui.editor.deleteWordForward",
	deleteToLineStart: "tui.editor.deleteToLineStart",
	deleteToLineEnd: "tui.editor.deleteToLineEnd",
	yank: "tui.editor.yank",
	yankPop: "tui.editor.yankPop",
	undo: "tui.editor.undo",
	submit: "tui.input.submit",
	newLine: "tui.input.newLine",
	tab: "tui.input.tab",
	copy: "tui.input.copy",
} as const satisfies Record<string, Keybinding>;

export type EditorAction = keyof typeof EDITOR_ACTION_TO_KEYBINDING;

function resolveEditorKeybinding(action: EditorAction | Keybinding): Keybinding {
	return action in EDITOR_ACTION_TO_KEYBINDING
		? EDITOR_ACTION_TO_KEYBINDING[action as EditorAction]
		: (action as Keybinding);
}

function isEditorAction(value: string): value is EditorAction {
	return value in EDITOR_ACTION_TO_KEYBINDING;
}

function isAppAction(value: string): value is AppAction {
	return value in APP_ACTION_TO_KEYBINDING;
}

function formatKeys(keys: KeyId[]): string {
	if (keys.length === 0) return "";
	if (keys.length === 1) return keys[0]!;
	return keys.join("/");
}

export function keyText(keybinding: Keybinding): string {
	return formatKeys(getKeybindings().getKeys(keybinding));
}

export function editorKey(action: EditorAction | Keybinding): string {
	return formatKeys(getKeybindings().getKeys(resolveEditorKeybinding(action)));
}

export function appKey(manager: KeybindingsManager, action: AppAction | AppKeybinding): string {
	return formatKeys(manager.getKeys(resolveAppKeybinding(action)));
}

export function keyHint(
	keybinding: Keybinding | EditorAction | AppAction | AppKeybinding,
	description: string,
	manager?: KeybindingsManager,
): string {
	const text =
		typeof keybinding === "string" && isEditorAction(keybinding)
			? editorKey(keybinding)
			: typeof keybinding === "string" && (keybinding.startsWith("app.") || isAppAction(keybinding))
				? manager
					? appKey(manager, keybinding as AppAction | AppKeybinding)
					: formatKeys(getKeybindings().getKeys(resolveAppKeybinding(keybinding as AppAction | AppKeybinding)))
				: keyText(resolveEditorKeybinding(keybinding as EditorAction | Keybinding));
	return theme.fg("dim", text) + theme.fg("muted", ` ${description}`);
}

export function appKeyHint(
	manager: KeybindingsManager,
	action: AppAction | AppKeybinding,
	description: string,
): string {
	return theme.fg("dim", appKey(manager, action)) + theme.fg("muted", ` ${description}`);
}

export function rawKeyHint(key: string, description: string): string {
	return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}
