import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { API_VERSION, compatible, LISTING_ID, validateListing } from './protocol.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// Loopback-only reference implementation, deliberately not a public service.
// Production requires durable identity provisioning, TLS and abuse operations.
export async function createDirectory({ hosts = new Map(), ttlMs = 45000,
  now = () => performance.now(), wallNow = Date.now, rateLimit = 120,
  maxListings = 256, blockedIds = new Set() } = {}) {
  const page = await readFile(new URL('./browser.html', import.meta.url));
  const script = await readFile(new URL('./browser.mjs', import.meta.url));
  const protocol = await readFile(new URL('./protocol.mjs', import.meta.url));
  const listings = new Map();
  const buckets = new Map();
  const provisioned = new Map(hosts);
  for (const [id, key] of provisioned) {
    if (!LISTING_ID.test(id) || !/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid provisioned identity');
  }

  function prune() {
    for (const [id, listing] of listings) {
      if (listing.deadline <= now() || blockedIds.has(id)) listings.delete(id);
    }
    for (const [id, bucket] of buckets) if (bucket.until <= now()) buckets.delete(id);
  }
  function limit(id) {
    let bucket = buckets.get(id);
    if (!bucket) buckets.set(id, bucket = { count: 0, until: now() + 60000 });
    if (++bucket.count > rateLimit) fail(429, 'Rate limit exceeded');
  }
  function authenticate(req, id) {
    const key = provisioned.get(id);
    const given = req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
    if (!key || !given || !timingSafeEqual(Buffer.from(key), Buffer.from(given))) fail(401, 'Unauthorized');
    if (blockedIds.has(id)) fail(403, 'Listing blocked');
  }
  function filters(url) {
    if ([...url.searchParams.keys()].some(key => !['systemLinkVersion', 'netcodeVersion', 'map'].includes(key)) ||
        [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) fail(400, 'Invalid filters');
    const value = {};
    for (const key of ['systemLinkVersion', 'netcodeVersion']) {
      const raw = url.searchParams.get(key);
      if (!raw || !/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) fail(400, 'Both protocol versions required');
      value[key] = Number(raw);
    }
    const map = url.searchParams.get('map');
    if (map !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(map)) fail(400, 'Invalid map');
    return { ...value, map };
  }
  async function body(req) {
    if (req.headers['content-type'] !== 'application/json') fail(415, 'JSON required');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) fail(413, 'Request too large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(400, 'Invalid JSON'); }
  }
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origin rejected');
      if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 512) fail(400, 'Invalid path');
      const url = new URL(req.url, origin);
      prune();
      limit(req.socket.remoteAddress);
      if (req.method === 'GET' && ['/', '/browser.mjs', '/protocol.mjs'].includes(url.pathname)) {
        const content = url.pathname === '/' ? page : url.pathname === '/browser.mjs' ? script : protocol;
        return send(200, content, url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript');
      }
      if (req.method === 'GET' && url.pathname === '/v1/listings') {
        const filter = filters(url);
        const result = [...listings.values()].filter(item => compatible(item, filter) &&
          (!filter.map || item.map === filter.map)).map(({ invite, deadline, ...visible }) => visible);
        return send(200, { apiVersion: API_VERSION, listings: result });
      }
      const match = url.pathname.match(/^\/v1\/listings\/([^/]+)(\/join)?$/);
      if (!match || !LISTING_ID.test(match[1])) fail(404, 'Not found');
      const id = match[1];
      if (match[2] && req.method === 'GET') {
        const filter = filters(url);
        const listing = listings.get(id);
        if (!listing) fail(404, 'Listing expired or unavailable');
        if (!compatible(listing, filter) || (filter.map && listing.map !== filter.map)) fail(409, 'Incompatible game');
        if (listing.players >= listing.maxPlayers) fail(409, 'Game is full');
        return send(200, { apiVersion: API_VERSION, invite: listing.invite, expiresAt: listing.expiresAt });
      }
      if (match[2] || !['PUT', 'DELETE'].includes(req.method)) fail(405, 'Method not allowed');
      if (url.search) fail(400, 'Unexpected query');
      authenticate(req, id);
      if (req.method === 'DELETE') {
        listings.delete(id);
        return send(200, { withdrawn: true });
      }
      const raw = await body(req);
      let listing;
      try { listing = validateListing(raw); } catch { fail(400, 'Invalid listing'); }
      if (!listings.has(id) && listings.size >= maxListings) fail(503, 'Directory full');
      const expiresAt = wallNow() + ttlMs;
      listings.set(id, { ...listing, id, expiresAt, deadline: now() + ttlMs });
      return send(200, { apiVersion: API_VERSION, id, expiresAt, heartbeatAfterMs: Math.floor(ttlMs / 3) });
    } catch (error) {
      send(error.status || 500, { error: error.status ? error.message : 'Directory error' });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  server.maxConnections = 64;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
