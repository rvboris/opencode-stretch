import { Plugin } from '@opencode/plugin/tui';
import { extractStretchBlocks, parseStretchPayload } from './core/format.js';
import { createStretchRenderer, type StretchState, type StretchView } from './renderer.js';
import { StretchRpc } from './rpc.js';

/** Marked supplies the fence body, not the opening and closing fence. */
export function parseAgreedBlock(
	text: string,
	sessionID: string,
	messageID: string,
	blockID: string,
): StretchView | undefined {
	const block = parseStretchPayload(text);
	if (!block || !sessionID || !messageID || !blockID) return;
	return {
		sessionID,
		messageID,
		blockID,
		summary: block.segments.map((s) => (typeof s === 'string' ? s : s.short)).join(''),
		detail: block.body,
		complete: true,
	};
}

export default Plugin.define({
	id: 'opencode-stretch-tui',
	async setup(api) {
		// Explicit virtual module avoids cross-runtime instanceof failures in the
		// packaged Bun host. Unit-test renderers use their own local core runtime.
		const runtimeID = 'opentui:runtime-module:%40opentui%2Fcore';
		const runtime: typeof import('@opentui/core') = await import(runtimeID).catch(
			() => import('@opentui/core'),
		);
		if (!(api.renderer.root instanceof runtime.BaseRenderable)) {
			throw new Error(
				'Stretch requires the host OpenTUI runtime; refusing incompatible renderables',
			);
		}
		const rpc = api.client.rpc(StretchRpc);
		// Public SDK exposes directory; retain workspaceID when supplied by host metadata.
		type SessionLocation = NonNullable<ReturnType<typeof api.data.session.get>>['location'] & {
			workspaceID?: string;
		};
		const sessionLocation = (sessionID: string) => {
			const location = api.data.session.get(sessionID)?.location;
			return location ? { ...location } : undefined;
		};
		const scopeKey = (location: SessionLocation | undefined) =>
			JSON.stringify([location?.directory ?? null, location?.workspaceID ?? null]);
		// Temporary isolated-host diagnostics; removed after this gate.
		const debug = process.env.STRETCH_DEBUG
			? (event: string, value: unknown) => {
					import('node:fs')
						.then((fs) =>
							fs.appendFileSync(
								process.env.STRETCH_DEBUG!,
								`${JSON.stringify({
									event,
									value: value instanceof Error ? String(value) : value,
									at: Date.now(),
								})}\n`,
							),
						)
						.catch(() => {});
				}
			: undefined;
		debug?.('setup', { hasRpc: !!rpc });
		const opened = new Set<string>();
		const pending = new Map<string, Set<string>>();
		const validated = new Map<
			string,
			{ identity: string; keys: Set<string>; location: SessionLocation }
		>();
		const active = new Set<() => void>();
		let stopped = false;
		const key = (view: StretchView, fragment = '') => JSON.stringify([view.blockID, fragment]);
		const send = async (view: StretchView, fragment: string) => {
			const verified = validated.get(view.blockID);
			debug?.('send', {
				blockID: view.blockID,
				fragment,
				verified: verified && { identity: verified.identity, keys: [...verified.keys] },
				stopped,
			});
			if (
				!verified?.keys.has(fragment) ||
				stopped ||
				scopeKey(sessionLocation(view.sessionID)) !== scopeKey(verified.location)
			)
				return;
			try {
				const result = await rpc.recordOpened(
					{ identity: verified.identity, stretchKey: fragment },
					{ location: verified.location },
				);
				debug?.('recordOpened', result);
				if ((result as { recorded?: boolean }).recorded)
					pending.get(view.blockID)?.delete(fragment);
			} catch (error) {
				debug?.('recordOpened-error', error);
			}
		};
		const state: StretchState = {
			isOpen: (view, fragment) => opened.has(key(view, fragment)),
			setOpen(view, open, fragment = '') {
				if (open) {
					opened.add(key(view, fragment));
					const entries = pending.get(view.blockID) ?? new Set<string>();
					entries.add(fragment);
					pending.set(view.blockID, entries);
					void send(view, fragment);
				} else opened.delete(key(view, fragment));
			},
		};
		const unregister = api.markdown.registerCodeBlockRenderer('stretch', (token) => {
			const block = parseStretchPayload(token.text);
			if (!block) return;
			// Route is only a search hint, never proof of identity. Match the complete
			// fence against actual assistant text and reject duplicate occurrences.
			const route = api.ui.router.current();
			if (route.type !== 'session') return;
			const matches: string[] = [];
			for (const message of api.data.session.message.list(route.sessionID)) {
				if (message.type !== 'assistant') continue;
				for (const part of message.content) {
					if (part.type !== 'text') continue;
					for (const candidate of extractStretchBlocks(part.text)) {
						if (
							candidate.turnToken === block.turnToken &&
							candidate.blockLabel === block.blockLabel &&
							candidate.body === block.body
						)
							matches.push(message.id);
					}
				}
			}
			if (matches.length !== 1) {
				debug?.('match-failed', { matches, route: route.sessionID });
				return;
			}
			const blockKey = (location: SessionLocation | undefined) =>
				JSON.stringify([
					scopeKey(location),
					route.sessionID,
					matches[0],
					block.turnToken,
					block.blockLabel,
				]);
			let boundLocation = sessionLocation(route.sessionID);
			let localID = blockKey(boundLocation);
			const view = parseAgreedBlock(token.text, route.sessionID, matches[0]!, localID)!;
			const renderable = createStretchRenderer(api.renderer, view, state, runtime);
			let disposed = false;
			let resolving = false;
			async function resolve() {
				if (disposed || stopped || resolving) return;
				const location = sessionLocation(view.sessionID);
				if (!location) return;
				if (!boundLocation) {
					const previous = localID;
					localID = blockKey(location);
					for (const fragment of pending.get(previous) ?? []) {
						if (opened.delete(key(view, fragment))) opened.add(JSON.stringify([localID, fragment]));
					}
					const queued = pending.get(previous);
					if (queued) pending.set(localID, queued);
					pending.delete(previous);
					view.blockID = localID;
					boundLocation = location;
				}
				if (scopeKey(location) !== scopeKey(boundLocation)) return;
				resolving = true;
				try {
					const result = (await rpc.resolveBlock(
						{
							sessionID: view.sessionID,
							turnToken: block!.turnToken,
							blockLabel: block!.blockLabel,
						},
						{ location },
					)) as { valid?: boolean; identity?: string; stretchKeys?: string[]; view?: StretchView };
					debug?.('resolveBlock', { localID, messageID: view.messageID, result });
					if (scopeKey(sessionLocation(view.sessionID)) !== scopeKey(location)) return;
					const resolved = result.view;
					if (
						disposed ||
						stopped ||
						!result.valid ||
						!resolved ||
						!resolved.complete ||
						resolved.sessionID !== view.sessionID ||
						resolved.messageID !== view.messageID ||
						resolved.detail !== view.detail ||
						typeof resolved.blockID !== 'string' ||
						!resolved.blockID
					)
						return;
					if (
						typeof result.identity !== 'string' ||
						!result.identity ||
						result.identity !== resolved.blockID ||
						!Array.isArray(result.stretchKeys) ||
						!result.stretchKeys.every((key) => typeof key === 'string')
					)
						return;
					debug?.('validated', {
						localID,
						identity: result.identity,
						keys: result.stretchKeys,
						pending: [...(pending.get(localID) ?? [])],
					});
					validated.set(localID, {
						identity: result.identity,
						keys: new Set(result.stretchKeys),
						location,
					});
					for (const fragment of pending.get(localID) ?? []) void send(view, fragment);
				} catch (error) {
					debug?.('resolveBlock-error', error);
				} finally {
					resolving = false;
				}
			}
			active.add(resolve);
			renderable.on('destroyed', () => {
				disposed = true;
				active.delete(resolve);
			});
			void resolve();
			return renderable;
		});
		const unlisten = api.data.listen(() => {
			for (const resolve of active) resolve();
		});
		return () => {
			stopped = true;
			unregister();
			unlisten();
			active.clear();
			opened.clear();
			pending.clear();
			validated.clear();
		};
	},
});
