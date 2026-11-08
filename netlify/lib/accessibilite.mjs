import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const PROGRAMME_URL = 'https://cinecarbonne.fr/data/programme.json';
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const MAX_BYTES = 512000;
const ORDER = ['sme', 'hi', 'ad', 'vast'];
const FIELDS = ['titre', 'date', 'heure', 'version'];
const itemFields = ['programme_key', ...FIELDS, 'affiche', 'synopsis', 'duree', 'genre',
  'realisateur', 'statut', 'dispositifs', 'applications'];
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Ingest-Input-Sha256',
  'X-Content-Type-Options': 'nosniff'
};
const hash = value => createHash('sha256').update(value).digest('hex');
const key = s => JSON.stringify(FIELDS.map(k => String(s[k] || '').trim()));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, fields) => object(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const reply = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });

export async function verifyIdentity(token, env, now = Date.now(), verifier = jwtVerify, keys = jwks) {
  if (!env.INGEST_OAUTH_CLIENT_ID?.endsWith('.apps.googleusercontent.com') || !env.INGEST_PUBLISHER_EMAIL) {
    throw new Error('Not configured');
  }
  const { payload } = await verifier(token, keys, {
    algorithms: ['RS256'], audience: env.INGEST_OAUTH_CLIENT_ID,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    requiredClaims: ['sub', 'iat', 'exp', 'email', 'email_verified'],
    currentDate: new Date(now), clockTolerance: 30, maxTokenAge: '1h'
  });
  if (payload.email !== env.INGEST_PUBLISHER_EMAIL || payload.email_verified !== true
      || !payload.sub || payload.exp - payload.iat > 3900) throw new Error('Wrong identity');
}

export function sanitize(input, programme, now = Date.now(), equipment = '') {
  if (!exactKeys(input, ['version', 'timezone', 'generated_at', 'seances'])
      || input.version !== 1 || input.timezone !== 'Europe/Paris'
      || !Array.isArray(input.seances) || input.seances.length > 200 || !Array.isArray(programme)) throw new Error('Invalid feed');
  const age = now - Date.parse(input.generated_at);
  if (!Number.isFinite(age) || age < -120000 || age > 3600000) throw new Error('Stale feed');
  const index = new Map();
  for (const s of programme) {
    if (!object(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.heure)) continue;
    if (/\bscol(?:aire)?s?\b/i.test((s.categorie || '') + ' ' + (s.titre || ''))) continue;
    const id = key(s);
    index.set(id, index.has(id) ? null : s);
  }
  const seen = new Set();
  const enabled = new Set(equipment.split(',').map(s => s.trim()).filter(Boolean));
  const seances = input.seances.map(s => {
    if (!exactKeys(s, itemFields) || typeof s.programme_key !== 'string' || seen.has(s.programme_key)) throw new Error('Invalid session');
    seen.add(s.programme_key);
    const p = index.get(s.programme_key);
    if (!p) throw new Error('Programme changed');
    const devices = s.dispositifs;
    if (!Array.isArray(devices) || !devices.length || new Set(devices).size !== devices.length
        || devices.some(d => !ORDER.includes(d)) || !object(s.applications)
        || !['confirme', 'selon_application'].includes(s.statut)) throw new Error('Invalid devices');
    if (devices.includes('hi') && !enabled.has('hi')) throw new Error('Equipment not confirmed');
    if (devices.includes('ad') && !s.applications.ad && !enabled.has('ad')) throw new Error('Equipment not confirmed');
    const apps = {};
    for (const [device, name] of Object.entries(s.applications)) {
      if (!devices.includes(device) || !((device === 'ad' && name === 'La Bavarde')
          || (device === 'vast' && name === 'Tout en Parlant'))) throw new Error('Unknown application');
      apps[device] = name;
    }
    if (devices.includes('vast') && apps.vast !== 'Tout en Parlant') throw new Error('Missing VAST application');
    const version = String(s.version).replace(/\s+/g, '').toUpperCase();
    const baseVersion = version.replace(/OCAP$/, '');
    const programmeVersion = String(p.version || '').replace(/\s+/g, '').toUpperCase().replace(/OCAP$/, '');
    const base = v => ['VO', 'VOST', 'VOSTF', 'VOSTFR'].includes(v) ? 'VO' : v;
    if (!['VF', 'VO'].includes(base(baseVersion)) || base(baseVersion) !== base(programmeVersion)) throw new Error('Wrong version');
    if (devices.includes('sme') && !version.endsWith('OCAP')) throw new Error('OCAP not planned');
    if (apps.vast && base(baseVersion) !== 'VO' || apps.ad && base(baseVersion) !== 'VF') throw new Error('Wrong application version');
    if ((Object.keys(apps).length > 0) !== (s.statut === 'selon_application')) throw new Error('Wrong status');
    // Never publish user-supplied free text: all metadata is reconstructed from the public programme.
    return { programme_key: s.programme_key, titre: p.titre, date: p.date, heure: p.heure,
      version: s.version, affiche: String(p.affiche_url || ''), synopsis: String(p.synopsis || ''),
      duree: p.duree_min ? p.duree_min + ' min' : '', genre: String(p.genres || ''),
      realisateur: String(p.realisateur || ''), statut: s.statut,
      dispositifs: ORDER.filter(d => devices.includes(d)), applications: apps };
  });
  seances.sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
  return { version: 1, generated_at: input.generated_at, timezone: 'Europe/Paris', seances };
}

export function handler({ store, fetcher = fetch, env = process.env, verify = verifyIdentity, now = Date.now }) {
  return async request => {
    if (request.method === 'GET') {
      try {
        const entry = await store().getWithMetadata('latest', { type: 'json' });
        return reply(200, entry?.data || { version: 1, generated_at: null, timezone: 'Europe/Paris', seances: [] },
          entry ? { 'X-Ingest-Input-Sha256': entry.metadata.input_sha256 } : {});
      } catch { return reply(503, { error: 'Informations momentanement indisponibles.' }); }
    }
    if (request.method !== 'POST') return reply(405, { error: 'Methode non autorisee.' }, { Allow: 'GET, POST' });
    if (!env.INGEST_OAUTH_CLIENT_ID || !env.INGEST_PUBLISHER_EMAIL) return reply(503, { error: 'Envoi non active.' });
    const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
    if (!bearer) return reply(401, { error: 'Autorisation requise.' });
    try { await verify(bearer[1], env, now()); }
    catch { return reply(403, { error: 'Envoi non autorise.' }); }
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply(415, { error: 'Format non accepte.' });
    if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply(413, { error: 'Envoi trop volumineux.' });
    let raw;
    try {
      // Bound the actual stream too: Content-Length alone is not trustworthy.
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { await reader.cancel(); return reply(413, { error: 'Envoi trop volumineux.' }); }
        chunks.push(Buffer.from(value));
      }
      raw = Buffer.concat(chunks);
    } catch { return reply(400, { error: 'Envoi incomplet.' }); }
    let publicFeed;
    try {
      const response = await fetcher(PROGRAMME_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return reply(503, { error: 'Programme temporairement indisponible.' });
      publicFeed = sanitize(JSON.parse(raw.toString('utf8')), await response.json(), now(), env.INGEST_EQUIPMENT || '');
    } catch { return reply(422, { error: 'Export a regenerer apres verification du programme.' }); }
    try {
      const blobs = store();
      const old = await blobs.getWithMetadata('latest', { type: 'json' });
      const input_sha256 = hash(raw);
      if (old?.metadata.input_sha256 === input_sha256) return reply(200, { received: true, input_sha256 });
      if (old && Date.parse(old.data.generated_at) >= Date.parse(publicFeed.generated_at)) return reply(409, { error: 'Un export plus recent existe.' });
      const saved = await blobs.setJSON('latest', publicFeed, {
        metadata: { input_sha256 }, ...(old ? { onlyIfMatch: old.etag } : { onlyIfNew: true })
      });
      if (!saved.modified) return reply(409, { error: 'Envoi concurrent ; relire avant un nouvel export.' });
      return reply(200, { received: true, input_sha256 });
    } catch { return reply(503, { error: 'Reception non confirmee. Export local a conserver.' }); }
  };
}
