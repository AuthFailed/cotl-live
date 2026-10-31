// The crusade page: hearts, gear, tarot and the room's enemies, while the Lamb is on a crusade.
'use strict';

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

page({ id: 'run', route: '#/run', nav: 'Crusade', render: renderRun });
