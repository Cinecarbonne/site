import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { handler, sanitize, verifyIdentity, PROGRAMME_URL } from '../../netlify/lib/accessibilite.mjs';

const now = Date.parse('2026-11-08T12:00:00Z');
const env = { INGEST_OAUTH_CLIENT_ID: 'fake.apps.googleusercontent.com', INGEST_PUBLISHER_EMAIL: 'publisher@example.com' };
const programme = [{ titre: 'Film', date: '2026-11-08', heure: '10:00', version: 'VF',
  synopsis: 'Synopsis deja public', duree_min: '95' }];
const id = JSON.stringify(['Film', '2026-11-08', '10:00', 'VF']);
const input = () => ({ version: 1, generated_at: new Date(now).toISOString(), timezone: 'Europe/Paris',
  seances: [{ programme_key: id, titre: 'PRIVATE INPUT', date: 'PRIVATE INPUT', heure: 'PRIVATE INPUT', version: 'VF',
    affiche: 'PRIVATE INPUT', synopsis: 'PRIVATE INPUT', duree: 'PRIVATE INPUT', genre: 'PRIVATE INPUT',
    realisateur: 'PRIVATE INPUT', statut: 'selon_application', dispositifs: ['ad'], applications: { ad: 'La Bavarde' } }] });
const req = value => new Request('https://cinecarbonne.fr/.netlify/functions/accessibilite', {
  method: 'POST', headers: { Authorization: 'Bearer fake.id.signature', 'Content-Type': 'application/json' },
  body: typeof value === 'string' ? value : JSON.stringify(value)
});

function fixture(overrides = {}) {
  const state = { entry: null, writes: 0, verifies: 0, fetched: 0, conflict: false };
  const store = { async getWithMetadata() { return state.entry; },
    async setJSON(_, data, options) {
      state.writes++;
      assert.ok(options.onlyIfNew || options.onlyIfMatch);
      if (state.conflict) return { modified: false };
      state.entry = { data, metadata: options.metadata, etag: 'etag' };
      return { modified: true };
    } };
  const app = handler({ store: () => store, env, now: () => now,
    verify: async () => { state.verifies++; },
    fetcher: async (url) => { state.fetched++; assert.equal(url, PROGRAMME_URL); return Response.json(programme); },
    ...overrides });
  return { app, state };
}

test('metadata reconstructed from public programme; only public data stored and GET returned', async () => {
  const { app, state } = fixture();
  const value = input();
  assert.equal((await app(req(value))).status, 200);
  assert.equal(state.writes, 1);
  const response = await app(new Request('https://cinecarbonne.fr/.netlify/functions/accessibilite'));
  const text = await response.text();
  assert.doesNotMatch(text, /PRIVATE|publisher@example|fake\.id/);
  assert.equal(JSON.parse(text).seances[0].synopsis, programme[0].synopsis);
  assert.equal(response.headers.get('X-Ingest-Input-Sha256'), createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('disabled receiver, missing/invalid authentication and wrong method never store', async () => {
  for (const [overrides, request, status] of [
    [{ env: {} }, req(input()), 503],
    [{}, new Request('https://example.com', { method: 'POST' }), 401],
    [{ verify: async () => { throw new Error('PRIVATE IDENTITY'); } }, req(input()), 403],
    [{}, new Request('https://example.com', { method: 'DELETE' }), 405]
  ]) {
    const { app, state } = fixture(overrides);
    const response = await app(request);
    assert.equal(response.status, status);
    assert.equal(state.writes, 0);
    assert.equal(state.fetched, 0);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
  }
});

test('invalid, stale, private-extra, unmatched, uncertain, unsupported app/equipment, duplicate inputs rejected', async () => {
  const transforms = [
    v => v.generated_at = 'invalid',
    v => v.generated_at = '2026-11-07T12:00:00Z',
    v => v.generated_at = '2026-11-08T14:00:00Z',
    v => v.private_note = 'PRIVATE',
    v => v.seances[0].ligne = 5,
    v => v.seances[0].programme_key = 'unmatched',
    v => v.seances[0].statut = 'a_confirmer',
    v => v.seances[0].applications.ad = 'GRETA',
    v => v.seances[0].dispositifs = ['hi'],
    v => v.seances[0].dispositifs = ['sme'],
    v => v.seances.push(structuredClone(v.seances[0]))
  ];
  for (const transform of transforms) {
    const { app, state } = fixture();
    const value = input();
    transform(value);
    assert.equal((await app(req(value))).status, 422);
    assert.equal(state.writes, 0);
  }
});

test('bad body, size limit and programme outage never replace the last good feed', async () => {
  const { app, state } = fixture();
  assert.equal((await app(req('{broken'))).status, 422);
  assert.equal((await app(req('x'.repeat(512001)))).status, 413);
  const unavailable = fixture({ fetcher: async () => new Response('', { status: 503 }) });
  assert.equal((await unavailable.app(req(input()))).status, 503);
  assert.equal(state.writes + unavailable.state.writes, 0);
});

test('idempotency, older export and concurrent compare-and-swap protected', async () => {
  const { app, state } = fixture();
  assert.equal((await app(req(input()))).status, 200);
  assert.equal((await app(req(input()))).status, 200);
  assert.equal(state.writes, 1);
  const older = input();
  older.generated_at = new Date(now - 60000).toISOString();
  assert.equal((await app(req(older))).status, 409);
  const concurrent = fixture();
  concurrent.state.conflict = true;
  assert.equal((await concurrent.app(req(input()))).status, 409);
});

test('public empty feed; storage outage is sober and exposes no internal details', async () => {
  const { app } = fixture();
  assert.deepEqual((await (await app(new Request('https://example.com'))).json()).seances, []);
  const broken = fixture({ store: () => { throw new Error('PRIVATE TOKEN'); } });
  const response = await broken.app(new Request('https://example.com'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE/);
});

test('equipment and app/version checks kept separate', () => {
  const v = input();
  v.seances[0].dispositifs = ['hi', 'ad'];
  assert.throws(() => sanitize(v, programme, now));
  assert.equal(sanitize(v, programme, now, 'hi').seances[0].dispositifs.length, 2);
  v.seances[0].applications = { vast: 'Tout en Parlant' };
  v.seances[0].dispositifs = ['vast'];
  assert.throws(() => sanitize(v, programme, now));
});

test('real signature verification rejects wrong audience, issuer, email, expiry, alg and forged signature', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'fixture';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const defaults = { sub: 'fixture', email: env.INGEST_PUBLISHER_EMAIL, email_verified: true,
    aud: env.INGEST_OAUTH_CLIENT_ID, iss: 'https://accounts.google.com',
    iat: now / 1000 - 30, exp: now / 1000 + 3570 };
  const sign = claims => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(privateKey);
  const verify = (await import('jose')).jwtVerify;
  await verifyIdentity(await sign(defaults), env, now, verify, keys);
  for (const claims of [
    { ...defaults, aud: 'wrong' }, { ...defaults, iss: 'wrong' },
    { ...defaults, email: 'other@example.com' }, { ...defaults, email_verified: false },
    { ...defaults, exp: now / 1000 - 60 }, { ...defaults, iat: now / 1000 + 300 },
    { ...defaults, exp: now / 1000 + 8000 }
  ]) await assert.rejects(verifyIdentity(await sign(claims), env, now, verify, keys));
  const forged = (await sign(defaults)).split('.');
  forged[2] = Buffer.from('forged').toString('base64url');
  await assert.rejects(verifyIdentity(forged.join('.'), env, now, verify, keys));
});
