import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { openChatGPT } from '../bridge/blockers/chatgpt.js';

for (const scenario of ['valid', 'wrong nonce', 'missing nonce', 'wrong audience', 'wrong issuer', 'expired', 'wrong signature']) {
  test(`real OAuth identity verification: ${scenario}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'jsc-identity-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
    let nonce;
    const auth = await openChatGPT({ path: join(directory, 'chatgpt.json'), fetchImpl: async (url) => {
      if (String(url).endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      const signingKey = scenario === 'wrong signature' ? (await generateKeyPair('RS256')).privateKey : privateKey;
      const claims = scenario === 'missing nonce' ? {} : { nonce: scenario === 'wrong nonce' ? 'wrong' : nonce };
      const idToken = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(scenario === 'wrong issuer' ? 'https://invalid.example' : 'https://auth.openai.com')
        .setAudience(scenario === 'wrong audience' ? 'other-client' : 'oaiapp_test').setSubject('verified-user')
        .setIssuedAt().setExpirationTime(scenario === 'expired' ? 0 : '5m').sign(signingKey);
      return Response.json({ access_token: 'secret-access', id_token: idToken, token_type: 'Bearer', scope: 'openid chatgpt.tokens.use.direct' });
    } });
    t.after(() => auth.close());
    const authorization = new URL((await auth.signIn({ newProfile: true })).authUrl);
    nonce = authorization.searchParams.get('nonce');
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), client_id: 'oaiapp_test', code: 'secret-code' });
    const response = await fetch(callback);
    const page = await response.text();
    assert.equal(response.status, scenario === 'valid' ? 200 : 400);
    assert.equal(auth.session().connected, scenario === 'valid');
    assert.doesNotMatch(page, /secret-access|secret-code|eyJ/);
    const stored = JSON.parse(await readFile(join(directory, 'chatgpt.json')));
    if (scenario !== 'valid') {
      assert.equal(stored.activeId, null);
      assert.equal(stored.profiles[0].accessToken, undefined);
      assert.match(page, /identity verification/);
      const retry = new URL((await auth.signIn()).authUrl);
      assert.equal(retry.searchParams.get('client_id'), 'oaiapp_test');
      assert.notEqual(retry.searchParams.get('nonce'), nonce);
    }
  });
}
