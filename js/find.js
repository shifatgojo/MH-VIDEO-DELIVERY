const f = document.getElementById('f'), tok = document.getElementById('tok'), btn = document.getElementById('go'), err = document.getElementById('err');
f.addEventListener('submit', async e => {
  e.preventDefault(); err.textContent = '';
  const t = tok.value.trim().toUpperCase();
  if (!/^MH-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(t)) { err.textContent = 'Video not found. Please check your token.'; return; }
  btn.disabled = true; btn.textContent = 'Searching…';
  try {
    const r = await fetch(`${MH.API}/api/video?token=${encodeURIComponent(t)}`);
    if (r.ok) { location.href = `video.html?t=${encodeURIComponent(t)}`; return; }
    err.textContent = 'Video not found. Please check your token.';
  } catch { err.textContent = 'Could not connect. Please try again.'; }
  btn.disabled = false; btn.textContent = 'Find Video';
});
