import { createMarkdownCodeBlockRenderer, MarkdownRenderable, SyntaxStyle } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { expect, test } from 'vitest';
import { parseStretchPayload } from '../src/core/format';
import { createStretchRenderer, type StretchView } from '../src/renderer';
import plugin, { parseAgreedBlock } from '../src/tui';

const detail = 'Extra detail that should wrap cleanly in a narrow terminal without a fixed width.';
const source = (text: string) =>
	`\`\`\`stretch\nv1 tokentoken123 b1\n{{short explanation|${text}}}\n\`\`\``;
test('native mouse hit testing, wrapping, recreation, disposal with agreed format', async () => {
	const t = await createTestRenderer({ width: 32, height: 20 });
	let open = false;
	let changes = 0;
	let destroyed = 0;
	let created = 0;
	const state = {
		isOpen: () => open,
		setOpen: (_: StretchView, value: boolean) => {
			open = value;
			changes++;
		},
	};
	const renderNode = createMarkdownCodeBlockRenderer({
		stretch: (token) => {
			const view = parseAgreedBlock(token.text, 's1', 'm1', 'b1');
			if (!view) return;
			created++;
			const block = createStretchRenderer(t.renderer, view, state);
			block.on('destroyed', () => destroyed++);
			return block;
		},
	});
	const syntaxStyle = SyntaxStyle.create();
	const markdown = new MarkdownRenderable(t.renderer, {
		width: '100%',
		content: source(detail),
		syntaxStyle,
		renderNode,
	});
	t.renderer.root.add(markdown);
	try {
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('short explanation');
		expect(t.captureCharFrame()).not.toContain('Expand');
		expect(t.captureCharFrame()).not.toContain('Extra detail');
		expect(t.captureCharFrame()).not.toContain('{{');
		await t.mockMouse.click(2, 0);
		await t.renderOnce();
		expect(open).toBe(true);
		expect(changes).toBe(1);
		expect(t.captureCharFrame()).toContain('Extra detail');
		expect(t.captureCharFrame()).not.toContain('}}');
		t.resize(16, 30);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('Extra detail');
		markdown.content = source(`${detail} More streamed text.`);
		await t.renderOnce();
		expect(created).toBeGreaterThan(1);
		expect(destroyed).toBe(created - 1);
		expect(open).toBe(true);
		const lines = t.captureCharFrame().split('\n');
		const collapseRow = lines.findIndex((line) => line.includes('«'));
		await t.mockMouse.click(lines[collapseRow]!.indexOf('«'), collapseRow);
		await t.renderOnce();
		expect(open).toBe(false);
		expect(changes).toBe(2);
		markdown.content = '```stretch\nv1 tokentoken123 b1\n{{partial|unfinished';
		await t.renderOnce();
		expect(destroyed).toBe(created);
		expect(changes).toBe(2);
	} finally {
		t.renderer.destroy();
		syntaxStyle.destroy();
	}
});

test('nested fragment clicks are independent and show no raw markup', async () => {
	const t = await createTestRenderer({ width: 60, height: 20 });
	const opened = new Set<string>();
	const view = parseAgreedBlock(
		'v1 tokentoken123 b1\n{{parent|Outer {{child|Nested explanation}}}}',
		's1',
		'm1',
		'b1',
	)!;
	const block = createStretchRenderer(t.renderer, view, {
		isOpen: (_, key) => opened.has(key!),
		setOpen: (_, open, key) => {
			open ? opened.add(key!) : opened.delete(key!);
		},
	});
	t.renderer.root.add(block);
	try {
		await t.renderOnce();
		await t.mockMouse.click(2, 0);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('child');
		expect(t.captureCharFrame()).not.toContain('Nested explanation');
		const row = t
			.captureCharFrame()
			.split('\n')
			.findIndex((line) => line.includes('child'));
		await t.mockMouse.click(6, row);
		await t.renderOnce();
		expect(opened.size).toBe(2);
		expect(t.captureCharFrame()).toContain('Nested explanation');
		expect(t.captureCharFrame()).not.toContain('{{');
		await t.mockMouse.click(t.captureCharFrame().split('\n')[row]!.indexOf('«'), row);
		await t.renderOnce();
		expect(opened.size).toBe(1);
		expect(t.captureCharFrame()).not.toContain('Nested explanation');
	} finally {
		t.renderer.destroy();
	}
});

test('TUI resolves asynchronously, queues local opens and cleans subscriptions', async () => {
	const t = await createTestRenderer({ width: 60, height: 20 });
	const text = 'v1 tokentoken123 b1\n{{short|Actual explanation}}';
	const segment = parseStretchPayload(text)!.segments.find((s) => typeof s !== 'string')!;
	if (typeof segment === 'string') throw new Error('Expected parsed fragment');
	const stretchKey = segment.key;
	let callback: (token: { text: string }) => unknown;
	let listener: (() => void) | undefined;
	let resolveReply: (value: unknown) => void = () => {};
	const records: unknown[] = [];
	const scopes: unknown[] = [];
	const sessionLocation = { directory: '/project-not-server-cwd', workspaceID: 'workspace-test' };
	let metadata: { location: typeof sessionLocation } | undefined;
	let unregistered = false;
	const messages = [
		{
			id: 'm1',
			type: 'assistant',
			content: [{ type: 'text', text: `\`\`\`stretch\n${text}\n\`\`\`` }],
		},
	];
	const api = {
		renderer: t.renderer,
		location: undefined,
		client: {
			rpc: () => ({
				resolveBlock: (_input: unknown, options: unknown) =>
					new Promise((resolve) => {
						scopes.push(options);
						resolveReply = resolve;
					}),
				recordOpened: async (input: unknown, options: unknown) => {
					expect(options).toEqual({ location: sessionLocation });
					records.push(input);
					return { recorded: true };
				},
			}),
		},
		ui: { router: { current: () => ({ type: 'session', sessionID: 's1' }) } },
		data: {
			session: { get: () => metadata, message: { list: () => messages } },
			listen: (fn: () => void) => {
				listener = fn;
				return () => {
					listener = undefined;
				};
			},
		},
		markdown: {
			registerCodeBlockRenderer: (_: string, fn: unknown) => {
				callback = fn;
				return () => {
					unregistered = true;
				};
			},
		},
	};
	const cleanup = await plugin.setup(api as Parameters<typeof plugin.setup>[0]);
	try {
		const block = callback({ text });
		expect(block).toBeDefined();
		t.renderer.root.add(block);
		await t.renderOnce();
		await t.mockMouse.click(2, 0);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('Actual explanation');
		expect(records.length).toBe(0);
		expect(scopes).toEqual([]);
		metadata = { location: sessionLocation };
		listener?.();
		expect(scopes).toEqual([{ location: sessionLocation }]);
		resolveReply({
			valid: true,
			identity: 'verified',
			stretchKeys: [stretchKey],
			view: { ...parseAgreedBlock(text, 's1', 'm1', 'verified')!, blockID: 'verified' },
		});
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(records).toEqual([{ identity: 'verified', stretchKey }]);
		// Collapse is a local view change: it must not un-record or re-report.
		await t.mockMouse.click(19, 0);
		await t.renderOnce();
		expect(records.length).toBe(1);
		await t.mockMouse.click(2, 0);
		await t.renderOnce();
		// Recreated blocks restore local state, but duplicate transcript matches are rejected.
		block.destroyRecursively();
		const recreated = callback({ text });
		t.renderer.root.add(recreated);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('Actual explanation');
		messages.push(messages[0]!);
		expect(callback({ text })).toBeUndefined();
		recreated.destroyRecursively();
		resolveReply({ valid: true, view: parseAgreedBlock(text, 's1', 'm1', 'late') });
		await Promise.resolve();
		await Promise.resolve();
		// Re-expanding may re-report; the server treats recordOpened as idempotent.
		// A late reply after disposal must not add anything further.
		expect(records.length).toBe(2);
		expect(records[0]).toEqual(records[1]);
	} finally {
		if (cleanup) await cleanup();
		t.renderer.destroy();
	}
	expect(unregistered).toBe(true);
	expect(listener).toBeUndefined();
});
