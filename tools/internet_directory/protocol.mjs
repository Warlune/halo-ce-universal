// Experimental directory contract. No game assets or platform dependencies.
export const API_VERSION = 1;
export const MAX_PLAYERS = 128;
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
