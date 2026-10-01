import { API_VERSION, compatible, INVITE, LISTING_ID } from './protocol.mjs';

export async function browse(fetcher, versions) {
  const response = await fetcher(`/v1/listings?${new URLSearchParams(versions)}`, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Directory unavailable');
  const data = await response.json();
  if (data.apiVersion !== API_VERSION || !Array.isArray(data.listings)) throw new Error('Unsupported directory');
  return data.listings.filter(item => item && LISTING_ID.test(item.id) && compatible(item, versions));
}

export async function resolveJoin(fetcher, id, versions, now = Date.now) {
  if (!LISTING_ID.test(id)) throw new Error('Invalid listing');
  const response = await fetcher(`/v1/listings/${id}/join?${new URLSearchParams(versions)}`, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Host unavailable, full or incompatible; refresh the list');
  const value = await response.json();
  if (value.apiVersion !== API_VERSION || !INVITE.test(value.invite) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) throw new Error('Invalid or expired invite');
  return value;
}

if (typeof document !== 'undefined') {
  const status = document.getElementById('status');
  const list = document.getElementById('listings');
  const join = document.getElementById('join');
  let revision = 0;
  let expiryTimer;
  const clearJoin = () => { clearTimeout(expiryTimer); join.replaceChildren(); };
  const versions = () => ({
    systemLinkVersion: Number(document.getElementById('systemLinkVersion').value),
    netcodeVersion: Number(document.getElementById('netcodeVersion').value),
  });
  document.getElementById('refresh').onclick = async () => {
    const request = ++revision;
    const selectedVersions = versions();
    list.replaceChildren(); clearJoin();
    status.textContent = 'Loading…';
    try {
      const items = await browse(fetch, selectedVersions);
      if (request !== revision) return;
      status.textContent = `${items.length} compatible hosts. Player counts are reported by hosts.`;
      for (const item of items) {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.textContent = `${item.name} — ${item.map} — ${item.players}/${item.maxPlayers} — ${item.state}`;
        button.disabled = item.players >= item.maxPlayers;
        button.onclick = async () => {
          const selected = ++revision;
          clearJoin();
          try {
            const current = await resolveJoin(fetch, item.id, selectedVersions);
            if (selected !== revision) return;
            const link = document.createElement('a');
            link.textContent = 'Open Halo invite for this host';
            link.href = current.invite;
            link.rel = 'noreferrer';
            link.onclick = event => {
              if (Date.now() >= current.expiresAt) {
                event.preventDefault(); clearJoin(); status.textContent = 'Invite expired; select the host again.';
              }
            };
            join.append(link);
            expiryTimer = setTimeout(clearJoin, Math.max(0, current.expiresAt - Date.now()));
            status.textContent = 'Ready. Opening Halo is a separate action; then select the match in System Link.';
          } catch (error) { if (selected === revision) status.textContent = error.message; }
        };
        row.append(button); list.append(row);
      }
    } catch (error) { if (request === revision) status.textContent = error.message; }
  };
  for (const id of ['systemLinkVersion', 'netcodeVersion']) {
    document.getElementById(id).oninput = () => { ++revision; list.replaceChildren(); clearJoin(); status.textContent = 'Refresh to apply versions.'; };
  }
}
