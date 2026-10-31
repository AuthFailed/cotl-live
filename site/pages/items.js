// The inventory: every item in the chest, with exact amounts.
'use strict';

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

page({ id: 'items', route: '#/items', nav: 'Inventory', render: renderItems });
