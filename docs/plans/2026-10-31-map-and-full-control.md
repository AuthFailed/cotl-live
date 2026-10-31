# Live map and full control

Goal: whoever has the page manages the whole game, not just mischief. They see where the Lamb is, see the base as the
game draws it and click buildings to change, build or remove them, look after the cult, manage the inventory, and steer
a crusade (weapon, curse, relic, tarot, hearts, enemies).

## 1. Live map, on live.cotl.info

map.cotl.info already draws the base from the game's camera with the game's own building renders, the build grid,
footprints, build rules and land upgrades, and reads a real base from a save. A save's base is
`{type, cell x, cell y, flipped}` plus the land bought: exactly what the plugin can report live. The map is a page
of live.cotl.info that **loads the planner's published data and renders from map.cotl.info** (GitHub Pages serves
them to any site) and ports only the planner's drawing code: background tiles, grid, buildings back to front.

- Plugin: `GET /map`: every base structure (`id`, `type`, first cell, flipped), land bought, the Lamb's and each
  follower's position in grid cells (fractions, from the world position through the placement grid). Polled every
  second or two.
- Page: the real base with the Lamb and followers moving on it; pan and zoom. Clicking a building opens its card
  (name, actions: remove, flip, upgrade, move). A build menu (the planner's tabs) places a building on a free spot,
  with a "free" switch; off means the game takes the usual cost. Actions: `build`, `move`, `flip`, `upgrade`
  (`PlacementRegion.Build`, `Upgrade`, the move code) next to `remove`.
- Off the base (a crusade, another island) the map says where the Lamb is instead.

## 2. Looking after the cult

Next to the existing actions, the good side: bless and inspire (devotion), make happy, give a gift or necklace, heal
everyone, bring dead followers back (`Followers_Dead`), new recruit in a chosen form, raise faith, gather souls, plus
the existing cure, feed, rest and end dissent. The follower page gains the same per follower.

## 3. Inventory

A full chest screen: every item with icon and name from api.cotl.info, grouped by the game's categories, searchable,
with +/− and "set to" per item and a give-any-item picker. Plugin: `set` action (exact quantity) next to give/take.

## 4. Crusade

A screen that appears while the Lamb is on a crusade: which land and floor, hearts by kind, weapon, curse, relic,
tarot cards held, fleece, and the enemies in the room. Actions: choose a weapon, curse and relic (from api.cotl.info's
lists), give a chosen tarot card, heal or add blue/black hearts, a short invincibility, and for enemies: kill all,
damage, heal them. Plugin reads `Health.team2` for the room's enemies, `PlayerWeapon.SetWeapon`,
`PlayerSpells.SetSpell`, `EquipRelic`, `TrinketManager.AddTrinket`.

## Order

1. Inventory and cult care (small, plugin + this site).
2. Map: plugin `/map` and building actions, then the planner's live mode.
3. Crusade: plugin + a crusade screen here.

Each step is tested on the game before it ships, with the saves backed up and restored as before.

## Risks

- Building from outside the build menu: `PlacementRegion.Build` and the move code are private and expect build mode's
  state; they may need that state set up, or `StructureManager.BuildStructure` with the grid bookkeeping done by hand.
- Crusade testing needs a run in progress; getting into one remotely may need a test helper that starts a crusade.
- The map depends on map.cotl.info's published files staying where they are; the planner's data format is its own.
