import { directoryURL, LISTING_ID, validateListing } from './protocol.mjs';

// Call update with an authoritative snapshot from the host's lifecycle, never
// from clipboard/log scraping. Timers belong to the adapter, not the game thread.
// Credentials and the stable listing ID are provisioned by a directory operator.
export class HostRegistration {
  constructor({ directory, id, key, fetcher = fetch, timeoutMs = 3000 }) {
    this.directory = directoryURL(directory);
    if (!LISTING_ID.test(id) || !/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid host identity');
    this.id = id;
    this.key = key;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.registered = false;
    this.pending = Promise.resolve();
    this.revision = 0;
  }

  update(snapshot) {
    // Serialize heartbeats and withdrawals so an older heartbeat cannot race a
    // private/stopped snapshot and restore a withdrawn listing.
    const copy = { ...snapshot };
    const revision = ++this.revision;
    const operation = this.pending.then(() => revision === this.revision ? this.apply(copy) : false);
    this.pending = operation.catch(() => {});
    return operation;
  }

  async apply(snapshot) {
    if (snapshot.public !== true || snapshot.online !== true ||
        !['lobby', 'playing'].includes(snapshot.state)) {
      return this.withdraw();
    }
    const { public: optIn, online, ...data } = snapshot;
    let listing;
    try { listing = validateListing(data); }
    catch (error) { await this.withdraw(); throw error; }
    // A timed-out PUT may have succeeded at the server. Always attempt DELETE
    // on a subsequent private/stopped snapshot; expiry handles process crashes.
    this.registered = true;
    await this.request('PUT', listing);
    return true;
  }

  async withdraw() {
    if (!this.registered) return false;
    await this.request('DELETE');
    this.registered = false;
    return false;
  }

  async request(method, listing) {
    const response = await this.fetcher(`${this.directory}/v1/listings/${this.id}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: listing ? JSON.stringify(listing) : undefined,
    });
    // Do not echo response bodies, addresses or credentials into logs.
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Directory update failed (${response.status})`);
  }
}
