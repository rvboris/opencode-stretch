import { randomUUID } from 'node:crypto';
import { Plugin } from '@opencode/plugin';
import { decodeIdentity } from './core/identity.js';
import { collapsedText, stretches } from './core/parse.js';
import { type ResolveOutput, StretchRpc } from './rpc.js';
import { guideForTurn } from './server/guide.js';
import { StateStore } from './server/state.js';
import { candidates, latestUser, snapshot, uniqueBlock } from './server/transcript.js';

export default Plugin.define({
	id: 'opencode-stretch',
	async setup(ctx) {
		const state = new StateStore(ctx.storage, ctx.location);
		const hook = await ctx.session.hook('context', async (event) => {
			try {
				await state.withSessionLock(event.sessionID, async () => {
					const messages = await ctx.session.context({ sessionID: event.sessionID });
					const user = latestUser(messages);
					if (!user) return;
					let turn = await state.getTurn(event.sessionID, user.id);
					if (!turn) {
						let feedback: string[] = [];
						try {
							feedback = await snapshot(messages, state, ctx.location, event.sessionID);
						} catch {
							/* Omit unvalidated telemetry. */
						}
						turn = await state.createTurn(event.sessionID, user.id, randomUUID(), feedback);
					}
					event.system.push({ type: 'text', text: guideForTurn(turn.token, turn.feedback) });
				});
			} catch {
				/* Optional enhancement must never block prompting. */
			}
		});
		try {
			const rpc = await ctx.rpc.register(StretchRpc, {
				resolveBlock: async (input): Promise<ResolveOutput> => {
					try {
						const messages = await ctx.session.context({ sessionID: input.sessionID });
						const block = uniqueBlock(
							await candidates(messages, state, ctx.location, input.sessionID),
							input.turnToken,
							input.blockLabel,
						);
						if (!block) return { valid: false };
						return {
							valid: true,
							identity: block.identity,
							stretchKeys: stretches(block.segments).map((s) => s.key),
							view: {
								sessionID: block.sessionID,
								messageID: block.messageID,
								blockID: block.identity,
								summary: collapsedText(block.segments),
								detail: block.body,
								complete: true,
							},
						};
					} catch {
						return { valid: false };
					}
				},
				recordOpened: async (input) => {
					try {
						const id = decodeIdentity(input.identity);
						if (
							!id ||
							id[1] !== ctx.location.directory ||
							id[2] !== (ctx.location.workspaceID ?? null)
						)
							return { recorded: false };
						const messages = await ctx.session.context({ sessionID: id[3] });
						const block = uniqueBlock(
							await candidates(messages, state, ctx.location, id[3]),
							id[7],
							id[8],
						);
						if (
							!block ||
							block.identity !== input.identity ||
							stretches(block.segments).filter(
								(s) => s.key === input.stretchKey && s.isClosed && s.long !== undefined,
							).length !== 1
						)
							return { recorded: false };
						return { recorded: await state.opened(block.identity, input.stretchKey) };
					} catch {
						return { recorded: false };
					}
				},
			});
			return async () => {
				await Promise.allSettled([hook.dispose(), rpc.dispose()]);
			};
		} catch (error) {
			await Promise.allSettled([hook.dispose()]);
			throw error;
		}
	},
});
