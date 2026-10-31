// COTL Live, the core: finds the CotlLive plugin on this computer, keeps its status fresh, and runs actions.
// Game names and icons come from api.cotl.info, in the browser's language when the game has it.
// Each page lives in pages/<name>.js and registers itself with page(); this file routes between them.
'use strict';

const PORTS = [47820, 47821, 47822, 47823, 47824];
const API = 'https://api.cotl.info/v1/';
const $ = id => document.getElementById(id);

let base = null, status = null, timer = null, scanTimer = null;
const names = { skins: {}, traits: {}, items: {}, structures: {}, weapons: {}, curses: {}, relics: {}, tarot: {} };
const refreshers = [];  // re-fill selects that list followers or buildings, after each status
let log = [];
try { log = JSON.parse(localStorage.getItem('cotl-live-log') || '[]'); } catch { }

// Builds an element: h('button', { class: 'btn', onclick }, 'Run').
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}

async function call(path, body, timeout = 6000) {
  const res = await fetch(base + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  } : { signal: AbortSignal.timeout(timeout) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- api.cotl.info ---

async function loadNames() {
  try {
    const index = await fetch(API + 'index.json').then(r => r.json());
    const wanted = (navigator.languages || [navigator.language]).flatMap(l => [l, l.split('-')[0]]);
    const lang = wanted.find(l => index.languages.includes(l)) || 'en';
    await Promise.all(Object.keys(names).map(async kind => {
      for (const e of await fetch(`${API}${lang}/${kind}.json`).then(r => r.json())) names[kind][e.id] = e;
    }));
  } catch (e) { console.warn('api.cotl.info unavailable; showing game ids', e); }
}

// A follower's skin is "Duck3" where the API knows "Duck", and "CultLeader 2" where it knows "CultLeader_2".
const entry = (kind, id) => {
  if (id == null) return null;
  const s = String(id), u = s.replace(/ /g, '_');
  return names[kind][s] || names[kind][u] || names[kind][s.replace(/\d+$/, '')] || names[kind][u.replace(/_?\d+$/, '')];
};
// The API's short lists keep the game's text markup (<color=...>); a plain name reads better in a list.
const nameOf = (kind, id) => entry(kind, id)?.name?.replace(/<[^>]+>/g, '') || id;
const iconOf = (kind, id) => entry(kind, id)?.thumb ? API + entry(kind, id).thumb : null;
const sorted = kind => Object.values(names[kind]).map(e => ({ ...e, name: nameOf(kind, e.id) })).sort((a, b) => a.name.localeCompare(b.name));

// --- finding the game ---

async function scan() {
  const hits = (await Promise.all(PORTS.map(async port => {
    const url = `http://127.0.0.1:${port}`;
    try {
      const s = await fetch(url + '/status', { signal: AbortSignal.timeout(1500) }).then(r => r.json());
      return s.app === 'cotl-live' ? { url, port, s } : null;
    } catch { return null; }
  }))).filter(Boolean);
  if (base) return;  // connected while this scan ran
  $('found').replaceChildren(...(hits.length ? hits.map(({ url, port, s }) => h('li', {},
    h('span', { class: 'what' },
      h('b', {}, s.cult || 'No save loaded'),
      h('span', { class: 'muted small' }, [
        s.loaded ? `${s.followers.length} followers` : 'main menu',
        s.inBase ? 'in the cult' : s.inDungeon ? 'on a crusade' : null,
        `game ${s.game}`, `port ${port}`,
      ].filter(Boolean).join(' · '))),
    h('button', { class: 'btn primary', onclick: () => connect(url) }, 'Connect'))
  ) : [h('li', {}, h('span', { class: 'what muted' }, 'Looking for the game…'))]));
}

function showFind() {
  clearInterval(timer); base = null; status = null;
  $('find').hidden = false; for (const p of pages) if (p.el) p.el.hidden = true;
  $('conn').hidden = $('disconnect').hidden = $('nav').hidden = true;
  scan(); clearInterval(scanTimer); scanTimer = setInterval(scan, 4000);
}

async function connect(url) {
  base = url; clearInterval(scanTimer);
  $('find').hidden = true; $('conn').hidden = $('disconnect').hidden = $('nav').hidden = false;
  addLog(`Connected to the game on ${url.split(':').pop()}`);
  for (const p of pages) p.connected?.();
  await refresh();
  timer = setInterval(refresh, 3000);
}

async function refresh() {
  try { status = await call('/status'); }
  catch (e) { addLog(`Lost the game: ${e.message}`, true); return showFind(); }
  $('conn-text').textContent = `Connected · game ${status.game} · plugin ${status.mod}`;
  route();
}

// --- pages ---

// A page registers itself: page({ id, route, nav, match, mount, render, connected }).
// id: its <main> element (taken from index.html, or made by mount()); route: its hash ('#/items'); nav: its label
// in the top bar, if it has one; match(hash): for routes with parameters; render(opening): draws it from the
// latest status, opening being true when it was just shown; connected(): called on connecting and when the
// game's names have loaded.
const pages = [];
function page(p) { pages.push(p); }

function mounted(p) {
  if (!p.el) {
    p.el = $(p.id) || p.mount();
    if (!p.el.isConnected) document.body.append(p.el);
  }
  return p.el;
}

function route() {
  if (!base || !status) return;
  const current = pages.find(p => p.match ? p.match(location.hash) : p.route === location.hash) || pages.find(p => p.route === '#/');
  const opening = mounted(current).hidden;
  for (const p of pages) if (p.el) p.el.hidden = p !== current;
  $('nav').replaceChildren(...pages.filter(p => p.nav).map(p => h('a', { href: p.route, 'aria-current': p === current ? 'page' : null }, p.nav)));
  current.render(opening);
  refreshers.splice(0, refreshers.length, ...refreshers.filter(r => r() !== false));
}
window.addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

const PHASES = { Dawn: 'dawn', Morning: 'morning', Afternoon: 'afternoon', Dusk: 'dusk', Night: 'night' };
const WEATHER = { None: 'clear', Raining: 'rain', Windy: 'wind', Snowing: 'snow', Heat: 'heatwave' };
const STATES = {
  Ill: 'Ill', Injured: 'Injured', BecomeStarving: 'Starving', Dissenter: 'Dissenter', OldAge: 'Elder', Child: 'Child',
  Zombie: 'Zombie', Possessed: 'Possessed',
};
const stateText = f => f.away ? 'Away on a mission' : STATES[f.state] || (f.levelReady ? 'Can level up' : 'Fine');
const stateClass = f => ['Ill', 'Injured', 'BecomeStarving', 'Dissenter'].includes(f.state) ? 'warn' : f.levelReady ? 'gold' : '';

const stat = (label, value, icon) => h('div', { class: 'stat' }, icon && h('img', { src: icon, alt: '' }),
  h('div', {}, h('small', {}, label), h('b', {}, String(value))));

// Selects whose options follow the game: re-filled after each status, keeping the choice.
function liveSelect(fill) {
  const sel = h('select', {});
  const update = () => { const keep = sel.value; sel.replaceChildren(...fill()); if ([...sel.options].some(o => o.value === keep)) sel.value = keep; };
  refreshers.push(() => { if (!sel.isConnected) return false; update(); return true; });  // a select no longer on the page drops out
  update();
  return sel;
}

const followerOptions = () => (status?.followers || []).filter(f => !f.away)
  .slice().sort((a, b) => a.name.localeCompare(b.name)).map(f => new Option(f.name, `id:${f.id}`));


async function act(body, what, button) {
  if (button) button.disabled = true;
  // The plugin names things by game id; show the API's names instead.
  const readable = m => m
    .replace(body.item, () => nameOf('items', body.item))
    .replace(body.trait, () => nameOf('traits', body.trait))
    .replace(body.weather, () => WEATHER[body.weather])
    .replace(body.skin, () => nameOf('skins', body.skin))
    .replace(body.weapon, () => nameOf('weapons', body.weapon))
    .replace(body.curse, () => nameOf('curses', body.curse))
    .replace(body.relic, () => nameOf('relics', body.relic))
    .replace(body.card, () => nameOf('tarot', body.card));
  try { addLog(readable((await call('/act', body)).message)); }
  catch (e) { addLog(`${what}: ${e.message}`, true); }
  finally { if (button) button.disabled = false; }
  refresh();
}

function addLog(text, bad = false) {
  log.unshift({ t: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: text[0].toUpperCase() + text.slice(1), bad });
  log = log.slice(0, 60);
  try { localStorage.setItem('cotl-live-log', JSON.stringify(log)); } catch { }
  renderLog();
}

function renderLog() {
  $('log').replaceChildren(...log.map(e => h('li', {}, h('time', {}, e.t), h('span', { class: e.bad ? 'bad' : '' }, e.text))));
}

const necklaces = () => sorted('items').filter(i => i.id.startsWith('Necklace_')).map(i => new Option(i.name, i.id));

// Every page script has registered itself by the time the document is parsed (scripts are deferred, in order).
document.addEventListener('DOMContentLoaded', () => {
  $('rescan').onclick = scan;
  $('disconnect').onclick = () => { addLog('Disconnected'); showFind(); };
  renderLog();
  loadNames().then(() => { if (base) { for (const p of pages) p.connected?.(); route(); } });
  showFind();
});
