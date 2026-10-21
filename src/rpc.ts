import { Rpc } from '@opencode/plugin/rpc';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { decodeIdentity, identifier } from './core/identity.js';
export type ResolveInput = { sessionID: string; turnToken: string; blockLabel: string };
export type OpenInput = { identity: string; stretchKey: string };
export type ResolveOutput =
	| { valid: false }
	| {
			valid: true;
			identity: string;
			stretchKeys: string[];
			view: {
				sessionID: string;
				messageID: string;
				blockID: string;
				summary: string;
				detail: string;
				complete: true;
			};
	  };
function object(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}
function exact(v: Record<string, unknown>, keys: string[]) {
	return Object.keys(v).length === keys.length && keys.every((k) => k in v);
}
function schema<T>(guard: (v: unknown) => v is T): StandardSchemaV1<T, T> {
	return {
		'~standard': {
			version: 1,
			vendor: 'opencode-stretch',
			validate: (v) =>
				guard(v) ? { value: v } : { issues: [{ message: 'Invalid stretch RPC payload' }] },
		},
	};
}
const resolve = (v: unknown): v is ResolveInput =>
	object(v) &&
	exact(v, ['sessionID', 'turnToken', 'blockLabel']) &&
	identifier(v.sessionID) &&
	typeof v.turnToken === 'string' &&
	/^[A-Za-z0-9_-]{8,128}$/.test(v.turnToken) &&
	typeof v.blockLabel === 'string' &&
	/^[A-Za-z0-9_-]{1,64}$/.test(v.blockLabel);
const opened = (v: unknown): v is OpenInput =>
	object(v) &&
	exact(v, ['identity', 'stretchKey']) &&
	!!decodeIdentity(v.identity) &&
	typeof v.stretchKey === 'string' &&
	v.stretchKey.length <= 128 &&
	/^\d+(?:\/\d+)*$/.test(v.stretchKey);
function output(v: unknown): v is ResolveOutput {
	if (!object(v)) return false;
	if (v.valid === false) return exact(v, ['valid']);
	if (
		v.valid !== true ||
		!exact(v, ['valid', 'identity', 'stretchKeys', 'view']) ||
		!decodeIdentity(v.identity) ||
		!Array.isArray(v.stretchKeys) ||
		v.stretchKeys.length > 256 ||
		!v.stretchKeys.every((k) => typeof k === 'string' && /^\d+(?:\/\d+)*$/.test(k)) ||
		!object(v.view)
	)
		return false;
	const view = v.view;
	return (
		exact(view, ['sessionID', 'messageID', 'blockID', 'summary', 'detail', 'complete']) &&
		identifier(view.sessionID) &&
		identifier(view.messageID) &&
		view.blockID === v.identity &&
		typeof view.summary === 'string' &&
		view.summary.length <= 65536 &&
		typeof view.detail === 'string' &&
		view.detail.length <= 65536 &&
		view.complete === true
	);
}
export const StretchRpc = Rpc.define({
	id: 'opencode-stretch',
	events: {},
	methods: {
		resolveBlock: { input: schema(resolve), output: schema(output) },
		recordOpened: {
			input: schema(opened),
			output: schema(
				(v): v is { recorded: boolean } =>
					object(v) && exact(v, ['recorded']) && typeof v.recorded === 'boolean',
			),
		},
	},
});
