// The live map: the cult as the game draws it, from map.cotl.info's published renders (backdrop tiles and every
// building's in-game render, captured by the planner's tools), with the real buildings, the Lamb and the followers
// from the plugin's /map. Click a building to change it, empty ground to build or send the Lamb there.
'use strict';

const PLANNER = 'https://map.cotl.info/data/';
// The game turns the build grid 45° and its camera looks down at about 45°: cell (x, y) lands at
// K·(x − y, −V·(x + y)) before zoom and pan (the planner's projection).
const K = Math.SQRT1_2, V = Math.SQRT1_2;
// Scenery the game lets you build over: followers clear it first.
const CLEARABLE = new Set(['TREE', 'RUBBLE', 'RUBBLE_BIG', 'WEEDS', 'BERRY_BUSH', 'ICE_BLOCK', 'TOXIC_WASTE', 'SNOW_DRIFT']);
const TAB_NAMES = { follower: 'Followers', faith: 'Faith', decor: 'Decorations', woolhaven: 'Woolhaven' };

const map = {
  data: null,          // planner data: base, bg, game, atlases by look
  live: null,          // last /map
  view: { s: 30, tx: 0, ty: 0 },
  look: 'day',
  mode: { kind: 'view' }, // or { kind: 'place', type, flipped } or { kind: 'move', id }
  hover: null,         // cell under the pointer
  selected: null,      // { kind: 'building', id } or { kind: 'ground', x, y }
  timer: null, fitted: false, frame: 0,
};
const images = new Map();
const canvas = $('map'), ctx = canvas.getContext('2d');

async function mapData() {
  if (map.data) return map.data;
  const get = u => fetch(PLANNER + u).then(r => r.ok ? r.json() : null).catch(() => null);
  const [base, bg, game] = await Promise.all([get('base.json'), get('background.json'), get('game.json')]);
  if (!base || !bg || !game) throw new Error('map.cotl.info is unavailable');
  const chainOf = {};
  for (const chain of game.chains) for (const T of chain) chainOf[T] = chain;
  map.data = { base, bg, game, chainOf, atlases: {} };
  return map.data;
}

async function atlas(look) {
  const d = map.data;
  if (!(look in d.atlases)) {
    d.atlases[look] = null;
    d.atlases[look] = await fetch(`${PLANNER}looks/${look}/sprites.json`).then(r => r.json()).catch(() => null);
    draw();
  }
  return d.atlases[look];
}

function img(url) {
  let i = images.get(url);
  if (!i) { i = new Image(); i.crossOrigin = 'anonymous'; i.onload = draw; i.src = url; images.set(url, i); }
  return i.complete && i.naturalWidth ? i : null;
}

// The look that matches the game right now.
function lookNow() {
  const w = status?.weather, p = status?.phase;
  return w === 'Snowing' ? 'winter' : w === 'Raining' ? 'rain' : p === 'Night' ? 'night' : 'day';
}

const toScreen = (x, y, v = map.view) => [v.s * K * (x - y) + v.tx, -v.s * K * V * (x + y) + v.ty];
function cellAt(px, py) {
  const v = map.view, X = (px - v.tx) / (v.s * K), Y = (py - v.ty) / (v.s * K * V);
  return { x: Math.round((X - Y) / 2), y: Math.round((-X - Y) / 2) };
}

function tiles() {
  const { base } = map.data, land = Math.max(0, map.live?.land ?? 0);
  return [base.tiles, ...base.expansions.slice(0, land)].flat();
}

function fit() {
  const r = canvas.getBoundingClientRect(), t = tiles();
  const xs = t.map(([x, y]) => K * (x - y)), ys = t.map(([x, y]) => -K * V * (x + y));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 4, y1 = Math.max(...ys) + 1;
  const s = Math.min(r.width / (x1 - x0 + 2), r.height / (y1 - y0 + 2));
  map.view = { s, tx: r.width / 2 - s * (x0 + x1) / 2, ty: r.height / 2 - s * (y0 + y1) / 2 };
}

// A planner atlas item: [x, y, w, h, anchorX, anchorY, sheet] at full detail; a coarser sheet for small zooms.
function art(T) {
  const a = map.data.atlases[map.look] || map.data.atlases.day, it = a?.items[T];
  if (!it) return null;
  const need = map.view.s / a.ppu * devicePixelRatio, level = need > 1 / 2 ? 1 : need > 1 / 3 ? 2 : 3;
  const sheet = a.sheets[it[6] ?? 0], look = a === map.data.atlases[map.look] ? map.look : 'day';
  // the sheet at the detail the zoom needs, else the full one while that loads; items and ppu scale with it
  for (const k of level > 1 ? [level, 1] : [1]) {
    const image = img(`${PLANNER}looks/${look}/${k > 1 ? `${sheet}@${k}` : sheet}.avif`);
    if (image) return { image, item: it.slice(0, 6).map(n => n / k), ppu: a.ppu / k };
  }
  return null;
}

const footprintOf = (T, flipped) => {
  const t = map.data.game.types[T] || { w: 1, h: 1 };
  return flipped ? { w: t.h, h: t.w } : { w: t.w, h: t.h };
};

function occupied(except) {
  const cells = new Map();
  for (const s of map.live?.structures || []) {
    if (s.id === except || CLEARABLE.has(s.type)) continue;
    const site = s.building ? footprintOf(s.building, s.flipped) : { w: s.w, h: s.h };
    for (let x = 0; x < site.w; x++) for (let y = 0; y < site.h; y++) cells.set(`${s.x + x},${s.y + y}`, s);
  }
  return cells;
}

function fits(x, y, size, except) {
  const ground = new Set(tiles().map(([a, b]) => `${a},${b}`)), taken = occupied(except);
  for (let i = 0; i < size.w; i++) for (let j = 0; j < size.h; j++) {
    const k = `${x + i},${y + j}`;
    if (!ground.has(k) || taken.has(k)) return false;
  }
  return true;
}

// ---- drawing ----

let drawQueued = false;
function draw() {
  if (drawQueued || $('mapPage').hidden || !map.data) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; paint(); });
}

function paint() {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio;
  if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0a09'; ctx.fillRect(0, 0, r.width, r.height);
  backdrop(r, dpr);
  if (map.mode.kind !== 'view') grid();
  const items = [];
  for (const s of map.live?.structures || []) items.push({ depth: s.x + s.y + (s.w + s.h) / 2, draw: () => building(s) });
  for (const f of map.live?.followers || []) items.push({ depth: f.at.x + f.at.y - 1, draw: () => marker(f.at, status?.followers?.find(x => x.id === f.id)) });
  if (map.live?.lamb) items.push({ depth: map.live.lamb.x + map.live.lamb.y - 1, draw: () => marker(map.live.lamb, null) });
  items.sort((a, b) => b.depth - a.depth).forEach(i => i.draw());
  ghost();
}

function backdrop(r, dpr) {
  const { bg } = map.data, v = map.view, n = Math.min(Math.max(0, map.live?.land ?? 0), bg.images.length - 1);
  const name = bg.images[n], x0 = v.s * bg.u0 + v.tx, y0 = -v.s * bg.v0 + v.ty, k = v.s / bg.ppu;
  const small = img(`${PLANNER}looks/${map.look}/${name}.small.webp`) || img(`${PLANNER}looks/day/${name}.small.webp`);
  if (small) ctx.drawImage(small, x0, y0, bg.w * k, bg.h * k);
  const t = bg.tile, need = k * dpr, level = need > 1 / 2 ? 1 : need > 1 / 3 ? 2 : 3;
  const span = (a, b, o, count) => [Math.max(0, Math.floor((a - o) / k / t.size)), Math.min(count - 1, Math.floor((b - o) / k / t.size))];
  const [c0, c1] = span(0, r.width, x0, t.cols), [r0, r1] = span(0, r.height, y0, t.rows);
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const tile = img(`${PLANNER}looks/${map.look}/${name}/${col}_${row}${level > 1 ? `@${level}` : ''}.avif`);
    if (tile) ctx.drawImage(tile, x0 + (col * t.size - t.border) * k, y0 + (row * t.size - t.border) * k, (t.size + 2 * t.border) * k, (t.size + 2 * t.border) * k);
  }
}

function diamond(x, y, w, h) {
  const p = [toScreen(x - .5, y - .5), toScreen(x + w - .5, y - .5), toScreen(x + w - .5, y + h - .5), toScreen(x - .5, y + h - .5)];
  ctx.beginPath(); ctx.moveTo(...p[0]); for (const q of p.slice(1)) ctx.lineTo(...q); ctx.closePath();
}

function grid() {
  ctx.strokeStyle = 'rgba(239, 230, 216, .16)'; ctx.lineWidth = 1;
  for (const [x, y] of tiles()) { diamond(x, y, 1, 1); ctx.stroke(); }
}

function building(s) {
  const T = s.building || s.type, a = art(T), sel = map.selected?.kind === 'building' && map.selected.id === s.id;
  const moving = map.mode.kind === 'move' && map.mode.id === s.id;
  if (sel || s.building) {
    const f = s.building ? footprintOf(s.building, s.flipped) : s;
    diamond(s.x, s.y, f.w, f.h);
    ctx.fillStyle = sel ? 'rgba(239, 211, 138, .28)' : 'rgba(239, 230, 216, .12)'; ctx.fill();
    ctx.strokeStyle = sel ? '#EFD38A' : 'rgba(239, 230, 216, .5)'; ctx.setLineDash(s.building ? [4, 4] : []); ctx.lineWidth = sel ? 2 : 1; ctx.stroke(); ctx.setLineDash([]);
  }
  if (a) {
    const [x, y, w, h, ax, ay] = a.item, k = map.view.s / a.ppu, [px, py] = toScreen(s.x, s.y);
    ctx.save(); ctx.translate(px, py); if (s.flipped) ctx.scale(-1, 1);
    ctx.globalAlpha = s.building ? .45 : moving ? .35 : 1;
    ctx.drawImage(a.image, x, y, w, h, -ax * k, -ay * k, w * k, h * k);
    ctx.restore();
    return;
  }
  // No render (scenery, mess, a few rare buildings): the API's icon standing on its cell, or its footprint.
  const icon = iconOf('structures', T), [px, py] = toScreen(s.x + (s.w - 1) / 2, s.y + (s.h - 1) / 2);
  const ic = icon && img(icon), size = Math.max(10, map.view.s * .9);
  if (ic) ctx.drawImage(ic, px - size / 2, py - size * .85, size, size);
  else { diamond(s.x, s.y, s.w, s.h); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill(); }
}

function marker(at, f) {
  const [px, py] = toScreen(at.x - .5, at.y - .5), r = Math.max(9, Math.min(map.view.s * .45, 22));
  ctx.save();
  ctx.beginPath(); ctx.ellipse(px, py, r * .8, r * .35, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.beginPath(); ctx.arc(px, py - r * 1.2, r, 0, Math.PI * 2);
  ctx.fillStyle = f ? '#2A221E' : '#B8322A'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = f ? (['Ill', 'Injured', 'Dissenter', 'BecomeStarving'].includes(f.state) ? '#EE6A5E' : '#EFE6D8') : '#FFFFFF'; ctx.stroke();
  const ic = f && iconOf('skins', f.skin) && img(iconOf('skins', f.skin));
  if (ic) { ctx.clip(); ctx.drawImage(ic, px - r, py - r * 2.2, r * 2, r * 2); }
  else if (!f) { ctx.fillStyle = '#fff'; ctx.font = `600 ${r}px 'IBM Plex Sans', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('L', px, py - r * 1.2); }
  ctx.restore();
}

function ghost() {
  const m = map.mode, c = map.hover;
  if (!c || m.kind === 'view') return;
  const s = m.kind === 'place' ? { type: m.type, flipped: m.flipped } : map.live.structures.find(x => x.id === m.id);
  if (!s) return;
  const size = m.kind === 'place' ? footprintOf(m.type, m.flipped) : { w: s.w, h: s.h };
  const ok = fits(c.x, c.y, size, m.kind === 'move' ? m.id : undefined);
  diamond(c.x, c.y, size.w, size.h);
  ctx.fillStyle = ok ? 'rgba(127, 196, 138, .3)' : 'rgba(238, 106, 94, .35)'; ctx.fill();
  const a = art(s.building || s.type);
  if (a) {
    const [x, y, w, h, ax, ay] = a.item, k = map.view.s / a.ppu, [px, py] = toScreen(c.x, c.y);
    ctx.save(); ctx.translate(px, py); if (s.flipped) ctx.scale(-1, 1); ctx.globalAlpha = .7;
    ctx.drawImage(a.image, x, y, w, h, -ax * k, -ay * k, w * k, h * k); ctx.restore();
  }
}

// ---- picking ----

function hit(px, py) {
  // followers and the Lamb first (they stand in front), then a building's footprint, then its picture front to back
  for (const f of map.live?.followers || []) {
    const [x, y] = toScreen(f.at.x - .5, f.at.y - .5), r = Math.max(9, Math.min(map.view.s * .45, 22));
    if (Math.hypot(px - x, py - (y - r * 1.2)) <= r) return { kind: 'follower', id: f.id };
  }
  const c = cellAt(px, py), list = map.live?.structures || [];
  const under = occupied().get(`${c.x},${c.y}`) || list.find(s => CLEARABLE.has(s.type) && s.x <= c.x && c.x < s.x + s.w && s.y <= c.y && c.y < s.y + s.h);
  if (under) return { kind: 'building', id: under.id };
  const front = list.filter(s => !CLEARABLE.has(s.type)).sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const s of front) {
    const a = art(s.building || s.type);
    if (!a) continue;
    const [, , w, h, ax, ay] = a.item, k = map.view.s / a.ppu, [x, y] = toScreen(s.x, s.y);
    const left = s.flipped ? x - (w - ax) * k : x - ax * k;
    if (px >= left && px <= left + w * k && py >= y - ay * k && py <= y - ay * k + h * k * .8) return { kind: 'building', id: s.id };
  }
  return { kind: 'ground', ...c };
}

// ---- the card beside the map ----

const levelOf = T => { const chain = map.data.chainOf[T]; return chain ? chain.indexOf(T) + 1 : 0; };
const nextOf = T => { const chain = map.data.chainOf[T]; return chain?.[chain.indexOf(T) + 1]; };
const opts = () => ({ free: $('map-free').checked, instant: $('map-instant').checked });

async function mapAct(body, what, button) {
  await act(body, what, button);
  await refreshMap();
  showCard();
}

function showCard() {
  const card = $('map-card'), sel = map.selected;
  if (!sel || map.mode.kind !== 'view') { card.hidden = true; return; }
  card.hidden = false;
  const btn = (label, fn, cls = 'btn') => h('button', { class: cls, onclick: e => fn(e.currentTarget) }, label);
  if (sel.kind === 'ground') {
    card.replaceChildren(
      h('h2', {}, 'Empty ground'), h('p', { class: 'muted small' }, `Cell ${sel.x}, ${sel.y}`),
      h('div', { class: 'stack' },
        btn('Build here', () => openBuildMenu(), 'btn primary'),
        btn('Send the Lamb here', b => mapAct({ action: 'goto', x: sel.x, y: sel.y }, 'Send the Lamb', b))));
    return;
  }
  const s = map.live.structures.find(x => x.id === sel.id);
  if (!s) { card.hidden = true; return; }
  const T = s.building || s.type, next = !s.building && nextOf(s.type), level = levelOf(T);
  const icon = iconOf('structures', T);
  card.replaceChildren(
    h('div', { class: 'row', style: 'flex-wrap: nowrap' }, icon && h('img', { src: icon, alt: '', width: 48, height: 48 }),
      h('div', {}, h('h2', {}, nameOf('structures', T)),
        h('p', { class: 'muted small', style: 'margin: 0' }, s.building ? 'Being built' : CLEARABLE.has(s.type) ? 'Scenery' : level > 1 ? `Level ${level}` : 'Building'))),
    h('div', { class: 'stack' },
      CLEARABLE.has(s.type) || !s.movable ? null : btn('Move', () => { map.mode = { kind: 'move', id: s.id }; mapHint(); showCard(); draw(); }),
      CLEARABLE.has(s.type) || s.building || !s.flippable ? null : btn('Flip', b => mapAct({ action: 'flip', id: s.id }, 'Flip', b)),
      next && s.removable ? btn(`Upgrade to ${nameOf('structures', next)}`, b => mapAct({ action: 'upgrade', id: s.id, ...opts() }, 'Upgrade', b)) : null,
      !s.removable ? h('p', { class: 'muted small' }, 'The game doesn’t let this one be taken down.') : btn('Remove', b => confirm(`Remove ${nameOf('structures', T)}? You get nothing back.`) && mapAct({ action: 'remove', id: s.id }, 'Remove', b), 'btn danger')));
}

function mapHint() {
  const m = map.mode, hint = $('map-hint');
  hint.hidden = m.kind === 'view';
  if (m.kind === 'place') hint.replaceChildren(`Placing ${nameOf('structures', m.type)}: click where it goes. `,
    h('button', { class: 'btn', onclick: () => { m.flipped = !m.flipped; draw(); } }, 'Flip (F)'), ' ',
    h('button', { class: 'btn', onclick: cancelMode }, 'Done (Esc)'));
  if (m.kind === 'move') hint.replaceChildren('Click the new spot for it. ', h('button', { class: 'btn', onclick: cancelMode }, 'Cancel (Esc)'));
}

function cancelMode() { map.mode = { kind: 'view' }; mapHint(); showCard(); draw(); }

function openBuildMenu() {
  const { game } = map.data, menu = $('build-menu');
  let tab = menu.dataset.tab || game.menu[0].id;
  const costText = T => (game.costs[T] || []).map(([item, n]) => `${n} ${nameOf('items', item)}`).join(', ');
  const render = () => {
    const t = game.menu.find(x => x.id === tab);
    const q = $('build-filter')?.value.trim().toLowerCase() || '';
    menu.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', {}, 'Build'), h('button', { class: 'btn', onclick: () => { menu.hidden = true; } }, 'Close')),
      h('input', { id: 'build-filter', type: 'search', placeholder: 'Find a building', value: q, oninput: render, style: 'width: 100%' }),
      h('div', { class: 'tabs', style: 'margin: 10px 0' }, ...game.menu.map(x => h('button', { class: 'tab', 'aria-selected': String(x.id === tab), onclick: () => { tab = menu.dataset.tab = x.id; render(); } }, TAB_NAMES[x.id] || x.id))),
      ...(q ? [{ id: 'found', types: game.menu.flatMap(x => x.sections.flatMap(s => s.types)) }] : t.sections).map(s => {
        const types = s.types.filter(T => !q || nameOf('structures', T).toLowerCase().includes(q));
        return types.length ? h('section', {}, h('h3', { class: 'eyebrow', style: 'margin: 12px 0 6px' }, s.id),
          h('div', { class: 'build-grid' }, ...types.map(T => h('button', {
            class: 'build-item', title: costText(T) || 'Free',
            onclick: () => { menu.hidden = true; map.mode = { kind: 'place', type: T, flipped: false }; map.selected = null; mapHint(); showCard(); draw(); },
          }, iconOf('structures', T) && h('img', { src: iconOf('structures', T), alt: '' }), h('span', {}, nameOf('structures', T)),
            h('small', { class: 'muted' }, costText(T) || 'Free'))))) : null;
      }));
    const f = $('build-filter'); if (q && f) { f.focus(); f.setSelectionRange(q.length, q.length); }
  };
  render();
  menu.hidden = false;
}

// ---- input ----

let drag = null;
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, tx: map.view.tx, ty: map.view.ty, moved: false }; });
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) { map.view.tx = drag.tx + dx; map.view.ty = drag.ty + dy; draw(); }
  }
  const c = cellAt(e.clientX - r.left, e.clientY - r.top);
  if (!map.hover || c.x !== map.hover.x || c.y !== map.hover.y) { map.hover = c; if (map.mode.kind !== 'view') draw(); }
});
canvas.addEventListener('pointerup', async e => {
  const was = drag; drag = null;
  if (!was || was.moved) return;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, c = cellAt(px, py), m = map.mode;
  if (m.kind === 'place') return mapAct({ action: 'build', type: m.type, x: c.x, y: c.y, flipped: m.flipped, ...opts() }, 'Build');
  if (m.kind === 'move') { map.mode = { kind: 'view' }; mapHint(); return mapAct({ action: 'move', id: m.id, x: c.x, y: c.y }, 'Move'); }
  const target = hit(px, py);
  if (target.kind === 'follower') { location.hash = `#/f/${target.id}`; return; }
  map.selected = target; showCard(); draw();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, v = map.view;
  const s = Math.max(6, Math.min(v.s * Math.exp(-e.deltaY / 400), 160));
  map.view = { s, tx: px - (px - v.tx) * s / v.s, ty: py - (py - v.ty) * s / v.s };
  draw();
}, { passive: false });
addEventListener('keydown', e => {
  if ($('mapPage').hidden || e.target.matches('input, select, textarea')) return;
  if (e.key === 'Escape') { $('build-menu').hidden = true; cancelMode(); }
  if ((e.key === 'f' || e.key === 'F') && map.mode.kind === 'place') { map.mode.flipped = !map.mode.flipped; draw(); }
});
addEventListener('resize', draw);
$('map-zoom-in').onclick = () => zoomBy(1.3);
$('map-zoom-out').onclick = () => zoomBy(1 / 1.3);
$('map-fit').onclick = () => { fit(); draw(); };
$('map-build').onclick = openBuildMenu;
$('map-shot').onclick = () => { location.hash = '#/screen'; };
function zoomBy(f) {
  const r = canvas.getBoundingClientRect(), v = map.view, s = Math.max(6, Math.min(v.s * f, 160));
  map.view = { s, tx: r.width / 2 - (r.width / 2 - v.tx) * s / v.s, ty: r.height / 2 - (r.height / 2 - v.ty) * s / v.s };
  draw();
}

// ---- page life ----

async function refreshMap() {
  try { map.live = await call('/map'); }
  catch (e) { $('map-note').hidden = false; $('map-note').textContent = e.message; return; }
  map.look = lookNow(); atlas(map.look); atlas('day');
  $('map-note').hidden = map.live.inBase;
  $('map-note').textContent = 'The Lamb is away from the cult: this is the cult as it was left. Building and moving work once the Lamb is back.';
  if (!map.fitted) { fit(); map.fitted = true; }
  draw();
}

async function showMap() {
  try { await mapData(); }
  catch (e) { $('map-note').hidden = false; $('map-note').textContent = `${e.message}; try again later.`; return; }
  await refreshMap();
  clearInterval(map.timer);
  map.timer = setInterval(() => { if ($('mapPage').hidden || !base) clearInterval(map.timer); else refreshMap(); }, 1500);
}
