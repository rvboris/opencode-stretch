// Adapted from cc-stretch hooks/parse.ts (MIT; see UPSTREAM.md and licenses/cc-stretch-MIT.txt).
// Unlike upstream text-derived keys, keys here are deterministic structural paths.
export type Segment = string | Stretch;
export type Stretch = {
	key: string;
	short: string;
	long: Segment[] | undefined;
	isClosed: boolean;
};
export const KEY_SEPARATOR = '/';
export const MAX_BODY = 65536;
export const MAX_DEPTH = 16;
export const MAX_STRETCHES = 256;
export function parse(text: string): Segment[] {
	if (text.length > MAX_BODY) throw new Error('Stretch body too large');
	const root: Segment[] = [];
	const stack: { stretch: Stretch; children: number }[] = [];
	let roots = 0,
		count = 0;
	const write = (chunk: string) => {
		const frame = stack.at(-1);
		if (frame && frame.stretch.long === undefined) {
			frame.stretch.short += chunk;
			return;
		}
		const dest = frame?.stretch.long ?? root;
		const last = dest.at(-1);
		if (typeof last === 'string') dest[dest.length - 1] = last + chunk;
		else dest.push(chunk);
	};
	for (let i = 0; i < text.length; ) {
		// Copy fenced and inline code literally: braces in code are not stretches.
		if (i === 0 || text[i - 1] === '\n') {
			const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(text.slice(i));
			if (opening) {
				const delimiter = opening[1]!;
				const close = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*\\r?$`, 'm');
				const start = i + opening[0].length;
				const end = close.exec(text.slice(start));
				if (!end) throw new Error('Unclosed code fence');
				const stop = start + end.index + end[0].length;
				write(text.slice(i, stop));
				i = stop;
				continue;
			}
		}
		if (text[i] === '`') {
			const run = /^`+/.exec(text.slice(i))![0];
			let end = i + run.length,
				matched = false;
			while (end < text.length) {
				const next = text.indexOf('`', end);
				if (next < 0) {
					end = -1;
					break;
				}
				const candidate = /^`+/.exec(text.slice(next))![0];
				if (candidate.length === run.length) {
					end = next + run.length;
					matched = true;
					break;
				}
				end = next + candidate.length;
			}
			if (!matched) throw new Error('Unclosed code span');
			write(text.slice(i, end));
			i = end;
			continue;
		}
		const frame = stack.at(-1);
		if (text.startsWith('{{', i)) {
			if (frame && frame.stretch.long === undefined) throw new Error('Nested short form');
			if (stack.length >= MAX_DEPTH || ++count > MAX_STRETCHES)
				throw new Error('Stretch complexity limit');
			const key = frame ? `${frame.stretch.key}/${frame.children++}` : `${roots++}`;
			const stretch: Stretch = { key, short: '', long: undefined, isClosed: false };
			(frame?.stretch.long ?? root).push(stretch);
			stack.push({ stretch, children: 0 });
			i += 2;
			continue;
		}
		if (text.startsWith('}}', i)) {
			if (!frame || !frame.stretch.short.trim() || frame.stretch.long === undefined)
				throw new Error('Invalid closing stretch');
			frame.stretch.isClosed = true;
			stack.pop();
			i += 2;
			continue;
		}
		if (text[i] === '|' && frame && frame.stretch.long === undefined) {
			frame.stretch.long = [];
			i++;
			continue;
		}
		write(text[i++]!);
	}
	if (stack.length) throw new Error('Unclosed stretch');
	return root;
}
export function stretches(segments: Segment[]): Stretch[] {
	const result: Stretch[] = [],
		todo = [...segments].reverse();
	while (todo.length) {
		const next = todo.pop()!;
		if (typeof next === 'string') continue;
		result.push(next);
		if (next.long) todo.push(...[...next.long].reverse());
	}
	return result;
}
export function validateSegments(segments: Segment[]): boolean {
	return stretches(segments).every((s) => s.isClosed && s.long !== undefined && !!s.short.trim());
}
export function collapsedText(segments: Segment[]): string {
	return segments.map((s) => (typeof s === 'string' ? s : s.short)).join('');
}
