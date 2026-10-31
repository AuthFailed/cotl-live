# cotl-live

Control a running *Cult of the Lamb* from the browser: make followers ill, add recruits, demolish buildings, change
the weather, hand out resources and more. Open [live.cotl.info](https://live.cotl.info) on the computer the game runs on.

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
| `tarot` | | draws a tarot card, on a crusade |

Follower actions skip followers on a mission, and those the game itself refuses (the cursed, zombies, followers busy
in a ritual); the answer names the ones that changed. Buildings, mess, crops and time only work in the cult.

## Build

```bash
mod/build.sh "<game>/Cult Of The Lamb_Data/Managed" "<game>/BepInEx/core"
```

To work on the page, serve `site/` on localhost (`python3 -m http.server -d site 8765`) and open `http://localhost:8765`.
