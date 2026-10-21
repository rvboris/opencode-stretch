import { TextBuffer, TextBufferView } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { expect, test } from 'vitest';
import { createStretchRenderer } from '../src/renderer';
import { parseAgreedBlock } from '../src/tui';

for (const width of [80, 40, 13, 8])
	for (const extra of ['', '👩‍💻界😀', '\t', '\n', '\r\n']) {
		test(`collapse visible arrow after long Cyrillic wrap at ${width} extra ${JSON.stringify(extra)}`, async () => {
			const t = await createTestRenderer({ width, height: 400 });
			const opened = new Set<string>();
			const detail = (
				'Это длинное объяснение с несколькими словами, которое переносится на следующие строки. ' +
				extra
			).repeat(3);
			const block = createStretchRenderer(
				t.renderer,
				parseAgreedBlock(`v1 tokentoken123 b1\n{{кратко|${detail}}}`, 's', 'm', 'b')!,
				{
					isOpen: (_, key) => opened.has(key!),
					setOpen: (_, open, key) => {
						open ? opened.add(key!) : opened.delete(key!);
					},
				},
			);
			t.renderer.root.add(block);
			try {
				await t.renderOnce();
				await t.mockMouse.click(0, 0);
				await t.renderOnce();
				expect(opened.size).toBe(1);
				const rows = t.captureCharFrame().split('\n');
				const y = rows.findIndex((row) => row.includes('«'));
				expect(y).toBeGreaterThanOrEqual(0);
				const buffer = TextBuffer.create(t.renderer.widthMethod);
				const measure = TextBufferView.create(buffer);
				buffer.setText(rows[y]!.slice(0, rows[y]!.indexOf('«')));
				const x = measure.lineInfo.lineWidthCols[0] ?? 0;
				measure.destroy();
				buffer.destroy();
				await t.mockMouse.click(x, y);
				await t.renderOnce();
				expect(opened.size).toBe(0);
				expect(t.captureCharFrame()).toContain('кратко');
			} finally {
				t.renderer.destroy();
			}
		});
	}
