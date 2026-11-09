import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as oidc from 'openid-client';
import { startGoogle, finishGoogle } from '../../src/server/auth/google';
import { authenticate } from '../../src/server/auth/session';
import { database, repository, config } from '../fixtures';

test('Google flow verifies signed JWT, PKCE, nonce, audience and expiry; state is browser-bound and one-use', async () => {
  const { db, engine } = await database(),
    h = repository();
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const client = new oidc.Configuration(
    {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/authorize',
      token_endpoint: 'https://accounts.google.com/token',
      jwks_uri: 'https://accounts.google.com/jwks',
      userinfo_endpoint: 'https://accounts.google.com/userinfo',
      id_token_signing_alg_values_supported: ['RS256'],
    },
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
  );
  oidc.enableNonRepudiationChecks(client);
  let signup = false;
  let nonce = '',
    mode = '',
    tokenCalls = 0;
  client[oidc.customFetch] = async (input, options) => {
    const url = String(input);
    if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/userinfo'))
      return Response.json(
        signup
          ? { sub: 'new-agent', email: 'new-agent@gmail.com', email_verified: true }
          : { sub: 'agent-a', email: 'agent-a@gmail.com', email_verified: true },
      );
    assert.ok(url.endsWith('/token'));
    tokenCalls++;
    const body = new URLSearchParams(String(options?.body));
    assert.ok((body.get('code_verifier') || '').length >= 43);
    assert.equal(body.get('redirect_uri'), config.APP_ORIGIN + '/api/auth/google/callback');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: signup ? 'new-agent' : 'agent-a',
        aud: mode === 'audience' ? 'wrong-client' : config.GOOGLE_CLIENT_ID,
        iat: now,
        exp: mode === 'expired' ? now - 3600 : now + 3600,
        nonce: mode === 'nonce' ? 'wrong-nonce' : nonce,
      }),
    ).toString('base64url');
    const signed = sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey).toString(
      'base64url',
    );
    const signature = mode === 'signature' ? Buffer.alloc(256).toString('base64url') : signed;
    return Response.json({
      access_token: 'test-google-access',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: header + '.' + payload + '.' + signature,
    });
  };
  const getClient = async () => client;
  try {
    const started = await startGoogle(db, config, '/tasks/new', getClient);
    nonce = started.url.searchParams.get('nonce') || '';
    assert.equal(started.url.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(config.APP_ORIGIN + '/api/auth/google/callback');
    callback.searchParams.set('state', started.url.searchParams.get('state') || '');
    callback.searchParams.set('code', 'test-code');
    await assert.rejects(finishGoogle(db, h.repo, config, callback, 'a'.repeat(64), getClient));
    assert.equal(tokenCalls, 0);
    const result = await finishGoogle(db, h.repo, config, callback, started.binding, getClient);
    assert.equal(result.returnTo, '/tasks/new');
    assert.equal((await authenticate(db, h.repo, config, result.token)).user.id, h.agent.id);
    await assert.rejects(finishGoogle(db, h.repo, config, callback, started.binding, getClient));
    assert.equal(tokenCalls, 1);
    for (mode of ['nonce', 'audience', 'expired', 'signature']) {
      const next = await startGoogle(db, config, '/tasks/new', getClient);
      nonce = next.url.searchParams.get('nonce') || '';
      callback.searchParams.set('state', next.url.searchParams.get('state') || '');
      await assert.rejects(
        finishGoogle(db, h.repo, config, callback, next.binding, getClient),
        mode,
      );
    }
    assert.equal((await db.query('SELECT * FROM hvr_sessions')).rows.length, 1);
    mode = '';
    signup = true;
    const registration = await startGoogle(db, config, '/', getClient, {
      fullName: 'New Agent',
      agentCode: '1234',
      phone: '0812345678',
    });
    nonce = registration.url.searchParams.get('nonce') || '';
    callback.searchParams.set('state', registration.url.searchParams.get('state') || '');
    const registered = await finishGoogle(
      db,
      h.repo,
      config,
      callback,
      registration.binding,
      getClient,
    );
    assert.equal(registered.kind, 'registration');
    assert.equal(registered.returnTo, '/register?status=pending');
    assert.equal(registered.token, '');
    assert.equal(h.tables.users.at(-1)?.fields.Active, false);
    assert.equal((await db.query('SELECT * FROM hvr_sessions')).rows.length, 1);
    await assert.rejects(
      finishGoogle(db, h.repo, config, callback, registration.binding, getClient),
    );
  } finally {
    await engine.close();
  }
});
