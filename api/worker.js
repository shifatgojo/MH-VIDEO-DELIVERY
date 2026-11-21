// Cloudflare Worker: all privileged logic lives here. Secrets come from env.
const TOKEN_RE = /^MH-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_SIZE = 2 * 1024 ** 3; // 2 GB
const TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
let gTok = { v: null, exp: 0 };

async function googleToken(env) {
  if (gTok.v && Date.now() < gTok.exp) return gTok.v;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  if (!r.ok) throw new Error('google token');
  const j = await r.json();
  gTok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return gTok.v;
}
const sb = (env, path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: env.SUPABASE_SECRET_KEY, 'content-type': 'application/json',
    Prefer: 'return=representation', ...(init.headers || {}) } });

function newToken() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(8));
  const c = [...b].map(x => A[x % A.length]).join('');
  return `MH-${c.slice(0, 4)}-${c.slice(4)}`;
}
async function isAdmin(req, env) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!jwt) return false;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${jwt}` } });
  if (!r.ok) return false;
  const u = await r.json();
  const ok = env.ADMIN_EMAILS.toLowerCase().split(',').map(s => s.trim());
  return !!u.email && ok.includes(u.email.toLowerCase());
}
const cleanName = s => String(s || '').trim().replace(/[<>]/g, '').slice(0, 120);

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    const cors = { 'access-control-allow-origin': env.ALLOWED_ORIGIN, vary: 'origin',
      'access-control-allow-headers': 'authorization,content-type,range',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range,accept-ranges,content-length' };
    const send = (o, s = 200) => new Response(JSON.stringify(o), { status: s,
      headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (p === '/api/video' || p === '/api/stream') {
        const t = (url.searchParams.get('token') || '').trim().toUpperCase();
        if (!TOKEN_RE.test(t)) return send({ error: 'not_found' }, 404);
        const r = await sb(env, `videos?token=eq.${encodeURIComponent(t)}&status=eq.active&select=video_name,drive_file_id,created_at&limit=1`);
        const row = (await r.json())[0];
        if (!row) return send({ error: 'not_found' }, 404);
        if (p === '/api/video') return send({ name: row.video_name, created_at: row.created_at });
        const h = { authorization: `Bearer ${await googleToken(env)}` };
        if (req.headers.get('range')) h.range = req.headers.get('range');
        const d = await fetch(`https://www.googleapis.com/drive/v3/files/${row.drive_file_id}?alt=media`, { headers: h });
        if (!d.ok) return send({ error: 'unavailable' }, 502);
        const oh = new Headers(cors);
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
          if (d.headers.get(k)) oh.set(k, d.headers.get(k));
        if (url.searchParams.get('dl') === '1')
          oh.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.video_name)}.mp4`);
        oh.set('cache-control', 'private, no-store');
        return new Response(d.body, { status: d.status, headers: oh });
      }
      if (p.startsWith('/api/admin/')) {
        if (!(await isAdmin(req, env))) return send({ error: 'forbidden' }, 403);
        const g = await googleToken(env);
        if (p === '/api/admin/init' && req.method === 'POST') {
          const b = await req.json(), name = cleanName(b.name);
          if (!name || !TYPES.includes(b.type) || !(b.size > 0 && b.size <= MAX_SIZE))
            return send({ error: 'Invalid name, file type or size (max 2 GB; mp4/webm/mov/mkv).' }, 400);
          const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
            method: 'POST', headers: { authorization: `Bearer ${g}`,
              'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': b.type,
              'x-upload-content-length': String(b.size), origin: env.ALLOWED_ORIGIN },
            body: JSON.stringify({ name: `${crypto.randomUUID()}-${name}`, parents: [env.GOOGLE_DRIVE_FOLDER_ID] }) });
          const loc = r.headers.get('location');
          if (!r.ok || !loc) return send({ error: 'Could not start upload.' }, 502);
          return send({ uploadUrl: loc });
        }
        if (p === '/api/admin/finalize' && req.method === 'POST') {
          const b = await req.json(), name = cleanName(b.name), id = String(b.fileId || '');
          if (!name || !/^[\w-]{10,}$/.test(id)) return send({ error: 'Invalid input.' }, 400);
          const f = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,parents`, { headers: { authorization: `Bearer ${g}` } });
          const fj = await f.json();
          if (!f.ok || !(fj.parents || []).includes(env.GOOGLE_DRIVE_FOLDER_ID)) return send({ error: 'File not found in Drive folder.' }, 400);
          for (let i = 0; i < 5; i++) {
            const token = newToken();
            const r = await sb(env, 'videos', { method: 'POST', body: JSON.stringify({ token, video_name: name, drive_file_id: id }) });
            if (r.ok) return send({ token });
            if (r.status !== 409) break;
          }
          return send({ error: 'Could not save video.' }, 500);
        }
        if (p === '/api/admin/videos' && req.method === 'GET')
          return send(await (await sb(env, 'videos?select=*&order=created_at.desc')).json());
        const m = p.match(/^\/api\/admin\/videos\/(\d+)$/);
        if (m && req.method === 'PATCH') {
          const b = await req.json();
          if (!['active', 'inactive'].includes(b.status)) return send({ error: 'Invalid status.' }, 400);
          return send(await (await sb(env, `videos?id=eq.${m[1]}`, { method: 'PATCH', body: JSON.stringify({ status: b.status }) })).json());
        }
        if (m && req.method === 'DELETE') {
          const row = (await (await sb(env, `videos?id=eq.${m[1]}&select=drive_file_id`)).json())[0];
          if (row) await fetch(`https://www.googleapis.com/drive/v3/files/${row.drive_file_id}`, { method: 'DELETE', headers: { authorization: `Bearer ${g}` } });
          await sb(env, `videos?id=eq.${m[1]}`, { method: 'DELETE' });
          return send({ ok: true });
        }
      }
      return send({ error: 'not_found' }, 404);
    } catch (e) { console.error(e); return send({ error: 'Something went wrong.' }, 500); }
  }
};
