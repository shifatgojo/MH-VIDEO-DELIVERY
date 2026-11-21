const sbc = supabase.createClient(MH.SUPABASE_URL, MH.SUPABASE_PUBLISHABLE_KEY);
const $ = id => document.getElementById(id);
let jwt = null, vids = [];
const api = async (path, opt = {}) => {
  const r = await fetch(MH.API + path, { ...opt, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};
async function init() {
  const { data } = await sbc.auth.getSession();
  jwt = data.session?.access_token;
  $('login').hidden = !!jwt; $('app').hidden = !jwt;
  if (jwt) load();
}
$('login').onsubmit = async e => {
  e.preventDefault();
  const { error } = await sbc.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pass').value });
  if (error) return toast('Login failed. Check email and password.', true);
  init();
};
$('signout').onclick = async () => { await sbc.auth.signOut(); init(); };
async function load() {
  try { vids = await api('/api/admin/videos'); render(); }
  catch { toast('Not authorized as admin.', true); }
}
function render() {
  const q = $('q').value.toLowerCase();
  const rows = vids.filter(v => v.token.toLowerCase().includes(q) || v.video_name.toLowerCase().includes(q));
  $('list').innerHTML = '';
  for (const v of rows) {
    const tr = document.createElement('tr');
    [v.video_name, v.token, new Date(v.created_at).toLocaleDateString(), v.drive_file_id, v.status].forEach(c => {
      const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
    const td = document.createElement('td');
    const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = 'btn sm'; b.onclick = fn; td.appendChild(b); };
    mk('Copy', () => { navigator.clipboard.writeText(v.token); toast('Token copied'); });
    mk(v.status === 'active' ? 'Deactivate' : 'Activate', async () => {
      try { await api('/api/admin/videos/' + v.id, { method: 'PATCH', body: JSON.stringify({ status: v.status === 'active' ? 'inactive' : 'active' }) }); load(); } catch (e) { toast(e.message, true); } });
    mk('Delete', async () => {
      if (!confirm('Delete this video permanently?')) return;
      try { await api('/api/admin/videos/' + v.id, { method: 'DELETE' }); toast('Deleted'); load(); } catch (e) { toast(e.message, true); } });
    tr.appendChild(td); $('list').appendChild(tr);
  }
}
$('q').oninput = render;
$('up').onsubmit = async e => {
  e.preventDefault();
  const file = $('file').files[0], name = $('name').value.trim();
  if (!file) return;
  $('send').disabled = true; $('bar').style.width = '0'; $('bar').parentElement.hidden = false; $('result').hidden = true;
  try {
    const { uploadUrl } = await api('/api/admin/init', { method: 'POST', body: JSON.stringify({ name, size: file.size, type: file.type }) });
    const drive = await new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', uploadUrl);
      x.upload.onprogress = ev => { if (ev.lengthComputable) $('bar').style.width = (ev.loaded / ev.total * 100) + '%'; };
      x.onload = () => x.status < 300 ? res(JSON.parse(x.responseText)) : rej(new Error('Upload to Drive failed'));
      x.onerror = () => rej(new Error('Upload failed')); x.send(file);
    });
    const { token } = await api('/api/admin/finalize', { method: 'POST', body: JSON.stringify({ name, fileId: drive.id }) });
    $('tokenOut').textContent = token; $('result').hidden = false; toast('Upload complete'); $('up').reset(); load();
  } catch (er) { toast(er.message, true); }
  $('send').disabled = false;
};
$('copy').onclick = () => { navigator.clipboard.writeText($('tokenOut').textContent); toast('Token copied'); };
init();
