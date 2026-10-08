import { createHmac, timingSafeEqual } from 'node:crypto';

type Sealed = { t: string; exp?: number };

function mac(secret: string, data: string): Buffer {
	return createHmac('sha256', secret).update(data).digest();
}

/**
 * Signed, self-describing values. Everything the OAuth flow hands out (client ids, codes,
 * tokens) is one of these, so the service keeps no database and survives redeploys.
 */
export function createSealer(secret: string) {
	return {
		seal(type: string, payload: object, ttlSeconds?: number): string {
			const claims: Sealed = { ...payload, t: type };
			if (ttlSeconds) claims.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
			const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
			return `${body}.${mac(secret, body).toString('base64url')}`;
		},

		open<T extends object>(type: string, value: string): (T & Sealed) | null {
			const dot = value.indexOf('.');
			if (dot < 1) return null;
			const body = value.slice(0, dot);
			const given = Buffer.from(value.slice(dot + 1), 'base64url');
			const expected = mac(secret, body);
			if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
			const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & Sealed;
			if (claims.t !== type) return null;
			if (claims.exp && claims.exp < Date.now() / 1000) return null;
			return claims;
		},

		/** Keyed digest, for values derived from a sealed one (client secrets, client fingerprints). */
		derive(purpose: string, value: string): string {
			return mac(secret, `${purpose}:${value}`).toString('base64url');
		}
	};
}

export type Sealer = ReturnType<typeof createSealer>;
