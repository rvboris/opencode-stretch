import { createTestRenderer } from '@opentui/core/testing';
import { expect, test } from 'vitest';
import { createStretchRenderer } from '../src/renderer';
import { parseAgreedBlock } from '../src/tui';

for (const width of [40, 13, 8]) {
	test(`inline independent hit regions and Unicode at width ${width}`, async () => {
		const t = await createTestRenderer({ width, height: 40 });
		const opened = new Set<string>();
		const changes: string[] = [];
		const block = createStretchRenderer(
			t.renderer,
			parseAgreedBlock(
				'v1 tokentoken123 b1\n界 Привет {{один|FIRST}} и {{two|SECOND}}.',
				's',
				'm',
				'b',
			)!,
			{
				isOpen: (_, key) => opened.has(key!),
				setOpen: (_, open, key) => {
					changes.push(key!);
					open ? opened.add(key!) : opened.delete(key!);
				},
			},
		);
		t.renderer.root.add(block);
		const clickText = async (text: string) => {
			const rows = t.captureCharFrame().split('\n');
			const y = rows.findIndex((row) => row.includes(text));
			expect(y).toBeGreaterThanOrEqual(0);
			const before = rows[y]!.slice(0, rows[y]!.indexOf(text));
			const x = [...before].reduce((sum, char) => sum + (char === '界' ? 2 : 1), 0);
			await t.mockMouse.click(x, y);
			await t.renderOnce();
		};
		try {
			await t.renderOnce();
			await t.mockMouse.click(0, 0);
			await t.mockMouse.click(width - 1, 20);
			expect(changes).toEqual([]);
			await clickText('two');
			expect(opened.size).toBe(1);
			expect(t.captureCharFrame()).toContain('SECOND');
			t.resize(40, 40);
			await t.renderOnce();
			await clickText('один');
			expect(opened.size).toBe(2);
			expect(t.captureCharFrame()).toContain('界 Привет FIRST « и SECOND «.');
			await clickText('«');
			expect(opened.size).toBe(1);
			expect(t.captureCharFrame()).toContain('один и SECOND');
		} finally {
			t.renderer.destroy();
		}
	});
}
