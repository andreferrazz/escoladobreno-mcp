import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
	AuthorizationParams,
	OAuthServerProvider
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { renderLoginPage } from './login-page.ts';
import type { Sealer } from './seal.ts';

export const SCOPE = 'finance';

const LOGIN_TTL = 10 * 60;
const CODE_TTL = 60;
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 60 * 24 * 60 * 60;

type ClientClaims = { r: string[]; m: string; n?: string; j: string };
type GrantClaims = { c: string };
type CodeClaims = GrantClaims & { cc: string; ru: string; j: string };
export type LoginClaims = { c: string; cc: string; ru: string; s?: string; n?: string };

export function createProvider(sealer: Sealer) {
	// Authorization codes are single use; ids are only remembered until the code would expire anyway.
	const usedCodes = new Map<string, number>();

	const fingerprint = (clientId: string) => sealer.derive('client', clientId);

	function issueTokens(clientFingerprint: string): OAuthTokens {
		const grant: GrantClaims = { c: clientFingerprint };
		return {
			access_token: sealer.seal('access', grant, ACCESS_TTL),
			token_type: 'bearer',
			expires_in: ACCESS_TTL,
			refresh_token: sealer.seal('refresh', grant, REFRESH_TTL),
			scope: SCOPE
		};
	}

	function openCode(client: OAuthClientInformationFull, code: string): CodeClaims {
		const claims = sealer.open<CodeClaims>('code', code);
		if (!claims || claims.c !== fingerprint(client.client_id)) {
			throw new InvalidGrantError('Invalid or expired authorization code');
		}
		return claims;
	}

	// The client id is the sealed registration itself, so there is no client table to keep.
	const clientsStore: OAuthRegisteredClientsStore = {
		getClient(clientId) {
			const claims = sealer.open<ClientClaims>('client', clientId);
			if (!claims) return undefined;
			return {
				client_id: clientId,
				client_name: claims.n,
				redirect_uris: claims.r,
				token_endpoint_auth_method: claims.m,
				client_secret: claims.m === 'none' ? undefined : sealer.derive('secret', clientId),
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code']
			};
		},

		registerClient(client) {
			const method = client.token_endpoint_auth_method ?? 'client_secret_post';
			const claims: ClientClaims = {
				r: client.redirect_uris,
				m: method,
				n: client.client_name?.slice(0, 80),
				// Without this, two clients registering the same metadata would share an id.
				j: randomUUID()
			};
			const clientId = sealer.seal('client', claims);
			return {
				...client,
				client_id: clientId,
				client_id_issued_at: Math.floor(Date.now() / 1000),
				token_endpoint_auth_method: method,
				client_secret: method === 'none' ? undefined : sealer.derive('secret', clientId),
				client_secret_expires_at: method === 'none' ? undefined : 0
			};
		}
	};

	const provider: OAuthServerProvider = {
		get clientsStore() {
			return clientsStore;
		},

		// The SDK has validated the client and redirect URI; consent is the password page.
		async authorize(client, params: AuthorizationParams, res: Response) {
			const login: LoginClaims = {
				c: fingerprint(client.client_id),
				cc: params.codeChallenge,
				ru: params.redirectUri,
				s: params.state,
				n: client.client_name
			};
			renderLoginPage(res, { login: sealer.seal('login', login, LOGIN_TTL), claims: login });
		},

		async challengeForAuthorizationCode(client, code) {
			return openCode(client, code).cc;
		},

		async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
			const claims = openCode(client, code);
			if (redirectUri && redirectUri !== claims.ru) {
				throw new InvalidGrantError('redirect_uri does not match the authorization request');
			}
			const now = Date.now();
			for (const [id, expiry] of usedCodes) if (expiry < now) usedCodes.delete(id);
			if (usedCodes.has(claims.j)) throw new InvalidGrantError('Authorization code already used');
			usedCodes.set(claims.j, now + CODE_TTL * 1000);
			return issueTokens(claims.c);
		},

		async exchangeRefreshToken(client, refreshToken) {
			const claims = sealer.open<GrantClaims>('refresh', refreshToken);
			if (!claims || claims.c !== fingerprint(client.client_id)) {
				throw new InvalidGrantError('Invalid or expired refresh token');
			}
			return issueTokens(claims.c);
		},

		async verifyAccessToken(token): Promise<AuthInfo> {
			const claims = sealer.open<GrantClaims>('access', token);
			if (!claims?.exp) throw new InvalidTokenError('Invalid or expired access token');
			return { token, clientId: claims.c, scopes: [SCOPE], expiresAt: claims.exp };
		}
	};

	/** Called once the password has been accepted for a login started by `authorize`. */
	function completeLogin(login: LoginClaims): string {
		const code: CodeClaims = { c: login.c, cc: login.cc, ru: login.ru, j: randomUUID() };
		const target = new URL(login.ru);
		target.searchParams.set('code', sealer.seal('code', code, CODE_TTL));
		if (login.s !== undefined) target.searchParams.set('state', login.s);
		return target.href;
	}

	return { provider, completeLogin };
}
