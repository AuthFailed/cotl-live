// COTL Live: finds the CotlLive plugin on this computer, then shows the cult and runs actions through it.
// Game names and icons come from api.cotl.info, in the browser's language when the game has it.
'use strict';

const PORTS = [47820, 47821, 47822, 47823, 47824];
const API = 'https://api.cotl.info/v1/';
const $ = id => document.getElementById(id);

let base = null, status = null, timer = null, scanTimer = null, tab = 'followers';
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
  $('find').hidden = false; for (const p of PAGES) $(p).hidden = true;
  $('conn').hidden = $('disconnect').hidden = $('nav').hidden = true;
  scan(); clearInterval(scanTimer); scanTimer = setInterval(scan, 4000);
}

async function connect(url) {
  base = url; clearInterval(scanTimer);
  $('find').hidden = true; $('conn').hidden = $('disconnect').hidden = $('nav').hidden = false;
  addLog(`Connected to the game on ${url.split(':').pop()}`);
  buildActions();
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

const PAGES = ['dash', 'one', 'mapPage', 'items', 'run', 'screen'];
const ROUTES = { '#/map': 'mapPage', '#/items': 'items', '#/run': 'run', '#/screen': 'screen' };

function route() {
  if (!base || !status) return;
  const m = location.hash.match(/^#\/f\/(\d+)$/);
  const f = m && status.followers?.find(x => x.id === +m[1]);
  const page = f ? 'one' : ROUTES[location.hash] || 'dash';
  const opening = $(page).hidden;
  for (const p of PAGES) $(p).hidden = p !== page;
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', (ROUTES[a.getAttribute('href')] || 'dash') === page && !f);
  for (const a of document.querySelectorAll('#nav a[aria-current]')) a.setAttribute('aria-current', 'page');
  if (page === 'one') renderFollower(f);
  if (page === 'dash') renderDash();
  if (page === 'mapPage' && opening) showMap();
  if (page === 'items') renderItems(opening);
  if (page === 'run') renderRun(opening);
  if (page === 'screen' && opening) screenLoop();
  for (const r of refreshers) r();
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

function renderDash() {
  const s = status;
  $('cult-name').textContent = s.cult || 'No save loaded';
  $('cult-where').textContent = !s.loaded ? 'Load a save in the game to begin.' : [
    `Day ${s.day}`, PHASES[s.phase] || s.phase, s.weather && WEATHER[s.weather],
    s.inBase ? 'in the cult' : s.inDungeon ? 'on a crusade' : 'travelling',
  ].filter(Boolean).join(' · ');
  const fs = s.followers || [];
  const chest = new Map((s.chest || []).map(c => [c.item, c.count]));
  $('stats').replaceChildren(...(!s.loaded ? [] : [
    stat('Followers', fs.length), stat('Ill', fs.filter(f => f.state === 'Ill').length), stat('Faith', `${s.faith}%`),
    stat('Recruits', s.recruits), s.lamb && stat('Lamb', `${s.lamb.hp / 2} / ${s.lamb.max / 2} ♥`),
    ...['BLACK_GOLD', 'LOG', 'STONE', 'BERRY'].map(i => stat(nameOf('items', i), chest.get(i) || 0, iconOf('items', i))),
  ].filter(Boolean)));
  const q = $('filter').value.trim().toLowerCase();
  $('followers').replaceChildren(...fs.filter(f => !q || f.name.toLowerCase().includes(q)).map(f =>
    h('a', { class: 'person', href: `#/f/${f.id}` },
      h('img', { src: iconOf('skins', f.skin) || '', alt: '', width: 44, height: 44, loading: 'lazy' }),
      h('span', { style: 'min-width: 0' }, h('b', {}, f.name), h('small', { class: stateClass(f) }, stateText(f))))));
  renderTabs();
}

const stat = (label, value, icon) => h('div', { class: 'stat' }, icon && h('img', { src: icon, alt: '' }),
  h('div', {}, h('small', {}, label), h('b', {}, String(value))));

// --- actions ---

// target: 'many' (random n, everyone, or one follower), 'one' (a follower), none. need: where it works.
const ACTIONS = {
  followers: [
    { action: 'ill', name: 'Make ill', desc: 'Healthy followers fall ill.', target: 'many' },
    { action: 'injure', name: 'Injure', desc: 'Followers get hurt and need the healing bay.', target: 'many' },
    { action: 'exhaust', name: 'Exhaust', desc: 'Followers drop what they are doing and need sleep.', target: 'many' },
    { action: 'starve', name: 'Starve', desc: 'Followers start starving.', target: 'many' },
    { action: 'dissent', name: 'Turn dissenter', desc: 'A follower starts spreading dissent.', target: 'many' },
    { action: 'old', name: 'Make old', desc: 'A follower ages into an elder.', target: 'many' },
    { action: 'kill', name: 'Kill', desc: 'A follower dies. You are asked first.', target: 'one', danger: true },
    { action: 'cure', name: 'Cure', desc: 'Ends illness and injury.', target: 'many', all: true },
    { action: 'feed', name: 'Feed', desc: 'Fills followers up and ends starving.', target: 'many', all: true },
    { action: 'rest', name: 'Rest', desc: 'Followers are fully rested.', target: 'many', all: true },
    { action: 'faithful', name: 'End dissent', desc: 'Dissenters come back to the faith.', target: 'many', all: true },
    { action: 'levelup', name: 'Ready to level up', desc: 'Fills devotion: bless them to level up.', target: 'many' },
    { action: 'bless', name: 'Bless', desc: 'Blesses followers, as you do in the cult.', target: 'many', all: true },
    { action: 'inspire', name: 'Inspire', desc: 'Inspires followers, as you do in the cult.', target: 'many', all: true },
    { action: 'happy', name: 'Full faith', desc: 'Followers’ faith goes to the top.', target: 'many', all: true },
    { action: 'necklace', name: 'Give necklace', desc: 'Puts a necklace on a follower.', target: 'one', param: 'necklace' },
    { action: 'addTrait', name: 'Add trait', desc: 'Gives a follower a trait.', target: 'one', param: 'trait' },
    { action: 'removeTrait', name: 'Remove trait', desc: 'Takes a trait away.', target: 'one', param: 'trait' },
    { action: 'rename', name: 'Rename', desc: 'Gives a follower a new name.', target: 'one', param: 'name' },
    { action: 'form', name: 'Change form', desc: 'Puts a follower in another form.', target: 'one', param: 'skin' },
  ],
  cult: [
    { action: 'recruit', name: 'New recruit', desc: 'A new follower waits at the temple.', param: 'recruitName' },
    { action: 'revive', name: 'Bring back the dead', desc: 'A dead follower waits at the temple to be welcomed again.', param: 'dead' },
    { action: 'remove', name: 'Remove building', desc: 'Demolishes a building, as the build menu does.', param: 'building', need: 'base', danger: true, icon: ['structures', 'SHRINE'] },
    { action: 'poop', name: 'Spawn poop', desc: 'Poop appears next to followers.', param: 'count', need: 'base' },
    { action: 'vomit', name: 'Spawn vomit', desc: 'Vomit appears next to followers.', param: 'count', need: 'base' },
    { action: 'clean', name: 'Clean up', desc: 'Removes all poop and vomit.', need: 'base' },
    { action: 'faith', name: 'Faith up', desc: 'The cult feels inspired.', fixed: { amount: 10 } },
    { action: 'faith', name: 'Faith down', desc: 'The cult loses heart.', fixed: { amount: -10 } },
    { action: 'grow', name: 'Grow crops', desc: 'Every planted farm plot is ready to harvest.', need: 'base', icon: ['structures', 'FARM_PLOT'] },
    { action: 'nextPhase', name: 'Next time of day', desc: 'Skips to the next part of the day.', need: 'base' },
    { action: 'weather', name: 'Weather', desc: 'Changes the weather here.', param: 'weather' },
  ],
  resources: [
    { action: 'give', name: 'Give gold', desc: 'Adds gold coins.', fixed: { item: 'BLACK_GOLD' }, param: 'amount', icon: ['items', 'BLACK_GOLD'] },
    { action: 'give', name: 'Give wood', desc: 'Adds logs.', fixed: { item: 'LOG' }, param: 'amount', icon: ['items', 'LOG'] },
    { action: 'give', name: 'Give stone', desc: 'Adds stone.', fixed: { item: 'STONE' }, param: 'amount', icon: ['items', 'STONE'] },
    { action: 'give', name: 'Give any item', desc: 'Any item from the game.', param: 'item' },
    { action: 'take', name: 'Take item', desc: 'Removes items you have.', param: 'ownedItem' },
  ],
  lamb: [
    { action: 'lambHeal', name: 'Heal the Lamb', desc: 'Restores a heart.' },
    { action: 'lambHurt', name: 'Hurt the Lamb', desc: 'Takes half a heart, never the last one.' },
    { action: 'tarot', name: 'Draw tarot card', desc: 'Draws a tarot card for this crusade.', need: 'dungeon' },
  ],
};
const TABS = { followers: 'Followers', cult: 'Cult', resources: 'Resources', lamb: 'Lamb' };

function renderTabs() {
  $('tabs').replaceChildren(...Object.entries(TABS).map(([k, label]) => h('button', {
    class: 'tab', role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; buildActions(); renderTabs(); },
  }, label, ' ', h('span', {}, String(ACTIONS[k].length)))));
  const offline = ACTIONS[tab].some(a => !usable(a));
  $('tab-hint').hidden = !offline;
  $('tab-hint').textContent = !status?.loaded ? 'Load a save in the game first.'
    : tab === 'lamb' ? 'Tarot cards can only be drawn while the Lamb is on a crusade.'
    : 'Some of these only work while you are in the cult.';
  for (const b of document.querySelectorAll('.act [data-need]')) b.disabled = !usable({ need: b.dataset.need });
}

const usable = a => status?.loaded && (a.need === 'base' ? status.inBase : a.need === 'dungeon' ? status.inDungeon : true);

// Selects whose options follow the game: re-filled after each status, keeping the choice.
function liveSelect(fill) {
  const sel = h('select', {});
  const update = () => { const keep = sel.value; sel.replaceChildren(...fill()); if ([...sel.options].some(o => o.value === keep)) sel.value = keep; };
  refreshers.push(() => sel.isConnected && update());
  update();
  return sel;
}

const followerOptions = () => (status?.followers || []).filter(f => !f.away)
  .slice().sort((a, b) => a.name.localeCompare(b.name)).map(f => new Option(f.name, `id:${f.id}`));

function buildActions() {
  refreshers.length = 0;
  $('actions').replaceChildren(...ACTIONS[tab].map(actionCard));
  renderTabs();
}

function actionCard(a) {
  const inputs = [];
  let target = null;
  if (a.target === 'many') {
    target = liveSelect(() => [
      ...(a.all ? [new Option('Everyone', 'all')] : []),
      new Option('1 at random', 'n:1'), new Option('3 at random', 'n:3'),
      ...(a.all ? [] : [new Option('Everyone', 'all')]), ...followerOptions(),
    ]);
  } else if (a.target === 'one') target = liveSelect(() => [new Option('Choose a follower', ''), ...followerOptions()]);
  if (target) { target.setAttribute('aria-label', `${a.name}: who`); inputs.push(target); }

  const param = paramInput(a);
  if (param) inputs.push(param.el);

  const run = h('button', { class: a.danger ? 'btn danger' : 'btn primary', 'data-need': a.need || 'loaded' }, 'Run');
  run.onclick = async () => {
    const body = { action: a.action, ...a.fixed };
    if (target) {
      const v = target.value;
      if (!v) return addLog(`${a.name}: choose a follower first`, true);
      if (v.startsWith('n:')) body.count = +v.slice(2);
      else if (v.startsWith('id:')) a.target === 'one' ? body.id = +v.slice(3) : body.ids = [+v.slice(3)];
    }
    if (param) Object.assign(body, param.value());
    const who = target?.selectedOptions[0]?.text;
    if (a.danger && !confirm(a.action === 'kill' ? `Kill ${who}? This can't be undone.` : 'Remove this building? You get nothing back.')) return;
    await act(body, a.name, run);
  };
  const icon = a.icon ? iconOf(...a.icon) : null;
  return h('article', { class: 'act' },
    h('header', {}, icon && h('img', { src: icon, alt: '' }), h('h3', {}, a.name)),
    h('p', {}, a.desc),
    h('div', { class: 'row' }, ...inputs, run));
}

function paramInput(a) {
  const label = el => (el.setAttribute('aria-label', `${a.name}: ${el.dataset.what}`), el);
  const num = (value, max) => label(h('input', { type: 'number', min: 1, max, value, 'data-what': 'how many' }));
  switch (a.param) {
    case 'count': { const el = num(3, 20); return { el, value: () => ({ count: +el.value || 1 }) }; }
    case 'amount': { const el = num(10, 999); return { el, value: () => ({ amount: +el.value || 1 }) }; }
    case 'name': { const el = label(h('input', { maxLength: 24, placeholder: 'New name', 'data-what': 'name' })); return { el, value: () => ({ name: el.value }) }; }
    case 'recruitName': { const el = label(h('input', { maxLength: 24, placeholder: 'Name (or random)', 'data-what': 'name' })); return { el, value: () => (el.value.trim() ? { name: el.value } : {}) }; }
    case 'trait': {
      const el = label(h('select', { 'data-what': 'trait' }, ...sorted('traits').map(t => new Option(t.name, t.id))));
      return { el, value: () => ({ trait: el.value }) };
    }
    case 'skin': {
      const el = label(h('select', { 'data-what': 'form' }, new Option('Random form', ''), ...sorted('skins').filter(s => !s.id.startsWith('Boss_')).map(s => new Option(s.name, s.id))));
      return { el, value: () => (el.value ? { skin: el.value } : {}) };
    }
    case 'weather': {
      const el = label(h('select', { 'data-what': 'weather' }, ...Object.entries(WEATHER).map(([k, v]) => new Option(v[0].toUpperCase() + v.slice(1), k))));
      return { el, value: () => ({ weather: el.value }) };
    }
    case 'necklace': {
      const el = label(h('select', { 'data-what': 'necklace' }, ...necklaces()));
      return { el, value: () => ({ item: el.value }) };
    }
    case 'dead': {
      const el = label(liveSelect(() => (status?.dead || []).slice().reverse().map(d => new Option(d.name, d.id))));
      el.dataset.what = 'who';
      return { el, value: () => (el.value ? { id: +el.value } : {}) };
    }
    case 'building': {
      const el = label(liveSelect(() => [new Option('Random kind', ''), ...(status?.buildings || [])
        .slice().sort((x, y) => x.name.localeCompare(y.name) || x.id - y.id).map(b => new Option(`${b.name} #${b.id}`, b.id))]));
      el.dataset.what = 'building';
      return { el, value: () => (el.value ? { id: +el.value } : {}) };
    }
    case 'item': {
      const item = label(h('select', { 'data-what': 'item' }, ...sorted('items').map(i => new Option(i.name, i.id))));
      const n = num(10, 999);
      return { el: h('span', { class: 'row', style: 'flex: 1 1 100%' }, item, n), value: () => ({ item: item.value, amount: +n.value || 1 }) };
    }
    case 'ownedItem': {
      const item = liveSelect(() => (status?.chest || []).map(c => new Option(`${nameOf('items', c.item)} (${c.count})`, c.item))
        .sort((x, y) => x.text.localeCompare(y.text)));
      item.setAttribute('aria-label', `${a.name}: item`);
      const n = num(10, 999);
      return { el: h('span', { class: 'row', style: 'flex: 1 1 100%' }, item, n), value: () => ({ item: item.value, amount: +n.value || 1 }) };
    }
  }
  return null;
}

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

// --- one follower ---

let shownFollower = null;

function renderFollower(f) {
  if (shownFollower !== f.id) {  // fill the forms once per follower, so polling doesn't wipe what's typed
    shownFollower = f.id;
    $('one-rename-in').value = f.name;
    $('one-form-in').replaceChildren(new Option('Random form', ''), ...sorted('skins').filter(s => !s.id.startsWith('Boss_')).map(s => new Option(s.name, s.id)));
    $('one-form-in').value = entry('skins', f.skin)?.id || '';
    $('one-trait-in').replaceChildren(...sorted('traits').map(t => new Option(t.name, t.id)));
    const button = (label, body, note, danger) => h('button', { class: danger ? 'btn danger' : 'btn', onclick: async e => {
      if (danger && !confirm(`Kill ${status.followers.find(x => x.id === f.id)?.name}? This can't be undone.`)) return;
      await act({ ...body, ...(body.action === 'kill' ? { id: f.id } : { ids: [f.id] }) }, label, e.currentTarget);
    } }, h('span', {}, label), note && h('span', { class: 'muted small' }, note));
    $('one-trouble').replaceChildren(
      button('Make ill', { action: 'ill' }), button('Injure', { action: 'injure' }), button('Exhaust', { action: 'exhaust' }),
      button('Starve', { action: 'starve' }), button('Turn dissenter', { action: 'dissent' }), button('Make old', { action: 'old' }),
      button('Kill', { action: 'kill' }, 'asks first', true));
    $('one-care').replaceChildren(
      button('Cure', { action: 'cure' }, 'ends illness and injury'), button('Feed', { action: 'feed' }), button('Let them rest', { action: 'rest' }),
      button('Bring back to faith', { action: 'faithful' }, 'ends dissent'), button('Ready to level up', { action: 'levelup' }),
      button('Bless', { action: 'bless' }), button('Inspire', { action: 'inspire' }), button('Full faith', { action: 'happy' }));
    $('one-necklace-in').replaceChildren(...necklaces());
  }
  $('one-face').src = iconOf('skins', f.skin) || '';
  $('one-face').alt = `${nameOf('skins', f.skin)} form`;
  $('one-name').textContent = f.name;
  $('one-about').textContent = [`Level ${f.level}`, `${nameOf('skins', f.skin)} form`, `age ${f.age}`, f.away && 'away on a mission'].filter(Boolean).join(' · ');
  $('one-traits').replaceChildren(
    ...(STATES[f.state] ? [h('span', { class: 'chip state' }, STATES[f.state])] : []),
    ...f.traits.map(t => h('button', {
      class: 'chip', title: 'Take this trait away',
      onclick: e => confirm(`Take “${nameOf('traits', t)}” away from ${f.name}?`) && act({ action: 'removeTrait', id: f.id, trait: t }, 'Remove trait', e.currentTarget),
    }, iconOf('traits', t) && h('img', { src: iconOf('traits', t), alt: '' }), nameOf('traits', t))));
  const meter = (label, value, color) => value == null ? null : h('div', { class: 'meter' },
    h('div', {}, h('span', {}, label), h('span', {}, `${value}%`)),
    h('div', { class: 'track' }, h('div', { style: `width: ${Math.max(0, Math.min(value, 100))}%; background: ${color}` })));
  $('one-bars').replaceChildren(...[meter('Faith', f.faith, '#D8B25A'), meter('Hunger', f.hunger, '#E7B98A'),
    meter('Rest', f.rest, '#9DC7B5'), meter('Illness', f.illness, '#EE6A5E')].filter(Boolean));
}

function onForm(id, body) {
  $(id).addEventListener('submit', e => { e.preventDefault(); act({ id: shownFollower, ...body() }, e.submitter?.textContent || 'Change', e.submitter); });
}
onForm('one-rename', () => ({ action: 'rename', name: $('one-rename-in').value }));
onForm('one-form', () => ({ action: 'form', ...($('one-form-in').value ? { skin: $('one-form-in').value } : {}) }));
onForm('one-trait', () => ({ action: 'addTrait', trait: $('one-trait-in').value }));
onForm('one-necklace', () => ({ action: 'necklace', item: $('one-necklace-in').value }));

const necklaces = () => sorted('items').filter(i => i.id.startsWith('Necklace_')).map(i => new Option(i.name, i.id));

// --- inventory ---

let itemInfo = null;  // the API's full item list, for categories, loaded the first time the page opens

async function renderItems(opening) {
  if (opening) {
    $('items-add-item').replaceChildren(...sorted('items').map(i => new Option(i.name, i.id)));
    if (!itemInfo) {
      try { itemInfo = Object.fromEntries((await fetch(API + 'items.json').then(r => r.json())).map(i => [i.id, i])); } catch { itemInfo = {}; }
    }
  }
  const q = $('items-filter').value.trim().toLowerCase();
  const chest = (status.chest || []).filter(c => !q || nameOf('items', c.item).toLowerCase().includes(q) || c.item.toLowerCase().includes(q));
  const groups = {};
  for (const c of chest) (groups[itemInfo?.[c.item]?.category || 'OTHER'] ??= []).push(c);
  const focused = document.activeElement?.dataset.item;  // don't rebuild the row being typed in
  if (focused && document.activeElement.closest('#items-groups')) return;
  $('items-groups').replaceChildren(...(chest.length ? Object.keys(groups).sort().map(g => h('section', { class: 'card' },
    h('h2', {}, g === 'NONE' || g === 'OTHER' ? 'Other' : g[0] + g.slice(1).toLowerCase().replace(/_/g, ' ')),
    h('div', { class: 'item-grid', style: 'margin-top: 12px' }, ...groups[g].sort((a, b) => nameOf('items', a.item).localeCompare(nameOf('items', b.item))).map(c => {
      const n = h('input', { type: 'number', min: 0, max: 9999, value: c.count, 'data-item': c.item, 'aria-label': `${nameOf('items', c.item)}: how many` });
      const set = v => act({ action: 'set', item: c.item, amount: Math.max(0, v) }, nameOf('items', c.item));
      n.addEventListener('change', () => set(+n.value || 0));
      return h('div', { class: 'item' },
        iconOf('items', c.item) && h('img', { src: iconOf('items', c.item), alt: '', loading: 'lazy' }),
        h('span', { class: 'name', title: c.item }, nameOf('items', c.item)),
        h('button', { class: 'btn', 'aria-label': `One less ${nameOf('items', c.item)}`, onclick: () => set(c.count - 1) }, '−'),
        n,
        h('button', { class: 'btn', 'aria-label': `One more ${nameOf('items', c.item)}`, onclick: () => set(c.count + 1) }, '+'));
    })))) : [h('p', { class: 'muted' }, q ? 'Nothing matches.' : 'The chest is empty.')]));
}
$('items-filter').addEventListener('input', () => status && renderItems(false));
$('items-add').addEventListener('submit', e => { e.preventDefault(); act({ action: 'give', item: $('items-add-item').value, amount: +$('items-add-n').value || 1 }, 'Add', e.submitter); });

// --- crusade ---

const LANDS = { Dungeon1: 'Darkwood', Dungeon2: 'Anura', Dungeon3: 'Anchordeep', Dungeon4: 'Silk Cradle', Dungeon5: 'Woolhaven', Dungeon6: 'Ewefall' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function renderRun(opening) {
  const r = status.run;
  $('run-away').hidden = !!r; $('run-body').hidden = !r;
  $('run-title').textContent = r ? LANDS[r.land.split('_')[0]] || r.land : 'Not on a crusade';
  $('run-where').textContent = r ? `Floor ${r.floor} · layer ${r.layer}${r.invincible ? ' · can’t be hurt right now' : ''}` : '';
  if (opening) {
    const fill = (id, kind, filter = () => true) => $(id).replaceChildren(...sorted(kind).filter(filter).map(x => new Option(x.name, x.id)));
    fill('run-weapon-in', 'weapons'); fill('run-curse-in', 'curses'); fill('run-relic-in', 'relics'); fill('run-card-in', 'tarot');
    for (const id of ['run-weapon-lvl', 'run-curse-lvl']) $(id).replaceChildren(...ROMAN.map((n, i) => new Option(`Level ${n}`, i)));
  }
  if (!r) return;
  const heart = (n, ch, color, label) => Array.from({ length: Math.ceil(n / 2) }, (_, i) => h('span', { style: `color: ${color}`, title: label }, n - i * 2 === 1 ? '♡' : ch));
  $('run-hearts').replaceChildren(...heart(r.hearts.red, '♥', '#EE6A5E', 'red'), ...heart(r.hearts.blue, '♥', '#6FB7E8', 'blue'),
    ...heart(r.hearts.black, '♥', '#8F826F', 'black'), ...heart(r.hearts.spirit, '♥', '#C9A3D6', 'spirit'));
  const gear = (label, kind, id, level) => stat(label, id && id !== 'None' ? `${nameOf(kind, id)}${level != null ? ` ${ROMAN[level] || level}` : ''}` : 'none', iconOf(kind, id));
  $('run-gear').replaceChildren(gear('Weapon', 'weapons', r.weapon, r.weaponLevel), gear('Curse', 'curses', r.curse, r.curseLevel), gear('Relic', 'relics', r.relic));
  $('run-tarot').replaceChildren(...(r.tarot.length ? r.tarot.map(t => h('span', { class: 'chip', style: 'cursor: default' },
    iconOf('tarot', t) && h('img', { src: iconOf('tarot', t), alt: '' }), nameOf('tarot', t))) : [h('span', { class: 'muted small' }, 'No cards yet.')]));
  $('run-enemies').replaceChildren(...(r.enemies.length ? r.enemies.map(e => h('li', {}, h('span', { style: 'flex: 1' }, e.name), h('span', { class: 'muted' }, `${e.hp} / ${e.max}`)))
    : [h('li', { class: 'muted' }, 'No enemies in this room.')]));
}
for (const b of document.querySelectorAll('[data-run]')) b.addEventListener('click', () => act(JSON.parse(b.dataset.run), b.textContent, b));
const runForm = (id, body) => $(id).addEventListener('submit', e => { e.preventDefault(); act(body(), e.submitter?.textContent || 'Equip', e.submitter); });
runForm('run-weapon', () => ({ action: 'weapon', weapon: $('run-weapon-in').value, level: +$('run-weapon-lvl').value }));
runForm('run-curse', () => ({ action: 'curse', curse: $('run-curse-in').value, level: +$('run-curse-lvl').value }));
runForm('run-relic', () => ({ action: 'relic', relic: $('run-relic-in').value }));
runForm('run-card', () => ({ action: 'tarot', card: $('run-card-in').value }));

// --- the game's screen ---

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

$('filter').addEventListener('input', () => status && renderDash());
$('rescan').onclick = scan;
$('disconnect').onclick = () => { addLog('Disconnected'); showFind(); };

renderLog();
loadNames().then(() => { if (base) { buildActions(); route(); } });
showFind();
