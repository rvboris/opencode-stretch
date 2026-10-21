import type { SessionMessageInfo } from '@opencode/client/promise';
import type { Plugin } from '@opencode/plugin';
import type { RpcHandlers } from '@opencode/plugin/promise/rpc';
import { expect, test } from 'vitest';
import { extractStretchBlocks, parseStretchPayload } from '../src/core/format.js';
import { decodeIdentity } from '../src/core/identity.js';
import { MAX_BODY, parse, stretches } from '../src/core/parse.js';
import plugin from '../src/index.js';
import { StretchRpc } from '../src/rpc.js';
import { StateStore } from '../src/server/state.js';

const scope = { directory: '/project' };
const user = (id: string): SessionMessageInfo => ({
	id,
	type: 'user',
	text: 'question',
	time: { created: 1 },
});
const block = (token: string, label = 'one', body = '{{short|long}}') =>
	`\`\`\`stretch\nv1 ${token} ${label}\n${body}\n\`\`\``;
const assistant = (
	id: string,
	text: string,
	completed: number | undefined = 2,
): SessionMessageInfo => ({
	id,
	type: 'assistant',
	time: { created: 1, completed },
	agent: 'build',
	model: { providerID: 'p', modelID: 'm' },
	content: [{ type: 'text', text }],
});
function harness() {
	const data = new Map<string, unknown>(),
		sessions = new Map<string, SessionMessageInfo[]>();
	let hook:
		| ((event: { sessionID: string; system: { type: 'text'; text: string }[] }) => Promise<void>)
		| undefined;
	let handlers: RpcHandlers<typeof StretchRpc> | undefined;
	let disposed = 0,
		fail = false,
		rpcFail = false;
	// SDK services unrelated to this plugin are deliberately absent from this runtime fixture.
	const ctx = {
		location: scope,
		storage: {
			get: async (k: string) => {
				if (fail) throw Error('storage');
				return data.get(k);
			},
			set: async (k: string, v: unknown) => {
				if (fail) throw Error('storage');
				data.set(k, v);
			},
		},
		session: {
			context: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID) ?? [],
			hook: async (_: string, cb: typeof hook) => {
				hook = cb;
				return {
					dispose: async () => {
						disposed++;
					},
				};
			},
		},
		rpc: {
			register: async (_: unknown, cb: typeof handlers) => {
				if (rpcFail) throw Error('register');
				handlers = cb;
				return {
					dispose: async () => {
						disposed++;
					},
				};
			},
		},
	};
	return {
		data,
		sessions,
		ctx,
		setFail: (v: boolean) => {
			fail = v;
		},
		setRpcFail: () => {
			rpcFail = true;
		},
		disposed: () => disposed,
		setup: () => plugin.setup(ctx as unknown as Plugin.Context),
		async context(sessionID = 's') {
			const event = { sessionID, system: [] as { type: 'text'; text: string }[] };
			await hook!(event);
			return event.system[0]?.text;
		},
		resolve: (token: string, label = 'one', sessionID = 's') =>
			handlers!.resolveBlock(
				{ sessionID, turnToken: token, blockLabel: label },
				{ signal: new AbortController().signal, error: {} },
			),
		open: (identity: string, stretchKey = '0') =>
			handlers!.recordOpened(
				{ identity, stretchKey },
				{ signal: new AbortController().signal, error: {} },
			),
	};
}
function token(guide: string | undefined) {
	return /first line is exactly: v1 ([\w-]+)/.exec(guide ?? '')![1]!;
}

test('E2E telemetry, continuation and restart freeze snapshot; prior turns stay resolvable', async () => {
	const h = harness();
	await h.setup();
	h.sessions.set('s', [user('A')]);
	const t = token(await h.context());
	h.sessions
		.get('s')!
		.push(assistant('reply', block(t, 'one', '{{short|long}} {{second|details}}')));
	const r = await h.resolve(t);
	expect(r.valid).toBe(true);
	if (!r.valid) throw Error('resolve');
	expect(await h.open(r.identity)).toEqual({ recorded: true });
	expect(await h.open(r.identity)).toEqual({ recorded: true });
	h.sessions.get('s')!.push(user('B'));
	const guide = await h.context();
	expect(guide).toContain('["short"]');
	expect(await h.open(r.identity, '1')).toEqual({ recorded: true });
	expect(await h.context()).toBe(guide);
	await h.setup();
	expect(await h.context()).toBe(guide);
	expect((await h.resolve(t)).valid).toBe(true);
	expect(await h.open(r.identity, 'missing')).toEqual({ recorded: false });
	for (const index of [1, 3, 4, 5, 6, 7, 8]) {
		const id = JSON.parse(r.identity);
		id[index] = index === 6 ? 99 : 'wrong';
		expect(await h.open(JSON.stringify(id))).toEqual({ recorded: false });
	}
	expect(await h.open(`${r.identity}suffix`)).toEqual({ recorded: false });
	expect((await h.resolve(t, 'one', 'other')).valid).toBe(false);
});

test('sessions isolate identical user IDs, incomplete/error/duplicate replies reject', async () => {
	const h = harness();
	await h.setup();
	h.sessions.set('s', [user('A')]);
	h.sessions.set('other', [user('A')]);
	const t = token(await h.context()),
		other = token(await h.context('other'));
	expect(t).not.toBe(other);
	h.sessions.get('s')!.push(assistant('r', block(t), NaN));
	expect((await h.resolve(t)).valid).toBe(false);
	h.sessions.set('s', [user('A'), assistant('r', `${block(t)}\n${block(t)}`)]);
	expect((await h.resolve(t)).valid).toBe(false);
	h.sessions.set('s', [user('A'), assistant('r', block(t).slice(0, -3))]);
	expect((await h.resolve(t)).valid).toBe(false);
	const a = assistant('r', block(t));
	if (a.type !== 'assistant') throw Error();
	a.finish = 'error';
	h.sessions.set('s', [user('A'), a]);
	expect((await h.resolve(t)).valid).toBe(false);
});

test('content indices preserved, reasoning/user content untrusted and compaction rejects', async () => {
	const h = harness();
	await h.setup();
	h.sessions.set('s', [user('A')]);
	const t = token(await h.context());
	const a = assistant('r', block(t));
	if (a.type !== 'assistant') throw Error();
	a.content.unshift({ type: 'reasoning', text: block(t) });
	h.sessions.get('s')!.push(a);
	const r = await h.resolve(t);
	if (!r.valid) throw Error('resolve');
	expect(decodeIdentity(r.identity)?.[6]).toBe(1);
	h.sessions.set('s', [a]);
	expect((await h.resolve(t)).valid).toBe(false);
});

test('storage failures safe, missing users omit guide, partial setup cleans up', async () => {
	const h = harness();
	await h.setup();
	expect(await h.context()).toBeUndefined();
	h.sessions.set('s', [user('A')]);
	h.setFail(true);
	expect(await h.context()).toBeUndefined();
	expect((await h.resolve('abcdefgh')).valid).toBe(false);
	h.setFail(false);
	const t = token(await h.context());
	expect(t.length).toBeGreaterThan(8);
	for (const k of h.data.keys()) h.data.set(k, { token: 3, feedback: 'bad' });
	expect(token(await h.context())).not.toBe(t);
	const broken = harness();
	broken.setRpcFail();
	await expect(broken.setup()).rejects.toThrow('register');
	expect(broken.disposed()).toBe(1);
});

test('locks serialize and release after failure, independent openings persist', async () => {
	const values = new Map(),
		state = new StateStore(
			{
				get: async (k) => values.get(k),
				set: async (k, v) => {
					values.set(k, v);
				},
			},
			scope,
		);
	const order: number[] = [];
	await Promise.allSettled([
		state.withSessionLock('s', async () => {
			order.push(1);
			await Promise.resolve();
			order.push(2);
			throw Error();
		}),
		state.withSessionLock('s', async () => {
			order.push(3);
		}),
	]);
	expect(order).toEqual([1, 2, 3]);
	await state.withSessionLock('s', async () => {
		order.push(4);
	});
	expect(order).toContain(4);
	await Promise.all([state.opened('identity', '0'), state.opened('identity', '1')]);
	expect(await state.isOpened('identity', '0')).toBe(true);
	expect(await state.isOpened('identity', '1')).toBe(true);
});

test('parser structural keys, limits, literals and fence scanner', () => {
	expect(
		stretches(parse('{{x|a}} {{x|b}} {{x~2|c}} {{parent|{{x › y|d}}}}')).map((s) => s.key),
	).toEqual(['0', '1', '2', '3', '3/0']);
	expect(stretches(parse('`{{x|y}}`\n```js\n{{x|y}}\n```'))).toEqual([]);
	expect(() => parse('x'.repeat(MAX_BODY + 1))).toThrow();
	expect(() => parse('{{x|'.repeat(17) + '}}'.repeat(17))).toThrow();
	expect(parseStretchPayload('v1 abcdefgh one\n{{x|unclosed')).toBeUndefined();
	const fenced = block('abcdefgh');
	expect(extractStretchBlocks(`before\n${fenced}\nafter\n${fenced}`)).toHaveLength(2);
	expect(extractStretchBlocks(`\`\`\`\`js\n${fenced}\n\`\`\`\``)).toHaveLength(0);
	expect(extractStretchBlocks('````stretch\nv1 abcdefgh one\n{{x|y}}\n```\n````')).toHaveLength(0);
	expect(extractStretchBlocks('````stretch\nv1 abcdefgh one\n{{x|y}}\n````')).toHaveLength(1);
	expect(extractStretchBlocks('~~~stretch\nv1 abcdefgh one\n{{x|y}}\n```')).toHaveLength(0);
});

test('RPC rejects extra fields and malformed identities', async () => {
	const s = StretchRpc.methods.resolveBlock.input['~standard'];
	expect(
		(await s.validate({ sessionID: 's', turnToken: 'abcdefgh', blockLabel: 'one', prose: 'evil' }))
			.issues,
	).toBeDefined();
	expect(
		(
			await StretchRpc.methods.recordOpened.input['~standard'].validate({
				identity: 'bad',
				stretchKey: '0',
			})
		).issues,
	).toBeDefined();
});
