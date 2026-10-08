import { DEFAULT_ANON_KEY, DEFAULT_SUPABASE_URL, type BrenoOptions } from './breno.ts';

export type Config = {
	publicUrl: URL;
	signingSecret: string;
	adminPasswordHash: string;
	port: number;
	breno: BrenoOptions;
};

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable ${name}`);
	return value;
}

export function loadConfig(): Config {
	const signingSecret = required('SIGNING_SECRET');
	if (signingSecret.length < 32) throw new Error('SIGNING_SECRET must be at least 32 characters');

	return {
		publicUrl: new URL(required('PUBLIC_URL')),
		signingSecret,
		adminPasswordHash: required('ADMIN_PASSWORD_HASH'),
		port: Number(process.env.PORT ?? 3000),
		breno: {
			// Overridable in case the app moves its backend; the defaults are what it ships today.
			supabaseUrl: process.env.BRENO_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL,
			anonKey: process.env.BRENO_SUPABASE_ANON_KEY?.trim() || DEFAULT_ANON_KEY,
			email: required('BRENO_EMAIL'),
			password: required('BRENO_PASSWORD')
		}
	};
}
