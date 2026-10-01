// Experimental directory contract. No game assets or platform dependencies.
export const API_VERSION = 1;
export const MAX_PLAYERS = 128;
export const MAX_LEASE_MS = 300000;
export const INVITE = /^halo:\/\/join\/[0-9a-f]{64}$/i;
export const LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const fields = ['name', 'map', 'players', 'maxPlayers', 'build',
  'systemLinkVersion', 'netcodeVersion', 'state', 'invite'];

export function validateListing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      fields.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid listing fields');
  const text = (key, max, pattern) => typeof value[key] === 'string' &&
    value[key].length > 0 && value[key].length <= max && pattern.test(value[key]);
  if (!text('name', 80, /^[\x20-\x7e]+$/) || !value.name.trim() ||
      !text('map', 64, /^[a-zA-Z0-9_-]+$/) ||
      !text('build', 64, /^[a-zA-Z0-9._-]+$/) ||
      !['lobby', 'playing'].includes(value.state) ||
      !Number.isInteger(value.players) || !Number.isInteger(value.maxPlayers) ||
      value.players < 0 || value.maxPlayers < 1 || value.maxPlayers > MAX_PLAYERS ||
      value.players > value.maxPlayers ||
      !['systemLinkVersion', 'netcodeVersion'].every(key => Number.isInteger(value[key]) &&
        value[key] >= 1 && value[key] <= 65535) ||
      typeof value.invite !== 'string' || !INVITE.test(value.invite)) {
    throw new Error('Invalid listing values');
  }
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

export function directoryURL(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw new Error('Directory must be an HTTPS origin (HTTP only on 127.0.0.1)');
  }
  return url.origin;
}

export function compatible(listing, versions) {
  return listing.systemLinkVersion === versions.systemLinkVersion &&
    listing.netcodeVersion === versions.netcodeVersion;
}

export function validateFilters(versions) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions) ||
      Object.keys(versions).some(key => !['systemLinkVersion', 'netcodeVersion', 'map'].includes(key)) ||
      !['systemLinkVersion', 'netcodeVersion'].every(key => Number.isInteger(versions[key]) && versions[key] > 0 && versions[key] <= 65535) ||
      (versions.map !== undefined && (typeof versions.map !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(versions.map))))
    throw new Error('Invalid compatibility filters');
  return new URLSearchParams(versions);
}

// Only flat primitive fields are legal registration data. Reject duplicates,
// including escaped spellings of the same key, before JSON.parse can hide them.
export function parseRegistration(text) {
  let offset = 0;
  const result = Object.create(null);
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] || 'x')) offset++; };
  const token = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const read = () => { whitespace(); token.lastIndex = offset; const match = token.exec(text);
    if (!match) throw new Error('Invalid registration JSON'); offset = token.lastIndex; return JSON.parse(match[0]); };
  whitespace(); if (text[offset++] !== '{') throw new Error('Invalid registration JSON');
  whitespace();
  if (text[offset] !== '}') for (;;) {
    const key = read();
    if (typeof key !== 'string' || Object.hasOwn(result, key)) throw new Error('Duplicate or invalid registration field');
    whitespace(); if (text[offset++] !== ':') throw new Error('Invalid registration JSON');
    result[key] = read(); whitespace();
    if (text[offset] !== ',') break;
    offset++;
  }
  if (text[offset++] !== '}') throw new Error('Invalid registration JSON');
  whitespace(); if (offset !== text.length) throw new Error('Invalid registration JSON');
  return result;
}

export async function readBoundedJSON(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel(); throw new Error('Directory response too large');
  }
  if (!response.body) throw new Error('Invalid directory response');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Directory response too large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
