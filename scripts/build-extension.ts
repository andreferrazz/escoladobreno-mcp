// Builds the desktop extension: `pnpm pack:extension` writes escoladobreno.mcpb.
// Claude Desktop runs the server with its own Node, so the sources are bundled into one
// plain JavaScript file with every dependency inlined.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}dist/extension`;

export async function bundle(outfile: string) {
	await build({
		entryPoints: [`${root}src/stdio.ts`],
		outfile,
		bundle: true,
		platform: 'node',
		// CommonJS, and named .cjs so it loads the same whatever package.json sits above it.
		format: 'cjs',
		target: 'node18',
		legalComments: 'none',
		logLevel: 'warning'
	});
}

if (import.meta.main) {
	const manifest = JSON.parse(readFileSync(`${root}extension/manifest.json`, 'utf8'));
	const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
	if (manifest.version !== pkg.version) {
		throw new Error(`extension/manifest.json is ${manifest.version} but package.json is ${pkg.version}`);
	}
	rmSync(out, { recursive: true, force: true });
	mkdirSync(`${out}/server`, { recursive: true });
	cpSync(`${root}extension/manifest.json`, `${out}/manifest.json`);
	await bundle(`${out}/server/index.cjs`);
	const mcpb = `${root}node_modules/.bin/mcpb`;
	execFileSync(mcpb, ['validate', `${out}/manifest.json`], { stdio: 'inherit' });
	execFileSync(mcpb, ['pack', out, `${root}escoladobreno.mcpb`], { stdio: 'inherit' });
}
