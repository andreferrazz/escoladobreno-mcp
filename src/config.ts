import { scryptSync } from 'node:crypto';
import { DEFAULT_ANON_KEY, DEFAULT_SUPABASE_URL, type BrenoOptions } from './breno.ts';
import { hashPassword } from './password.ts';

export type Config = {
	publicUrl: URL;
	signingSecret: string;
	adminPasswordHash: string;
	port: number;
	breno: BrenoOptions;
};

type Env = Record<string, string | undefined>;

const MIN_PASSWORD = 12;

/**
 * Two ways to configure the sign-in. A server someone administers sets PUBLIC_URL,
 * SIGNING_SECRET and ADMIN_PASSWORD_HASH. A one-click deployment sets only
 * CONNECTOR_PASSWORD, and the other two are worked out from what is already there.
 */
export function loadConfig(env: Env = process.env): Config {
	const required = (name: string): string => {
		const value = env[name]?.trim();
		if (!value) throw new Error(`Missing required environment variable ${name}`);
		return value;
	};

	const breno: BrenoOptions = {
		// Overridable in case the app moves its backend; the defaults are what it ships today.
		supabaseUrl: env.BRENO_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL,
		anonKey: env.BRENO_SUPABASE_ANON_KEY?.trim() || DEFAULT_ANON_KEY,
		email: required('BRENO_EMAIL'),
		password: required('BRENO_PASSWORD')
	};

	const connectorPassword = env.CONNECTOR_PASSWORD;
	let adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim();
	if (!adminPasswordHash) {
		if (!connectorPassword) throw new Error('Missing required environment variable CONNECTOR_PASSWORD');
		if (connectorPassword.length < MIN_PASSWORD) {
			throw new Error(`CONNECTOR_PASSWORD must be at least ${MIN_PASSWORD} characters`);
		}
		adminPasswordHash = hashPassword(connectorPassword);
	}

	let signingSecret = env.SIGNING_SECRET?.trim();
	if (!signingSecret) {
		if (!connectorPassword) throw new Error('Missing required environment variable SIGNING_SECRET');
		// Derived, not random: every instance a serverless host starts must arrive at the same
		// secret. It needs both passwords, and scrypt keeps guessing them from a signed value slow.
		// Changing either password signs every client out.
		signingSecret = scryptSync(
			`${connectorPassword}\0${breno.password}`,
			`escoladobreno-mcp signing secret for ${breno.email}`,
			32
		).toString('hex');
	}
	if (signingSecret.length < 32) throw new Error('SIGNING_SECRET must be at least 32 characters');

	// Vercel assigns the address and reports it without a scheme.
	const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
	const publicUrl = env.PUBLIC_URL?.trim() || (vercelHost ? `https://${vercelHost}` : required('PUBLIC_URL'));

	return {
		publicUrl: new URL(publicUrl),
		signingSecret,
		adminPasswordHash,
		port: Number(env.PORT ?? 3000),
		breno
	};
}
