import type { SessionMessageInfo } from '@opencode/client/promise';
import { extractStretchBlocks, type StretchBlock } from '../core/format.js';
import { identity, type Scope } from '../core/identity.js';
import { stretches } from '../core/parse.js';
import type { StateStore } from './state.js';
export type Candidate = StretchBlock & {
	identity: string;
	sessionID: string;
	messageID: string;
	userMessageID: string;
	textIndex: number;
};
export function latestUser(messages: SessionMessageInfo[]) {
	return [...messages].reverse().find((m) => m.type === 'user');
}
export async function candidates(
	messages: SessionMessageInfo[],
	state: StateStore,
	scope: Scope,
	sessionID: string,
): Promise<Candidate[]> {
	const result: Candidate[] = [];
	let user: string | undefined;
	const turns = new Map<string, string>();
	for (const m of messages) {
		if (m.type === 'user') {
			const record = await state.getTurn(sessionID, m.id);
			if (record) turns.set(m.id, record.token);
		}
	}
	for (const m of messages) {
		if (m.type === 'user') {
			user = m.id;
			continue;
		}
		if (
			m.type !== 'assistant' ||
			!user ||
			!Number.isFinite(m.time.completed) ||
			m.error ||
			m.finish === 'error'
		)
			continue;
		const token = turns.get(user);
		if (!token || [...turns.values()].filter((t) => t === token).length !== 1) continue;
		m.content.forEach((part, index) => {
			if (part.type !== 'text') return;
			for (const block of extractStretchBlocks(part.text)) {
				if (block.turnToken !== token) continue;
				result.push({
					...block,
					identity: identity(scope, sessionID, user!, m.id, index, token, block.blockLabel),
					sessionID,
					messageID: m.id,
					userMessageID: user!,
					textIndex: index,
				});
			}
		});
	}
	return result;
}
export function uniqueBlock(all: Candidate[], token: string, label: string): Candidate | undefined {
	const found = all.filter((c) => c.turnToken === token && c.blockLabel === label);
	return found.length === 1 ? found[0] : undefined;
}
export async function snapshot(
	messages: SessionMessageInfo[],
	state: StateStore,
	scope: Scope,
	session: string,
): Promise<string[]> {
	const latest = latestUser(messages);
	if (!latest) return [];
	const prior = messages.slice(0, messages.indexOf(latest));
	const previous = latestUser(prior);
	if (!previous) return [];
	const all = await candidates(prior, state, scope, session),
		feedback: string[] = [];
	for (const block of all) {
		if (
			block.userMessageID !== previous.id ||
			uniqueBlock(all, block.turnToken, block.blockLabel) !== block
		)
			continue;
		for (const s of stretches(block.segments))
			if (await state.isOpened(block.identity, s.key)) feedback.push(s.short.slice(0, 160));
	}
	return feedback.slice(0, 8);
}
