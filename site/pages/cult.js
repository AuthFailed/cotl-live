// The cult page: the cult's numbers, every action in tabs, and the followers.
'use strict';

let tab = 'followers';

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

function buildActions() {
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

$('filter').addEventListener('input', () => status && renderDash());

page({ id: 'dash', route: '#/', nav: 'Cult', render: renderDash, connected: buildActions });
