(async () => {
  const t = (new URLSearchParams(location.search).get('t') || '').toUpperCase(), box = document.getElementById('box');
  const fail = () => { box.innerHTML = '<p class="error">Video not found. Please check your token.</p><a class="btn" href="find.html">Try again</a>'; };
  try {
    const r = await fetch(`${MH.API}/api/video?token=${encodeURIComponent(t)}`);
    if (!r.ok) return fail();
    const v = await r.json(), src = `${MH.API}/api/stream?token=${encodeURIComponent(t)}`;
    box.innerHTML = '<h1></h1><p class="muted"></p><video controls playsinline preload="metadata"></video><a class="btn" download>Download</a>';
    box.querySelector('h1').textContent = v.name;
    box.querySelector('p').textContent = 'Uploaded ' + new Date(v.created_at).toLocaleDateString();
    box.querySelector('video').src = src;
    box.querySelector('a').href = src + '&dl=1';
  } catch { fail(); }
})();
