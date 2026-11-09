import * as oidc from 'openid-client';
import type { Config } from '../config';
import type { Sql } from '../db';
import type { AirtableRepository } from '../airtable/client';
import { AppError } from '../errors';
import { hash, randomToken, safeReturnTo } from './security';
import { findIdentity, type Identity } from './identity';
import { createSession } from './session';
import { verifyInstance } from '../runtime';
import { registrationSchema, type Registration } from '../../domain/registration';
import { registerAgent } from './registration';

const configurations = new Map<string, Promise<oidc.Configuration>>();
export class GoogleLoginError extends AppError {
  constructor(
    public returnTo: string,
    public registration = false,
  ) {
    super(401, 'OAUTH_INVALID', 'ไม่สามารถเข้าสู่ระบบได้ กรุณาเริ่มใหม่');
  }
}
async function googleConfig(config: Config) {
  const key = hash(config.GOOGLE_CLIENT_ID + ':' + config.GOOGLE_CLIENT_SECRET);
  let value = configurations.get(key);
  if (!value) {
    value = oidc.discovery(
      new URL('https://accounts.google.com'),
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      undefined,
      { execute: [oidc.enableNonRepudiationChecks] },
    );
    configurations.set(key, value);
    value.catch(() => configurations.delete(key));
  }
  return value;
}
export async function startGoogle(
  db: Sql,
  config: Config,
  returnTo?: string | null,
  getClient = googleConfig,
  registration?: Registration,
) {
  await verifyInstance(db, config);
  const client = await getClient(config);
  const state = randomToken(),
    binding = randomToken(),
    nonce = oidc.randomNonce(),
    verifier = oidc.randomPKCECodeVerifier();
  await db.query(
    `INSERT INTO hvr_oauth(environment,state_hash,binding_hash,verifier,nonce,return_to,expires_at,registration) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '10 minutes',$7)`,
    [
      config.APP_ENV,
      hash(state),
      hash(binding),
      verifier,
      nonce,
      safeReturnTo(returnTo),
      registration ? JSON.stringify(registrationSchema.parse(registration)) : null,
    ],
  );
  const url = oidc.buildAuthorizationUrl(client, {
    redirect_uri: config.APP_ORIGIN + '/api/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url, binding };
}
export async function finishGoogle(
  db: Sql,
  repo: AirtableRepository,
  config: Config,
  callback: URL,
  binding: string,
  getClient = googleConfig,
) {
  await verifyInstance(db, config);
  const state = callback.searchParams.get('state') || '';
  const invalid = () =>
    new AppError(401, 'OAUTH_INVALID', 'คำขอเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาเริ่มใหม่');
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(binding)) throw invalid();
  const result = await db.query(
    `DELETE FROM hvr_oauth WHERE environment=$1 AND state_hash=$2 AND binding_hash=$3 AND expires_at>clock_timestamp() RETURNING verifier,nonce,return_to,registration`,
    [config.APP_ENV, hash(state), hash(binding)],
  );
  const stored = result.rows[0];
  if (!stored) throw invalid();
  try {
    if (callback.searchParams.has('error')) throw invalid();
    const client = await getClient(config);
    const canonical = new URL(config.APP_ORIGIN + '/api/auth/google/callback');
    canonical.search = callback.search;
    const tokens = await oidc.authorizationCodeGrant(client, canonical, {
      pkceCodeVerifier: stored.verifier,
      expectedState: state,
      expectedNonce: stored.nonce,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw invalid();
    const info = await oidc.fetchUserInfo(client, tokens.access_token, claims.sub);
    if (typeof info.email !== 'string' || info.email_verified !== true) throw invalid();
    if (stored.registration) {
      const status = await registerAgent(
        repo,
        db,
        config,
        info as unknown as Identity,
        registrationSchema.parse(stored.registration),
      );
      return {
        kind: 'registration' as const,
        status,
        token: '',
        returnTo: '/register?status=' + status,
      };
    }
    const user = await findIdentity(repo, db, config, info as unknown as Identity);
    return {
      kind: 'login' as const,
      ...(await createSession(db, config, user)),
      returnTo: safeReturnTo(stored.return_to),
    };
  } catch {
    throw new GoogleLoginError(safeReturnTo(stored.return_to), !!stored.registration);
  }
}
