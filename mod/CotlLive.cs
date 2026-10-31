// CotlLive: lets a web page talk to the running game over http://127.0.0.1.
//
// Listens on the first free port of 47820-47824, so a page can find the game by trying each. Only pages from
// AllowedOrigins (and http://localhost, for development) get answers; the browser sends Origin and a page
// can't fake it. Requests are handled on a background thread, the game work runs in Update on the main thread.
//
//   GET  /status   game, cult, followers, chest, buildings that can be demolished, the Lamb's hearts
//   GET  /map      the base's structures on the build grid, and where the Lamb and followers stand on it
//   GET  /screen   the game's current frame, as a JPEG
//   POST /act      {"action": "...", ...}: see Act; answers {"message": "..."} or {"error": "..."}
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using BepInEx;
using BepInEx.Configuration;
using HarmonyLib;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

[BepInPlugin("chrsnv.cotl.live", "COTL Live", Version)]
public class CotlLive : BaseUnityPlugin
{
    const string Version = "0.3.0";
    const int FirstPort = 47820, Ports = 5;
    ConfigEntry<string> allowed;
    HttpListener listener;
    readonly ConcurrentQueue<Job> jobs = new ConcurrentQueue<Job>();
    static readonly System.Random rng = new System.Random();

    class Job
    {
        public string Path; public JObject Body; public object Result; public int Status = 200;
        public readonly ManualResetEventSlim Done = new ManualResetEventSlim();
    }

    class Refused : Exception { public Refused(string m) : base(m) { } }

    void Awake()
    {
        allowed = Config.Bind("General", "AllowedOrigins", "https://live.cotl.info",
            "Comma-separated origins of pages allowed to control the game. http://localhost and http://127.0.0.1 pages always are.");
        for (int port = FirstPort; port < FirstPort + Ports && listener == null; port++)
        {
            var l = new HttpListener();
            l.Prefixes.Add($"http://127.0.0.1:{port}/");
            try { l.Start(); listener = l; Logger.LogInfo($"listening on http://127.0.0.1:{port}/"); }
            catch (Exception e) { Logger.LogInfo($"port {port} busy: {e.Message}"); l.Close(); }
        }
        if (listener == null) { Logger.LogError("no free port; live control is off"); return; }
        new Harmony("chrsnv.cotl.live").PatchAll(typeof(CotlLive));
        new Thread(Serve) { IsBackground = true, Name = "CotlLive" }.Start();
    }

    void OnDestroy() => listener?.Close();

    bool Allowed(string origin) =>
        origin == null  // not a browser page (curl, a local tool): it could reach the game anyway
        || origin.StartsWith("http://localhost:") || origin == "http://localhost"
        || origin.StartsWith("http://127.0.0.1:") || origin == "http://127.0.0.1"
        || allowed.Value.Split(',').Select(s => s.Trim().TrimEnd('/')).Contains(origin);

    void Serve()
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { return; }
            try { Handle(ctx); }
            catch (Exception e) { Logger.LogWarning($"request failed: {e.Message}"); }
            finally { try { ctx.Response.Close(); } catch { } }
        }
    }

    void Handle(HttpListenerContext ctx)
    {
        var req = ctx.Request; var res = ctx.Response;
        string origin = req.Headers["Origin"];
        if (!Allowed(origin)) { Reply(res, 403, new { error = "this page is not in AllowedOrigins" }); return; }
        if (origin != null)
        {
            res.AddHeader("Access-Control-Allow-Origin", origin);
            res.AddHeader("Vary", "Origin");
        }
        if (req.HttpMethod == "OPTIONS")
        {
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");  // Chrome's check for public page -> localhost
            res.StatusCode = 204;
            return;
        }
        string path = req.Url.AbsolutePath;
        bool get = path == "/status" || path == "/map" || path == "/screen";
        if (get != (req.HttpMethod == "GET")) { Reply(res, 405, new { error = "GET /status, /map or /screen, POST /act" }); return; }
        JObject body = null;
        if (req.HttpMethod == "POST")
        {
            string text = new StreamReader(req.InputStream, Encoding.UTF8).ReadToEnd();
            try { body = text.Length == 0 ? new JObject() : JObject.Parse(text); }
            catch { Reply(res, 400, new { error = "body is not a JSON object" }); return; }
        }
        var job = new Job { Path = path, Body = body };
        jobs.Enqueue(job);
        // The game may be loading or paused; Update still runs, so 5 s only passes if something is badly stuck.
        if (!job.Done.Wait(5000)) { Reply(res, 503, new { error = "the game did not answer in time" }); return; }
        Reply(res, job.Status, job.Result);
    }

    static void Reply(HttpListenerResponse res, int status, object value)
    {
        byte[] bytes = value as byte[] ?? Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(value));
        res.StatusCode = status;
        res.ContentType = value is byte[] ? "image/jpeg" : "application/json; charset=utf-8";
        if (value is byte[]) res.AddHeader("Cache-Control", "no-store");
        res.ContentLength64 = bytes.Length;
        res.OutputStream.Write(bytes, 0, bytes.Length);
    }

    void Update()
    {
        while (jobs.TryDequeue(out var job))
        {
            if (job.Path == "/screen") { StartCoroutine(Screen(job)); continue; }
            try { job.Result = job.Path == "/status" ? Status() : job.Path == "/map" ? Map() : job.Path == "/act" ? Act(job.Body) : throw new Refused($"no such path: {job.Path}"); }
            catch (Refused e) { job.Status = 409; job.Result = new { error = e.Message }; }
            catch (Exception e) { job.Status = 500; job.Result = new { error = e.Message }; Logger.LogError(e); }
            job.Done.Set();
        }
    }

    // A frame can only be read once it's drawn.
    IEnumerator Screen(Job job)
    {
        yield return new WaitForEndOfFrame();
        Texture2D shot = null;
        try
        {
            shot = ScreenCapture.CaptureScreenshotAsTexture();
            job.Result = ImageConversion.EncodeToJPG(shot, 75);
        }
        catch (Exception e) { job.Status = 500; job.Result = new { error = e.Message }; }
        finally { if (shot) Destroy(shot); job.Done.Set(); }
    }

    static bool InBase => SaveAndLoad.Loaded && PlacementRegion.Instance != null;
    static bool InDungeon => SaveAndLoad.Loaded && PlayerFarming.Instance != null && GameManager.IsDungeon(PlayerFarming.Location);
    static string State(FollowerInfo f) => f.CursedState == Thought.None ? (f.OldAge ? "OldAge" : "None") : f.CursedState.ToString();

    // Lists, not lazy queries: the reply is serialized on the listener thread, while the game changes these.
    object Status()
    {
        var d = SaveAndLoad.Loaded ? DataManager.Instance : null;
        var hp = InDungeon || InBase ? PlayerFarming.Instance?.health : null;
        return new
        {
            app = "cotl-live",
            mod = Version,
            game = Application.version,
            scene = SceneManager.GetActiveScene().name,
            loaded = d != null,
            inBase = InBase,
            inDungeon = InDungeon,
            cult = d?.CultName,
            day = d != null ? TimeManager.CurrentDay : (int?)null,
            phase = d != null ? TimeManager.CurrentPhase.ToString() : null,
            faith = d != null ? Mathf.RoundToInt(Mathf.Clamp01(CultFaithManager.CultFaithNormalised) * 100f) : (int?)null,
            weather = WeatherSystemController.Instance != null ? WeatherSystemController.Instance.CurrentWeatherType.ToString() : null,
            recruits = d?.Followers_Recruit.Count,
            dead = d?.Followers_Dead.Select(f => new { id = f.ID, name = f.Name, skin = f.SkinName }).ToList(),
            followers = d?.Followers.Select(f =>
            {
                var s = FollowerBrain.FindBrainByID(f.ID)?.Stats;
                return new
                {
                    id = f.ID, name = f.Name, skin = f.SkinName, level = f.XPLevel, age = f.Age, state = State(f),
                    traits = f.Traits.Select(t => t.ToString()).ToList(),
                    away = d.Followers_OnMissionary_IDs.Contains(f.ID),
                    faith = Mathf.RoundToInt(f.Faith), hunger = s != null ? Mathf.RoundToInt(s.Satiation) : (int?)null,
                    rest = s != null ? Mathf.RoundToInt(s.Rest) : (int?)null, illness = s != null ? Mathf.RoundToInt(s.Illness) : (int?)null,
                    levelReady = s != null && s.Adoration >= s.MAX_ADORATION, necklace = f.Necklace.ToString(),
                };
            }).ToList(),
            chest = d != null ? Inventory.items.Where(i => i.quantity > 0).Select(i => new { item = ((InventoryItem.ITEM_TYPE)i.type).ToString(), count = i.quantity }).ToList() : null,
            buildings = InBase ? Demolishable().Select(s => new
            {
                id = s.Brain.Data.ID, type = s.Brain.Data.Type.ToString(), name = StructuresData.LocalizedName(s.Brain.Data.Type),
            }).ToList() : null,
            lamb = hp != null ? new { hp = hp.HP, max = hp.totalHP } : null,
            run = InDungeon ? Run() : null,
        };
    }

    // One action per call. Follower actions take "ids" (those followers) or "count" (that many at random among the
    // ones it can apply to); actions on one follower take "id".
    object Act(JObject b)
    {
        if (!SaveAndLoad.Loaded) throw new Refused("no save is loaded");
        string action = b.Value<string>("action") ?? throw new Refused("no action");
        switch (action)
        {
            case "ill": return Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeSick(forced: true), f => f.Info.CursedState == Thought.Ill, "fell ill");
            case "injure": return Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeInjured(force: true), f => f.Info.CursedState == Thought.Injured, "got hurt");
            case "exhaust": return Each(b, f => f.Stats.Exhaustion <= 0f, f => f.MakeExhausted(), f => f.Stats.Exhaustion > 0f, "became exhausted");
            case "starve": return Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeStarve(), f => f.Info.CursedState == Thought.BecomeStarving, "started starving");
            case "dissent": return Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeDissenter(), f => f.Info.CursedState == Thought.Dissenter, "started to dissent");
            case "old": return Each(b, f => f.Info.CursedState == Thought.None && !f._directInfoAccess.OldAge, f => f.MakeOld(), f => f._directInfoAccess.OldAge, "grew old");
            case "cure": return Each(b, f => f.Info.CursedState == Thought.Ill || f.Info.CursedState == Thought.Injured, Cure, f => f.Info.CursedState == Thought.None, "got better");
            case "feed": return Each(b, f => f.Stats.Satiation < 100f || f.Info.CursedState == Thought.BecomeStarving, Feed, f => true, "ate their fill");
            case "rest": return Each(b, f => f.Stats.Rest < 100f || f.Stats.Exhaustion > 0f, f => { f.Stats.Exhaustion = 0f; f.Stats.Rest = 100f; }, f => true, "got some rest");
            case "faithful": return Each(b, f => f.Info.CursedState == Thought.Dissenter, f => { f.Stats.Reeducation = 0f; f.RemoveCurseState(Thought.Dissenter); }, f => f.Info.CursedState != Thought.Dissenter, "came back to the faith");
            case "levelup": return Each(b, f => f.Stats.Adoration < f.Stats.MAX_ADORATION, f => f.Stats.Adoration = f.Stats.MAX_ADORATION, f => true, "can level up now");
            case "bless": return Each(b, f => true, f => f.AddAdoration(FollowerBrain.AdorationActions.Bless, null), f => true, "got a blessing");
            case "inspire": return Each(b, f => true, f => f.AddAdoration(FollowerBrain.AdorationActions.Inspire, null), f => true, "got inspired");
            case "happy": return Each(b, f => f._directInfoAccess.Faith < 100f, f => f._directInfoAccess.Faith = 100f, f => true, "got their faith back");
            case "necklace":
            {
                var f = One(b); var item = Enum<InventoryItem.ITEM_TYPE>(b, "item");
                if (!item.ToString().StartsWith("Necklace_")) throw new Refused("that isn't a necklace");
                f._directInfoAccess.Necklace = item;
                FollowerManager.FindFollowerByID(f.Info.ID)?.SetOutfit(f.Info.Outfit, hooded: false);
                return Said($"{f.Info.Name} now wears {item}");
            }
            case "revive": return Revive(b.Value<int?>("id"));
            case "kill":
            {
                var f = One(b);
                f.Die(NotificationCentre.NotificationType.Died);
                return Said($"{f.Info.Name} died");
            }
            case "addTrait":
            {
                var f = One(b); var t = Enum<FollowerTrait.TraitType>(b, "trait");
                if (f.HasTrait(t)) throw new Refused($"{f.Info.Name} already has that trait");
                f.AddTrait(t, showNotification: true);
                return Said(f.HasTrait(t) ? $"{f.Info.Name} got the trait {t}" : throw new Refused($"the game didn't give {f.Info.Name} that trait"));
            }
            case "removeTrait":
            {
                var f = One(b); var t = Enum<FollowerTrait.TraitType>(b, "trait");
                if (!f.HasTrait(t)) throw new Refused($"{f.Info.Name} doesn't have that trait");
                f.RemoveTrait(t, showNotification: true);
                return Said($"{f.Info.Name} lost the trait {t}");
            }
            case "rename":
            {
                var f = One(b); string name = (b.Value<string>("name") ?? "").Trim();
                if (name.Length == 0 || name.Length > 24) throw new Refused("a name is 1 to 24 characters");
                string old = f.Info.Name;
                f._directInfoAccess.Name = name;
                return Said($"{old} is now called {name}");
            }
            case "form": return Form(One(b), b.Value<string>("skin"));
            case "recruit":
            {
                var f = FollowerManager.CreateNewRecruit(FollowerLocation.Base, "", NotificationCentre.NotificationType.NewRecruit);
                string name = (b.Value<string>("name") ?? "").Trim();
                if (name.Length > 0 && name.Length <= 24) f.Name = name;
                return Said($"new recruit {f.Name} is waiting at the temple");
            }
            case "remove": return Remove(b.Value<int?>("id"));
            case "build": return Build(b);
            case "move": return Move(b);
            case "flip": return Flip(b);
            case "upgrade": return Upgrade(b);
            case "goto":
            {
                if (!InBase || PlayerFarming.Instance == null) throw new Refused("the Lamb can only be sent around the cult");
                var tile = Region.GetTileGridTile(At(b)) ?? throw new Refused("that isn't part of the cult's ground");
                PlayerFarming.Instance.transform.position = tile.WorldPosition;
                return Said("the Lamb went there");
            }
            case "poop": return Spawn(StructureBrain.TYPES.POOP, Count(b, 20), "poop");
            case "vomit": return Spawn(StructureBrain.TYPES.VOMIT, Count(b, 20), "vomit");
            case "clean":
            {
                var mess = Structure.Structures.Where(s => s?.Brain?.Data != null && (s.Brain.Data.Type == StructureBrain.TYPES.VOMIT || s.Brain.Data.Type.ToString().StartsWith("POOP") && s.Brain.Data.Type != StructureBrain.TYPES.POOP_BUCKET)).ToList();
                foreach (var s in mess) s.Brain.Remove();
                return Said(mess.Count == 0 ? "the cult was already clean" : $"cleaned up {mess.Count} messes");
            }
            case "faith":
            {
                int n = Math.Max(-85, Math.Min(b.Value<int?>("amount") ?? 10, 85));
                CultFaithManager.GetFaith(n, n, true, n >= 0 ? NotificationBase.Flair.Positive : NotificationBase.Flair.Negative);
                return Said(n >= 0 ? "the cult feels inspired" : "the cult loses heart");
            }
            case "grow":
            {
                if (!InBase) throw new Refused("crops only grow while you are in the cult");
                var plots = StructureManager.GetAllStructuresOfType(StructureBrain.TYPES.FARM_PLOT).OfType<Structures_FarmerPlot>().Where(p => p.HasPlantedSeed() && !p.IsFullyGrown).ToList();
                foreach (var p in plots) { p.Data.GrowthStage = p.growthTime; p.OnGrowthStageChanged?.Invoke(); }
                return Said(plots.Count == 0 ? "no crops were growing" : $"{plots.Count} plots are ready to harvest");
            }
            case "nextPhase":
            {
                if (!InBase) throw new Refused("time can only be skipped in the cult");
                TimeManager.SkipTime(TimeManager.TimeRemainingInCurrentPhase());
                return Said("skipping to the next time of day");
            }
            case "weather":
            {
                if (WeatherSystemController.Instance == null) throw new Refused("there is no weather here");
                var w = Enum<WeatherSystemController.WeatherType>(b, "weather");
                WeatherSystemController.Instance.SetWeather(w, WeatherSystemController.WeatherStrength.Medium, 4f, true, allowNone: true);
                return Said(w == WeatherSystemController.WeatherType.None ? "the sky cleared" : $"the weather turned to {w}");
            }
            case "give":
            {
                var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int n = Count(b, 999, "amount");
                Inventory.AddItem(item, n);
                return Said($"added {n} {item}");
            }
            case "set":
            {
                var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int want = Math.Max(0, Math.Min(b.Value<int?>("amount") ?? 0, 9999));
                int have = Inventory.GetItemQuantity(item);
                if (want > have) Inventory.AddItem(item, want - have); else if (want < have) Inventory.ChangeItemQuantity(item, want - have);
                return Said($"{item} is now {want}");
            }
            case "take":
            {
                var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int have = Inventory.GetItemQuantity(item);
                int n = Math.Min(Count(b, 999, "amount"), have);
                if (n == 0) throw new Refused($"there is no {item} to take");
                Inventory.ChangeItemQuantity(item, -n);
                return Said($"took {n} {item}");
            }
            case "lambHeal":
            {
                var h = Lamb();
                if (h.HP >= h.totalHP) throw new Refused("the Lamb is already at full health");
                h.Heal(2f);
                return Said("the Lamb was healed");
            }
            case "lambHurt":
            {
                var h = Lamb();
                if (h.HP <= 1f) throw new Refused("the Lamb is on its last half heart");  // never the killing blow
                h.HP -= 1f;
                return Said("the Lamb lost half a heart");
            }
            case "tarot":
            {
                if (!InDungeon) throw new Refused("tarot cards are drawn on a crusade");
                var card = b["card"] != null ? new TarotCards.TarotCard(Enum<TarotCards.Card>(b, "card"), 0)
                    : TarotCards.DrawRandomCard(PlayerFarming.Instance) ?? throw new Refused("no tarot cards left to draw");
                TrinketManager.AddTrinket(card, PlayerFarming.Instance);
                return Said($"drew the tarot card {card.CardType}");
            }
            case "weapon":
            {
                var p = Crusader(); var w = Enum<EquipmentType>(b, "weapon");
                if (EquipmentManager.GetWeaponData(w) == null) throw new Refused("that isn't a weapon");
                p.playerWeapon.SetWeapon(w, Math.Max(0, b.Value<int?>("level") ?? p.currentWeaponLevel));
                return Said($"the Lamb now holds {w}");
            }
            case "curse":
            {
                var p = Crusader(); var c = Enum<EquipmentType>(b, "curse");
                if (EquipmentManager.GetCurseData(c) == null) throw new Refused("that isn't a curse");
                p.playerSpells.SetSpell(c, Math.Max(0, b.Value<int?>("level") ?? p.currentCurseLevel));
                return Said($"the Lamb now wields {c}");
            }
            case "relic":
            {
                var p = Crusader(); var r = Enum<RelicType>(b, "relic");
                var data = EquipmentManager.GetRelicData(r) ?? throw new Refused("unknown relic");
                p.playerRelic.EquipRelic(data);
                return Said($"the Lamb now carries {r}");
            }
            case "hearts":
            {
                var h = Crusader().health; int n = Math.Max(1, Math.Min(b.Value<int?>("amount") ?? 2, 20));
                string kind = b.Value<string>("kind") ?? "blue";
                if (kind == "black") h.BlackHearts += n; else if (kind == "spirit") h.SpiritHearts += n; else h.BlueHearts += n;
                return Said(n == 2 ? $"the Lamb got a {kind} heart" : $"the Lamb got {n / 2f} {kind} hearts");
            }
            case "invincible":
            {
                Crusader(); float secs = Math.Max(1, Math.Min(b.Value<float?>("seconds") ?? 15f, 120f));
                invincibleUntil = Time.time + secs;
                return Said($"the Lamb can't be hurt for {secs} seconds");
            }
            case "killEnemies": return OnEnemies(e => e.DealDamage(e.totalHP * 10f, PlayerFarming.Instance.gameObject, e.transform.position, false, Health.AttackTypes.Heavy, dealDamageImmediately: true), "defeated");
            case "hurtEnemies": return OnEnemies(e => e.DealDamage(Math.Max(1f, e.totalHP / 2f), PlayerFarming.Instance.gameObject, e.transform.position, false, Health.AttackTypes.Heavy), "lost half their health");
            case "healEnemies": return OnEnemies(e => e.HP = e.totalHP, "were healed");
            default: throw new Refused($"no such action: {action}");
        }
    }

    static object Said(string message) => new { message };

    // --- crusades ---

    static PlayerFarming Crusader() => InDungeon ? PlayerFarming.Instance : throw new Refused("the Lamb isn't on a crusade");

    static List<Health> Enemies() => Health.team2.Where(e => e != null && e.HP > 0f && e.gameObject.activeInHierarchy).ToList();

    static object OnEnemies(Action<Health> act, string verb)
    {
        Crusader();
        var list = Enemies();
        if (list.Count == 0) throw new Refused("no enemies in this room");
        foreach (var e in list) act(e);
        return Said($"{list.Count} enemies {verb}");
    }

    // The game resets Health.invincible on its own, so damage to the Lamb is refused here until the time is up.
    static float invincibleUntil;
    [HarmonyPrefix, HarmonyPatch(typeof(HealthPlayer), nameof(HealthPlayer.DealDamage))]
    static bool NoDamage(ref bool __result) { if (Time.time >= invincibleUntil) return true; __result = false; return false; }

    static object Run()
    {
        var p = PlayerFarming.Instance; var h = p.health;
        return new
        {
            land = PlayerFarming.Location.ToString(), layer = GameManager.CurrentDungeonLayer, floor = GameManager.CurrentDungeonFloor,
            weapon = p.currentWeapon.ToString(), weaponLevel = p.currentWeaponLevel, curse = p.currentCurse.ToString(), curseLevel = p.currentCurseLevel,
            relic = p.playerRelic?.CurrentRelic?.RelicType.ToString(),
            tarot = p.RunTrinkets.Select(t => t.CardType.ToString()).ToList(),
            hearts = new { red = h.HP, max = h.totalHP, blue = h.BlueHearts, black = h.BlackHearts, spirit = h.SpiritHearts },
            invincible = Time.time < invincibleUntil,
            enemies = Enemies().Select(e => new { name = System.Text.RegularExpressions.Regex.Replace(e.gameObject.name, @"\s*\(Clone\)|\s*\(\d+\)", ""), hp = Math.Round(e.HP, 1), max = Math.Round(e.totalHP, 1) }).ToList(),
        };
    }

    // Back from the dead the way recruits arrive: waiting at the temple to be welcomed again. The resurrection
    // ritual does the same bookkeeping (dead lists, graves, crypts, morgues) before its own scene.
    static object Revive(int? id)
    {
        var d = DataManager.Instance;
        var f = (id == null ? d.Followers_Dead.LastOrDefault() : d.Followers_Dead.FirstOrDefault(x => x.ID == id)) ?? throw new Refused(id == null ? "nobody has died" : "no dead follower with that id");
        d.Followers_Dead.Remove(f);
        d.Followers_Dead_IDs.Remove(f.ID);
        d.Followers_Imprisoned_IDs.Remove(f.ID);
        foreach (var g in StructureManager.GetAllStructuresOfType<Structures_Grave>(FollowerLocation.Base)) if (g.Data.FollowerID == f.ID) g.Data.FollowerID = -1;
        foreach (var c in StructureManager.GetAllStructuresOfType<Structures_Crypt>(FollowerLocation.Base)) if (c.Data.MultipleFollowerIDs.Contains(f.ID)) c.WithdrawBody(f.ID);
        foreach (var m in StructureManager.GetAllStructuresOfType<Structures_Morgue>(FollowerLocation.Base)) if (m.Data.MultipleFollowerIDs.Contains(f.ID)) m.WithdrawBody(f.ID);
        f.CursedState = Thought.None;
        if (f.Age > f.LifeExpectancy) f.LifeExpectancy = f.Age + rng.Next(20, 30);
        d.Followers_Recruit.Add(f);
        return Said($"{f.Name} is back, waiting at the temple");
    }

    static int Count(JObject b, int max, string key = "count") => Math.Max(1, Math.Min(b.Value<int?>(key) ?? 1, max));

    static T Enum<T>(JObject b, string key) where T : struct
    {
        string v = b.Value<string>(key);
        if (v == null || !System.Enum.TryParse(v, true, out T t) || !System.Enum.IsDefined(typeof(T), t)) throw new Refused($"unknown {key}: {v}");
        return t;
    }

    // Followers living in the cult (not recruits, dead or on a mission) whose brain is loaded.
    static List<FollowerBrain> Present()
    {
        var d = DataManager.Instance;
        return d.Followers.Where(f => !d.Followers_OnMissionary_IDs.Contains(f.ID)).Select(f => FollowerBrain.FindBrainByID(f.ID)).Where(x => x != null).ToList();
    }

    static FollowerBrain One(JObject b)
    {
        int id = b.Value<int?>("id") ?? throw new Refused("choose a follower");
        return Present().FirstOrDefault(f => f.Info.ID == id) ?? throw new Refused("that follower isn't in the cult");
    }

    // The game's own Make* methods refuse some followers (cursed, zombies, busy in a ritual) on their own, so count
    // the ones that actually changed.
    static object Each(JObject b, Func<FollowerBrain, bool> can, Action<FollowerBrain> act, Func<FollowerBrain, bool> took, string verb)
    {
        var ids = b["ids"]?.ToObject<List<int>>();
        var pool = Present().Where(can);
        var chosen = ids != null ? pool.Where(f => ids.Contains(f.Info.ID)).ToList()
            : b["count"] == null ? pool.ToList() : pool.OrderBy(_ => rng.Next()).ToList();
        int want = ids != null || b["count"] == null ? chosen.Count : Count(b, 50);
        var done = new List<string>();
        foreach (var f in chosen)
        {
            if (done.Count == want) break;
            act(f);
            if (took(f)) done.Add(f.Info.Name);
        }
        if (done.Count == 0) throw new Refused("no follower it can apply to right now");
        return Said((done.Count <= 3 ? string.Join(", ", done) : $"{done.Count} followers") + " " + verb);
    }

    static void Cure(FollowerBrain f)
    {
        if (f.Info.CursedState == Thought.Ill) { f.Stats.Illness = 0f; f.RemoveCurseState(Thought.Ill); FollowerBrainStats.OnIllnessStateChanged?.Invoke(f.Info.ID, FollowerStatState.Off, FollowerStatState.On); }
        if (f.Info.CursedState == Thought.Injured) { f.Stats.Injured = 0f; f.RemoveCurseState(Thought.Injured); }
    }

    static void Feed(FollowerBrain f)
    {
        if (f.Info.CursedState == Thought.BecomeStarving) f.RemoveCurseState(Thought.BecomeStarving);
        f.Stats.Starvation = 0f;
        f.Stats.Satiation = 100f;
    }

    // As Follower.Init swaps a DLC skin the player doesn't own: set the character, a variation, and redress the spine.
    static object Form(FollowerBrain f, string skin)
    {
        var w = WorshipperData.Instance;
        int index = skin == null ? w.GetRandomAvailableSkin() : w.GetSkinIndexFromName(skin);
        if (index < 0 || index >= w.Characters.Count) throw new Refused($"unknown form: {skin}");
        var info = f._directInfoAccess;
        string name = w.GetSkinNameFromIndex(index);
        info.SkinCharacter = index;
        info.SkinName = name;
        info.SkinVariation = w.GetColourData(name).Skin.RandomIndex();
        info.SkinColour = w.Characters[index].SlotAndColours.RandomIndex();
        var follower = FollowerManager.FindFollowerByID(f.Info.ID);
        if (follower != null) follower.Outfit.SetOutfit(follower.Spine, hooded: false);
        return Said($"{f.Info.Name} took the form of {name}");
    }

    static HealthPlayer Lamb() => PlayerFarming.Instance?.health ?? throw new Refused("the Lamb isn't here");

    // Next to random followers, as a follower who can't reach a toilet leaves it.
    static object Spawn(StructureBrain.TYPES type, int count, string what)
    {
        if (!InBase) throw new Refused($"{what} only appears in the cult");
        var near = Present().Select(f => FollowerManager.FindFollowerByID(f.Info.ID)).Where(x => x != null).ToList();
        if (near.Count == 0) throw new Refused("no followers around to leave it");
        for (int i = 0; i < count; i++)
        {
            var at = near[rng.Next(near.Count)].transform.position + (Vector3)(UnityEngine.Random.insideUnitCircle * 1.5f);
            StructureManager.BuildStructure(FollowerLocation.Base, StructuresData.GetInfoByType(type, 0), at, Vector2Int.one, animateIn: false);
        }
        return Said(count == 1 ? $"some {what} appeared" : $"{count} lots of {what} appeared");
    }

    // What the build menu's demolish mode would offer: placed on the grid and deletable. Trees and other scenery
    // are deletable too but have no name (the game shows the bare term), which is how they are told apart.
    static IEnumerable<Structure> Demolishable() => Structure.Structures.Where(s =>
        s != null && s.Brain?.Data != null && s.Brain.Data.IsDeletable && s.Brain.Data.GridTilePosition != StructuresData.NullPosition
        && StructuresData.LocalizedName(s.Brain.Data.Type) != $"Structures/{s.Brain.Data.Type}");

    static object Remove(int? id)
    {
        if (!InBase) throw new Refused("buildings can only be removed while you are in the cult");
        var all = Demolishable().ToList();
        // Random: a random kind first, so a field of farm plots doesn't make every pick a farm plot.
        var target = id == null
            ? all.GroupBy(s => s.Brain.Data.Type).OrderBy(_ => rng.Next()).FirstOrDefault()?.OrderBy(_ => rng.Next()).First()
            : all.FirstOrDefault(s => s.Brain.Data.ID == id);
        if (target == null) throw new Refused(id == null ? "nothing to remove" : $"no building {id} that can be removed");
        var type = target.Brain.Data.Type;
        PlacementRegion.Instance.DestroyBuilding(target);
        return Said($"removed {StructuresData.LocalizedName(type)}");
    }

    // --- the map and building ---

    const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
    static readonly MethodInfo BuildMethod = typeof(PlacementRegion).GetMethod("Build", Private);
    static readonly MethodInfo MoveMethod = typeof(PlacementRegion).GetMethod("MoveBuilding", Private);
    static readonly FieldInfo DirectionField = typeof(PlacementRegion).GetField("direction", Private);
    static readonly FieldInfo IsPathField = typeof(PlacementRegion).GetField("isPath", Private);
    static readonly FieldInfo MovingField = typeof(PlacementRegion).GetField("CurrentStructureToMove", Private);

    static Structures_PlacementRegion Region => PlacementRegion.Instance.structureBrain;

    object Map()
    {
        if (!SaveAndLoad.Loaded) throw new Refused("no save is loaded");
        var d = DataManager.Instance;
        var cell = InBase ? CellOf() : null;
        return new
        {
            land = d.LandPurchased,
            inBase = InBase,
            structures = d.BaseStructures.Where(x => x.GridTilePosition != StructuresData.NullPosition).Select(x => new
            {
                id = x.ID, type = x.Type.ToString(), x = x.GridTilePosition.x, y = x.GridTilePosition.y, w = x.Bounds.x, h = x.Bounds.y,
                flipped = x.Direction == -1, building = x.Type.ToString().StartsWith("BUILD_SITE") ? x.ToBuildType.ToString() : null,
                removable = x.IsDeletable, movable = x.CanBeMoved, flippable = StructuresData.CanBeFlipped(x.Type),
            }).ToList(),
            lamb = cell != null && PlayerFarming.Instance != null ? cell(PlayerFarming.Instance.transform.position) : null,
            followers = cell != null ? FollowerManager.ActiveLocationFollowers().Where(f => f != null && f.Brain != null)
                .Select(f => new { id = f.Brain.Info.ID, at = cell(f.transform.position) }).ToList() : null,
        };
    }

    // World position -> grid cell, fractions included (a cell's centre is +0.5), from three neighbouring tiles.
    static Func<Vector3, object> CellOf()
    {
        foreach (var t in Region.Data.Grid)
        {
            var tx = Region.GetTileGridTile(t.Position + Vector2Int.right); var ty = Region.GetTileGridTile(t.Position + Vector2Int.up);
            if (tx == null || ty == null) continue;
            Vector2 o = t.WorldPosition, ex = (Vector2)tx.WorldPosition - o, ey = (Vector2)ty.WorldPosition - o;
            float det = ex.x * ey.y - ex.y * ey.x;
            return p =>
            {
                Vector2 v = (Vector2)p - o;
                return new { x = Math.Round(t.Position.x + 0.5 + (v.x * ey.y - v.y * ey.x) / det, 2), y = Math.Round(t.Position.y + 0.5 + (ex.x * v.y - ex.y * v.x) / det, 2) };
            };
        }
        return null;
    }

    // The footprint the build menu uses: its placement prefab's, not the 1x1 StructuresData starts with.
    static Vector2Int Footprint(StructureBrain.TYPES t, bool flipped)
    {
        var placement = TypeAndPlacementObjects.GetByType(t)?.PlacementObject;
        var b = placement ? placement.GetComponent<PlacementObject>()?.Bounds : null;
        var size = b ?? StructuresData.GetInfoByType(t, 0).Bounds;
        return flipped ? new Vector2Int(size.y, size.x) : size;
    }

    // Every cell on buildable ground and not taken by another building (trees and rubble are fine: followers clear them).
    static PlacementRegion.TileGridTile CheckRoom(Vector2Int at, Vector2Int size, int self = -1)
    {
        for (int x = 0; x < size.x; x++)
            for (int y = 0; y < size.y; y++)
            {
                var tile = Region.GetTileGridTile(at + new Vector2Int(x, y)) ?? throw new Refused("that isn't buildable ground");
                if (tile.Occupied && tile.ObjectID != self)
                    throw new Refused(tile.ObjectOnTile.ToString().StartsWith("BUILD_SITE") ? "a build site is in the way" : $"{StructuresData.LocalizedName(tile.ObjectOnTile)} is in the way");
            }
        return Region.GetTileGridTile(at);
    }

    static Vector2Int At(JObject b) => new Vector2Int(b.Value<int?>("x") ?? throw new Refused("no x"), b.Value<int?>("y") ?? throw new Refused("no y"));

    static Structure Placed(JObject b)
    {
        if (!InBase) throw new Refused("buildings can only be changed while you are in the cult");
        int id = b.Value<int?>("id") ?? throw new Refused("choose a building");
        return Structure.Structures.FirstOrDefault(s => s?.Brain?.Data != null && s.Brain.Data.ID == id) ?? throw new Refused("no such building here");
    }

    static void CheckCost(StructureBrain.TYPES t, bool free)
    {
        if (free || StructuresData.CanAfford(t)) return;
        var cost = string.Join(", ", StructuresData.GetCost(t).Select(c => $"{c.CostValue} {c.CostItem}"));
        throw new Refused($"not enough to pay for it ({cost})");
    }

    // As the build menu's Build: a build site followers finish, or the building itself for those without one.
    static object Build(JObject b)
    {
        if (!InBase) throw new Refused("you can only build while you are in the cult");
        var t = Enum<StructureBrain.TYPES>(b, "type");
        if (StructureBrain.IsPath(t)) throw new Refused("paths can't be laid from here yet");
        if (TypeAndPlacementObjects.GetByType(t) == null) throw new Refused("that can't be built");
        if (StructuresData.GetBuildOnlyOne(t) && DataManager.Instance.BaseStructures.Any(x => x.Type == t || x.ToBuildType == t)) throw new Refused("the cult can only have one");
        bool flipped = b.Value<bool?>("flipped") ?? false, free = b.Value<bool?>("free") ?? false;
        if (flipped && !StructuresData.CanBeFlipped(t)) flipped = false;
        var at = At(b); var size = Footprint(t, flipped);
        var tile = CheckRoom(at, size);
        CheckCost(t, free);
        var region = PlacementRegion.Instance;
        DirectionField.SetValue(region, flipped ? -1 : 1); region.Rotation = flipped ? 1 : 0; IsPathField.SetValue(region, false);
        try { BuildMethod.Invoke(region, new object[] { t, tile.WorldPosition, at, size, free, false }); }
        finally { DirectionField.SetValue(region, 1); region.Rotation = 0; }
        // Instant: finish the new build site as the game does for paths, instead of waiting for followers.
        var site = (b.Value<bool?>("instant") ?? false) ? Structure.Structures.FirstOrDefault(x => x?.Brain?.Data != null
            && x.Brain.Data.GridTilePosition == at && x.Brain.Data.Type == StructureBrain.TYPES.BUILD_SITE)?.GetComponent<BuildSitePlot>() : null;
        if (site != null) { site.StructureBrain.Build(); return Said($"built {StructuresData.LocalizedName(t)}" + (free ? " for free" : "")); }
        return Said($"started building {StructuresData.LocalizedName(t)}" + (free ? " for free" : ""));
    }

    // As build mode's move: off the grid, then MoveBuilding puts it down at the new cell.
    static object Move(JObject b)
    {
        var s = Placed(b); var data = s.Brain.Data;
        if (!data.CanBeMoved) throw new Refused("that building can't be moved");
        var at = At(b);
        var tile = CheckRoom(at, data.Bounds, data.ID);
        var region = PlacementRegion.Instance;
        s.Brain.RemoveFromGrid();
        DirectionField.SetValue(region, data.Direction); region.Rotation = data.Rotation; MovingField.SetValue(region, s);
        try { MoveMethod.Invoke(region, new object[] { tile.WorldPosition, at }); }
        finally { MovingField.SetValue(region, null); DirectionField.SetValue(region, 1); region.Rotation = 0; }
        return Said($"moved {StructuresData.LocalizedName(data.Type)}");
    }

    // As flipping a held building: mirrored, a quarter turn on, and its footprint's sides swapped.
    static object Flip(JObject b)
    {
        var s = Placed(b); var data = s.Brain.Data;
        if (!StructuresData.CanBeFlipped(data.Type)) throw new Refused("that building can't be flipped");
        var size = new Vector2Int(data.Bounds.y, data.Bounds.x);
        CheckRoom(data.GridTilePosition, size, data.ID);
        s.Brain.RemoveFromGrid();
        data.Direction *= -1;
        data.Rotation = (int)Mathf.Repeat(data.Rotation + 1, 4f);
        data.Bounds = size;
        s.transform.localScale = new Vector3(data.Direction, s.transform.localScale.y, s.transform.localScale.z);
        s.Brain.AddToGrid();
        s.UpdateGraphBounds(enableCollision: true);
        return Said($"flipped {StructuresData.LocalizedName(data.Type)}");
    }

    // The next level on the same spot: the old one comes down and the new one goes up as a build site.
    static object Upgrade(JObject b)
    {
        var s = Placed(b); var data = s.Brain.Data;
        if (!data.IsDeletable) throw new Refused("upgrade that one in the game: it can't be taken down");  // the temple has its own upgrade scene
        var next = System.Enum.GetValues(typeof(StructureBrain.TYPES)).Cast<StructureBrain.TYPES>().FirstOrDefault(t =>
        {
            try { return t != data.Type && TypeAndPlacementObjects.GetByType(t) != null && StructuresData.GetInfoByType(t, 0)?.UpgradeFromType == data.Type; }
            catch { return false; }
        });
        if (next == StructureBrain.TYPES.NONE) throw new Refused("that building has no next level");
        bool free = b.Value<bool?>("free") ?? false, flipped = data.Direction == -1;
        CheckRoom(data.GridTilePosition, Footprint(next, flipped), data.ID);
        CheckCost(next, free);
        var at = data.GridTilePosition;
        PlacementRegion.Instance.DestroyBuilding(s);
        var build = new JObject { ["type"] = next.ToString(), ["x"] = at.x, ["y"] = at.y, ["flipped"] = flipped, ["free"] = free, ["instant"] = b["instant"] };
        Build(build);
        return Said($"upgrading to {StructuresData.LocalizedName(next)}");
    }
}
