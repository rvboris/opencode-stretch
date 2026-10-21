import {
	BoxRenderable,
	type RenderContext,
	RGBA,
	StyledText,
	TextAttributes,
	TextBuffer,
	TextBufferView,
	type TextChunk,
	TextRenderable,
} from '@opentui/core';
import { parse, type Segment } from './core/parse.js';

export interface StretchView {
	sessionID: string;
	messageID: string;
	blockID: string;
	summary: string;
	detail: string;
	complete: boolean;
}
export interface StretchState {
	isOpen(view: StretchView, stretchKey?: string): boolean;
	setOpen(view: StretchView, open: boolean, stretchKey?: string): void;
}

/** Public native layout uses display columns, not JS string offsets. */
export function createStretchRenderer(
	ctx: RenderContext,
	view: StretchView,
	state: StretchState,
	runtime = {
		BoxRenderable,
		TextRenderable,
		StyledText,
		RGBA,
		TextAttributes,
		TextBuffer,
		TextBufferView,
	},
) {
	const root = new runtime.BoxRenderable(ctx, { width: '100%', flexShrink: 0 });
	let disposed = false;
	root.on('destroyed', () => {
		disposed = true;
	});
	type Zone = { line: number; start: number; end: number; key: string; open: boolean };
	let zones: Zone[] = [];
	const paragraph = new runtime.TextRenderable(ctx, {
		width: '100%',
		wrapMode: 'word',
		selectable: false,
		onMouseUp(event) {
			if (disposed || event.button !== 0) return;
			const x = event.x - paragraph.x;
			const y = event.y - paragraph.y;
			const info = paragraph.lineInfo;
			if (x < 0 || y < 0 || y >= info.lineSources.length || x >= info.lineWidthCols[y]!) return;
			// Native starts are paragraph-wide; zones are relative to each source line.
			const sourceStart = info.lineSources.indexOf(info.lineSources[y]!);
			const column = info.lineStartCols[y]! - info.lineStartCols[sourceStart]! + x;
			const zone = zones.find(
				(z) => z.line === info.lineSources[y] && column >= z.start && column < z.end,
			);
			if (!zone) return;
			event.stopPropagation();
			state.setOpen(view, !zone.open, zone.key);
			update();
		},
	});
	root.add(paragraph);
	function update() {
		const chunks: TextChunk[] = [];
		zones = [];
		// Measure with the same native width method as the host (including wide Unicode).
		const buffer = runtime.TextBuffer.create(ctx.widthMethod);
		const measure = runtime.TextBufferView.create(buffer);
		measure.setWrapMode('none');
		let line = 0;
		let prefix = '';
		function width(text: string) {
			buffer.setText(text);
			return measure.lineInfo.lineWidthCols[0] ?? 0;
		}
		function append(text: string, target?: { key: string; open: boolean }) {
			chunks.push({
				__isChunk: true,
				text,
				...(target
					? { fg: runtime.RGBA.fromHex('#72c8d5'), attributes: runtime.TextAttributes.UNDERLINE }
					: {}),
			});
			const lines = text.split('\n');
			for (const [index, part] of lines.entries()) {
				if (index) {
					line++;
					prefix = '';
				}
				const start = width(prefix);
				prefix += part;
				if (target && part) zones.push({ line, start, end: width(prefix), ...target });
			}
		}
		function visit(segments: Segment[]) {
			for (const segment of segments) {
				if (typeof segment === 'string') {
					append(segment);
					continue;
				}
				const enabled = view.complete && segment.isClosed && segment.long !== undefined;
				const open = enabled && state.isOpen(view, segment.key);
				if (open) {
					visit(segment.long!);
					append(' ');
					append('«', { key: segment.key, open: true });
				} else {
					append(segment.short, enabled ? { key: segment.key, open: false } : undefined);
				}
			}
		}
		try {
			visit(parse(view.detail));
			paragraph.content = new runtime.StyledText(chunks);
		} finally {
			measure.destroy();
			buffer.destroy();
		}
	}
	update();
	return root;
}
