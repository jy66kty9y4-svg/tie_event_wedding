import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicRsvp } from './guest/Workspace.jsx';

const guestCsrf = () => document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('tie_guest_csrf='))?.slice('tie_guest_csrf='.length) || '';
const json = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { accept: 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || 'Страница сейчас недоступна'); error.details = body.details; throw error; }
  return body;
};
function inviteFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  return params.get('invite') || params.get('token') || '';
}
function GuestApp({ shareId }) {
  const [context, setContext] = useState(null); const [error, setError] = useState('');
  const load = async () => {
    try { setError(''); setContext(await json(`/api/public/rsvp/context?shareId=${encodeURIComponent(shareId)}`)); }
    catch (cause) { if (guestCsrf()) setError(cause.message); }
  };
  useEffect(() => {
    const invite = inviteFromHash();
    if (invite) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      json('/api/public/rsvp/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shareId, token: invite }) }).then(load).catch(cause => setError(cause.message));
    } else load();
  }, [shareId]);
  if (error) return <aside className="v2-rsvp" role="status">{error}</aside>;
  if (!context) return null;
  return <PublicRsvp context={context} submit={async body => { const result = await json('/api/public/rsvp/respond', { method: 'POST', headers: { 'content-type': 'application/json', 'x-guest-csrf-token': guestCsrf() }, body: JSON.stringify({ ...body, shareId }) }); await load(); return result; }} />;
}

const shareId = /^\/w\/([^/]+)$/.exec(location.pathname)?.[1];
if (shareId) {
  const mount = document.createElement('div'); mount.id = 'tie-guest-rsvp'; const section=document.querySelector('[data-rsvp]');if(section)section.replaceChildren(mount);else document.body.append(mount);
  createRoot(mount).render(<GuestApp shareId={shareId} />);
}
