// Entry point of the desktop extension: the same tools over stdio, for one person's own
// account, run by Claude Desktop on their computer. No OAuth; the login comes from the
// extension's settings.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBrenoClient, DEFAULT_ANON_KEY, DEFAULT_SUPABASE_URL } from './breno.ts';
import { createMcpServer } from './tools.ts';

async function main() {
	const email = process.env.BRENO_EMAIL?.trim();
	const password = process.env.BRENO_PASSWORD;
	if (!email || !password) {
		// stdout carries the protocol, so anything for a human goes to stderr.
		console.error('Set the Escola do Breno e-mail and password in the extension settings.');
		process.exit(1);
	}
	const breno = createBrenoClient({
		supabaseUrl: process.env.BRENO_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL,
		anonKey: process.env.BRENO_SUPABASE_ANON_KEY?.trim() || DEFAULT_ANON_KEY,
		email,
		password
	});
	await createMcpServer(breno).connect(new StdioServerTransport());
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
