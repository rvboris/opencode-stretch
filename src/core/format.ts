import { MAX_BODY, parse, type Segment } from './parse.js';
export type StretchBlock = {
	turnToken: string;
	blockLabel: string;
	body: string;
	segments: Segment[];
};
export function parseStretchPayload(text: string): StretchBlock | undefined {
	if (text.length > MAX_BODY + 256) return;
	const header = /^v1 ([A-Za-z0-9_-]{8,128}) ([A-Za-z0-9_-]{1,64})\r?\n/.exec(text);
	if (!header) return;
	const body = text.slice(header[0].length);
	try {
		return { turnToken: header[1]!, blockLabel: header[2]!, body, segments: parse(body) };
	} catch {
		return;
	}
}
export function extractStretchBlocks(text: string): StretchBlock[] {
	if (text.length > 1048576) return [];
	const lines = text.split('\n'),
		result: StretchBlock[] = [];
	let fence: { marker: string; length: number; stretch: boolean; start: number } | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.replace(/\r$/, '');
		if (fence) {
			if (new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`).test(line)) {
				if (fence.stretch) {
					const block = parseStretchPayload(lines.slice(fence.start, i).join('\n'));
					if (block) result.push(block);
				}
				fence = undefined;
			}
			continue;
		}
		const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
		if (match)
			fence = {
				marker: match[1]![0]!,
				length: match[1]!.length,
				stretch: match[2]!.trim() === 'stretch',
				start: i + 1,
			};
	}
	return result;
}
export function parseStretchBlock(text: string): StretchBlock | undefined {
	const opening = /^ {0,3}(`{3,}|~{3,})stretch[ \t]*\r?\n/.exec(text);
	if (!opening) return;
	const blocks = extractStretchBlocks(text);
	return blocks.length === 1 ? blocks[0] : undefined;
}
