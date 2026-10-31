// One follower: their state, trouble and care, and who they are.
'use strict';

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

const followerFromHash = hash => { const m = hash.match(/^#\/f\/(\d+)$/); return m && status?.followers?.find(x => x.id === +m[1]); };
page({ id: 'one', match: hash => !!followerFromHash(hash), render: () => renderFollower(followerFromHash(location.hash)) });
