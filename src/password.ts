import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, KEY_LENGTH).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, salt, hash] = stored.split(':');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'hex');
	const given = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
	return timingSafeEqual(given, expected);
}

/** Locks the login out after repeated failures, whoever they come from. */
export function createLoginLimiter(maxFailures = 5, windowMs = 15 * 60_000) {
	let failures: number[] = [];
	const recent = () => (failures = failures.filter((at) => at > Date.now() - windowMs));
	return {
		locked: () => recent().length >= maxFailures,
		fail: () => void failures.push(Date.now()),
		reset: () => void (failures = [])
	};
}
