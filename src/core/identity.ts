export type Scope = { directory: string; workspaceID?: string };
export type Identity = [1, string, string | null, string, string, string, number, string, string];
export const identifier = (v: unknown): v is string =>
	typeof v === 'string' &&
	v.length > 0 &&
	v.length <= 256 &&
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in untrusted identifiers
	!/[\x00-\x1f]/.test(v);
export function decodeIdentity(value: unknown): Identity | undefined {
	if (typeof value !== 'string' || value.length > 8192) return;
	try {
		const v: unknown = JSON.parse(value);
		if (
			!Array.isArray(v) ||
			v.length !== 9 ||
			v[0] !== 1 ||
			typeof v[1] !== 'string' ||
			!v[1].startsWith('/') ||
			v[1].length > 4096 ||
			(v[2] !== null && !identifier(v[2])) ||
			!identifier(v[3]) ||
			!identifier(v[4]) ||
			!identifier(v[5]) ||
			!Number.isSafeInteger(v[6]) ||
			v[6] < 0 ||
			v[6] > 100000 ||
			typeof v[7] !== 'string' ||
			!/^[A-Za-z0-9_-]{8,128}$/.test(v[7]) ||
			typeof v[8] !== 'string' ||
			!/^[A-Za-z0-9_-]{1,64}$/.test(v[8])
		)
			return;
		const result: Identity = [1, v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]];
		return JSON.stringify(result) === value ? result : undefined;
	} catch {
		return;
	}
}
export function identity(
	scope: Scope,
	session: string,
	user: string,
	assistant: string,
	index: number,
	token: string,
	label: string,
): string {
	return JSON.stringify([
		1,
		scope.directory,
		scope.workspaceID ?? null,
		session,
		user,
		assistant,
		index,
		token,
		label,
	]);
}
