# cotl-live

Control a running *Cult of the Lamb* from the browser. Open [live.cotl.info](https://live.cotl.info) on the computer the
game runs on:

- **Cult**: followers' state, trouble (illness, injury, dissent, death...) and care (cure, feed, bless, inspire, faith,
  necklaces, bringing the dead back), recruits, faith, weather, time of day.
- **Map**: the cult as the game draws it, with the Lamb and followers moving on it. Click a building to move, flip,
  upgrade or remove it, or empty ground to build there (paying or free, built by followers or at once) or to send the
  Lamb there. The backdrop and building renders come from [map.cotl.info](https://map.cotl.info).
- **Inventory**: every item in the chest, with exact amounts; add anything from the game.
- **Crusade**: hearts of every kind, weapon, curse, relic and tarot cards, a short invincibility, and the room's enemies.
- **Screen**: the game's own picture, refreshed every second.

- `mod/CotlLive.cs`: a BepInEx 5 plugin. It serves a small JSON API on the first free port of
  `http://127.0.0.1:47820`–`47824`, and runs every action on the game's main thread with the game's own code.
- `site/`: the page. It tries those ports, lists the games it finds and connects when you click. Game names and
  icons come from [api.cotl.info](https://api.cotl.info), in the browser's language when the game has it.

## Install

1. Install [BepInEx 5](https://thunderstore.io/c/cult-of-the-lamb/) for Cult of the Lamb.
2. Put `CotlLive.dll` from the [latest release](https://github.com/AuthFailed/cotl-live/releases/latest) in
   `BepInEx/plugins`.
3. Start the game and open [live.cotl.info](https://live.cotl.info). Chrome asks once whether the page may reach
   devices on your local network: allow it. Safari doesn't let a website reach `127.0.0.1`; use Chrome, Edge or Firefox.

Only pages from `AllowedOrigins` (in `BepInEx/config/chrsnv.cotl.live.cfg`, default `https://live.cotl.info`) and
`http://localhost` pages get answers, so other sites you visit can't control the game.

## API

`GET /status`: game version, scene, whether a save is loaded and where the Lamb is (`inBase`, `inDungeon`), cult name,
day, time of day, faith (0–100), weather, recruits waiting, followers (`id`, `name`, `skin`, `level`, `age`, `state`,
`traits`, `away`, `faith`, `hunger`, `rest`, `illness`, `levelReady`), the chest (`item`, `count`), buildings that can
be demolished (`id`, `type`, `name`) and the Lamb's hearts (`hp`, `max`, in half hearts).

`GET /map`: the base's structures (`id`, `type`, first cell `x`/`y`, footprint `w`/`h`, `flipped`, `building` for a
build site, `removable`, `movable`, `flippable`), the land upgrades bought, whether the Lamb is in the cult, and where the
Lamb and each follower stand in grid cells (a cell's centre is `x + 0.5`). Cells are the game's build grid, as
map.cotl.info and a save's `GridTilePosition` use them.

`GET /screen`: the game's current frame as a JPEG.

`/status` also lists the dead (`dead`), each follower's `necklace`, and during a crusade `run`: the land, layer and
floor, weapon and curse with levels, relic, tarot cards held, hearts by kind, whether the Lamb can be hurt, and the
room's enemies (`name`, `hp`, `max`).

`POST /act` with `{"action": "...", ...}` answers `{"message": "..."}`, or `{"error": "..."}` with status 409 when the
game can't do it right now. Ids are the game's own, as api.cotl.info uses them.

| Action | Takes | Does |
|---|---|---|
| `ill`, `injure`, `exhaust`, `starve`, `dissent`, `old` | `ids`, or `count` | makes followers ill, hurt, exhausted, starving, dissenters or elders |
| `cure`, `feed`, `rest`, `faithful`, `levelup` | `ids`, `count`, or nothing for everyone | ends illness and injury, fills hunger, fills rest, ends dissent, fills devotion |
| `kill` | `id` | the follower dies |
| `addTrait`, `removeTrait` | `id`, `trait` | gives or takes a trait |
| `rename` | `id`, `name` | renames a follower (1–24 characters) |
| `form` | `id`, `skin` (or none for random) | changes a follower's form |
| `recruit` | `name` (optional) | a new recruit waits at the temple |
| `remove` | `id` (or none for a random kind) | demolishes a building as the build menu does |
| `poop`, `vomit` | `count` (1–20) | leaves mess next to followers |
| `clean` | | removes all poop and vomit |
| `faith` | `amount` (−85 to 85) | raises or lowers cult faith |
| `grow` | | every planted farm plot is ready to harvest |
| `nextPhase` | | skips to the next time of day |
| `weather` | `weather`: `None`, `Raining`, `Windy`, `Snowing`, `Heat` | changes the weather |
| `give`, `take` | `item`, `amount` (1–999) | adds or removes items |
| `lambHeal`, `lambHurt` | | a heart back, or half a heart off (never the last one) |
| `bless`, `inspire`, `happy` | `ids`, `count`, or nothing for everyone | blesses or inspires as the Lamb does, or fills faith |
| `necklace` | `id`, `item` (a `Necklace_...`) | puts a necklace on |
| `revive` | `id` (or none for the latest) | a dead follower waits at the temple to be welcomed again |
| `set` | `item`, `amount` (0–9999) | sets an item to exactly that many |
| `build` | `type`, `x`, `y`, `flipped`, `free`, `instant` | builds on that cell as the build menu does: a build site followers finish, or at once with `instant`; pays the cost unless `free` |
| `move` | `id`, `x`, `y` | moves a building |
| `flip` | `id` | mirrors a building (its footprint's sides swap) |
| `upgrade` | `id`, `free`, `instant` | replaces a building with its next level on the same spot |
| `goto` | `x`, `y` | sends the Lamb to a cell of the cult |
| `tarot` | `card` (or none for a random one) | gives a tarot card, on a crusade |
| `weapon`, `curse` | `weapon` / `curse`, `level` (0–4) | equips a weapon or curse |
| `relic` | `relic` | equips a relic |
| `hearts` | `kind` (`blue`, `black`, `spirit`), `amount` (half hearts) | adds hearts |
| `invincible` | `seconds` (1–120) | nothing hurts the Lamb for that long |
| `killEnemies`, `hurtEnemies`, `healEnemies` | | defeats, halves or heals every enemy in the room |

Follower actions skip followers on a mission, and those the game itself refuses (the cursed, zombies, followers busy
in a ritual); the answer names the ones that changed. Buildings, mess, crops and time only work in the cult.

## Build

```bash
mod/build.sh "<game>/Cult Of The Lamb_Data/Managed" "<game>/BepInEx/core"
```

To work on the page, serve `site/` on localhost (`python3 -m http.server -d site 8765`) and open `http://localhost:8765`.
