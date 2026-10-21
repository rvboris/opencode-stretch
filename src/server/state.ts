import type { Plugin } from '@opencode/plugin';
import { identifier, type Scope } from '../core/identity.js';

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}
export type TurnRecord = { userMessageID: string; token: string; feedback: string[] };
export class StateStore {
	private locks = new Map<string, Promise<void>>();
	constructor(
		private storage: Pick<Plugin.Context['storage'], 'get' | 'set'>,
		private scope: Scope,
	) {}
	private turnKey(session: string, user: string) {
		return `v1/turn/${encodeURIComponent(JSON.stringify([this.scope.directory, this.scope.workspaceID ?? null, session, user]))}`;
	}
	async getTurn(session: string, user: string): Promise<TurnRecord | undefined> {
		const v: unknown = await this.storage.get(this.turnKey(session, user));
		if (
			!v ||
			!isObject(v) ||
			v.userMessageID !== user ||
			!identifier(v.userMessageID) ||
			typeof v.token !== 'string' ||
			!/^[A-Za-z0-9_-]{8,128}$/.test(v.token) ||
			!Array.isArray(v.feedback) ||
			v.feedback.length > 8 ||
			!v.feedback.every((x) => typeof x === 'string' && x.length <= 160)
		)
			return;
		return {
			userMessageID: v.userMessageID,
			token: v.token,
			feedback: v.feedback.filter((x): x is string => typeof x === 'string'),
		};
	}
	async createTurn(
		session: string,
		user: string,
		token: string,
		feedback: string[],
	): Promise<TurnRecord> {
		const record = {
			userMessageID: user,
			token,
			feedback: feedback.slice(0, 8).map((x) => x.slice(0, 160)),
		};
		await this.storage.set(this.turnKey(session, user), record);
		return record;
	}
	private openKey(id: string, key: string) {
		return `v1/opened/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;
	}
	async isOpened(id: string, key: string): Promise<boolean> {
		return (await this.storage.get(this.openKey(id, key))) === true;
	}
	async opened(id: string, key: string): Promise<boolean> {
		await this.storage.set(this.openKey(id, key), true);
		return true;
	}
	async withSessionLock<T>(session: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(session) ?? Promise.resolve();
		let release!: () => void;
		const next = new Promise<void>((resolve) => {
			release = resolve;
		});
		const queued = previous.then(() => next);
		this.locks.set(session, queued);
		await previous;
		try {
			return await fn();
		} finally {
			release();
			if (this.locks.get(session) === queued) this.locks.delete(session);
		}
	}
}
