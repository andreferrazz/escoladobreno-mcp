import type { Response } from 'express';
import type { LoginClaims } from './provider.ts';

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

type LoginPage = { login: string; claims: LoginClaims; error?: string };

export function renderLoginPage(res: Response, { login, claims, error }: LoginPage, status = 200) {
	const client = escapeHtml(claims.n ?? 'An application');
	const destination = escapeHtml(new URL(claims.ru).host);
	res
		.status(status)
		.set({
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
			'Referrer-Policy': 'no-referrer',
			'X-Frame-Options': 'DENY'
		})
		.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize finance access</title>
<style>
	:root { color-scheme: light dark; }
	body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
	main { width: 100%; max-width: 380px; }
	h1 { font-size: 1.25rem; margin: 0 0 8px; }
	p { margin: 0 0 16px; }
	label { display: block; font-weight: 600; margin-bottom: 4px; }
	input, button { font: inherit; width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; }
	input { border: 1px solid #8888; margin-bottom: 12px; }
	button { border: 0; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; }
	.error { color: #dc2626; }
	.muted { opacity: 0.7; font-size: 0.875rem; }
</style>
</head>
<body>
<main>
	<h1>Authorize finance access</h1>
	<p><strong>${client}</strong> wants to read and change your Escola do Breno finance entries. You will be sent back to <strong>${destination}</strong>.</p>
	${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
	<form method="post" action="/login">
		<input type="hidden" name="login" value="${escapeHtml(login)}">
		<label for="password">Admin password</label>
		<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
		<button type="submit">Authorize</button>
	</form>
	<p class="muted" style="margin-top:16px">Close this page if you did not start this.</p>
</main>
</body>
</html>`);
}
