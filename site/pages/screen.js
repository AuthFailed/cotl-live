// The game's own picture, refreshed every second.
'use strict';

let shotUrl = null, shooting = false;
async function screenLoop() {
  if (shooting) return;
  shooting = true;
  while (base && !$('screen').hidden) {
    try {
      const blob = await fetch(base + '/screen', { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      const url = URL.createObjectURL(blob);
      $('screen-img').src = url;
      if (shotUrl) URL.revokeObjectURL(shotUrl);
      shotUrl = url;
    } catch { }
    await new Promise(r => setTimeout(r, $('screen-live').checked ? 1000 : 600000));
    while (!$('screen-live').checked && base && !$('screen').hidden) await new Promise(r => setTimeout(r, 500));
  }
  shooting = false;
}

page({ id: 'screen', route: '#/screen', nav: 'Screen', render: opening => { if (opening) screenLoop(); } });
