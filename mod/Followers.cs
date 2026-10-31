// Followers: their state for /status, and what can be done to them.
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

public partial class CotlLive
{
    static string State(FollowerInfo f) => f.CursedState == Thought.None ? (f.OldAge ? "OldAge" : "None") : f.CursedState.ToString();

    // Lists, not lazy queries: the reply is serialized on the listener thread, while the game changes these.
    [Status("followers")]
    static object FollowersStatus()
    {
        if (!SaveAndLoad.Loaded) return null;
        var d = DataManager.Instance;
        return d.Followers.Select(f =>
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
        }).ToList();
    }

    [Status("dead")]
    static object DeadStatus() => SaveAndLoad.Loaded ? DataManager.Instance.Followers_Dead.Select(f => new { id = f.ID, name = f.Name, skin = f.SkinName }).ToList() : null;

    [Status("recruits")]
    static object RecruitsStatus() => SaveAndLoad.Loaded ? DataManager.Instance.Followers_Recruit.Count : (int?)null;

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

    // Follower actions take "ids" (those followers) or "count" (that many at random among the ones it can apply to),
    // or neither for everyone it can apply to. The game's own Make* methods refuse some followers (cursed, zombies,
    // busy in a ritual) on their own, so count the ones that actually changed.
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

    [Action("ill")] static object Ill(JObject b) => Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeSick(forced: true), f => f.Info.CursedState == Thought.Ill, "fell ill");
    [Action("injure")] static object Injure(JObject b) => Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeInjured(force: true), f => f.Info.CursedState == Thought.Injured, "got hurt");
    [Action("exhaust")] static object Exhaust(JObject b) => Each(b, f => f.Stats.Exhaustion <= 0f, f => f.MakeExhausted(), f => f.Stats.Exhaustion > 0f, "became exhausted");
    [Action("starve")] static object Starve(JObject b) => Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeStarve(), f => f.Info.CursedState == Thought.BecomeStarving, "started starving");
    [Action("dissent")] static object Dissent(JObject b) => Each(b, f => f.Info.CursedState == Thought.None, f => f.MakeDissenter(), f => f.Info.CursedState == Thought.Dissenter, "started to dissent");
    [Action("old")] static object Old(JObject b) => Each(b, f => f.Info.CursedState == Thought.None && !f._directInfoAccess.OldAge, f => f.MakeOld(), f => f._directInfoAccess.OldAge, "grew old");
    [Action("cure")] static object CureAction(JObject b) => Each(b, f => f.Info.CursedState == Thought.Ill || f.Info.CursedState == Thought.Injured, Cure, f => f.Info.CursedState == Thought.None, "got better");
    [Action("feed")] static object FeedAction(JObject b) => Each(b, f => f.Stats.Satiation < 100f || f.Info.CursedState == Thought.BecomeStarving, Feed, f => true, "ate their fill");
    [Action("rest")] static object Rest(JObject b) => Each(b, f => f.Stats.Rest < 100f || f.Stats.Exhaustion > 0f, f => { f.Stats.Exhaustion = 0f; f.Stats.Rest = 100f; }, f => true, "got some rest");
    [Action("faithful")] static object Faithful(JObject b) => Each(b, f => f.Info.CursedState == Thought.Dissenter, f => { f.Stats.Reeducation = 0f; f.RemoveCurseState(Thought.Dissenter); }, f => f.Info.CursedState != Thought.Dissenter, "came back to the faith");
    [Action("levelup")] static object LevelUp(JObject b) => Each(b, f => f.Stats.Adoration < f.Stats.MAX_ADORATION, f => f.Stats.Adoration = f.Stats.MAX_ADORATION, f => true, "can level up now");
    [Action("bless")] static object Bless(JObject b) => Each(b, f => true, f => f.AddAdoration(FollowerBrain.AdorationActions.Bless, null), f => true, "got a blessing");
    [Action("inspire")] static object Inspire(JObject b) => Each(b, f => true, f => f.AddAdoration(FollowerBrain.AdorationActions.Inspire, null), f => true, "got inspired");
    [Action("happy")] static object Happy(JObject b) => Each(b, f => f._directInfoAccess.Faith < 100f, f => f._directInfoAccess.Faith = 100f, f => true, "got their faith back");

    [Action("necklace")]
    static object Necklace(JObject b)
    {
        var f = One(b); var item = Enum<InventoryItem.ITEM_TYPE>(b, "item");
        if (!item.ToString().StartsWith("Necklace_")) throw new Refused("that isn't a necklace");
        f._directInfoAccess.Necklace = item;
        FollowerManager.FindFollowerByID(f.Info.ID)?.SetOutfit(f.Info.Outfit, hooded: false);
        return Said($"{f.Info.Name} now wears {item}");
    }

    [Action("kill")]
    static object Kill(JObject b)
    {
        var f = One(b);
        f.Die(NotificationCentre.NotificationType.Died);
        return Said($"{f.Info.Name} died");
    }

    [Action("addTrait")]
    static object AddTrait(JObject b)
    {
        var f = One(b); var t = Enum<FollowerTrait.TraitType>(b, "trait");
        if (f.HasTrait(t)) throw new Refused($"{f.Info.Name} already has that trait");
        f.AddTrait(t, showNotification: true);
        return Said(f.HasTrait(t) ? $"{f.Info.Name} got the trait {t}" : throw new Refused($"the game didn't give {f.Info.Name} that trait"));
    }

    [Action("removeTrait")]
    static object RemoveTrait(JObject b)
    {
        var f = One(b); var t = Enum<FollowerTrait.TraitType>(b, "trait");
        if (!f.HasTrait(t)) throw new Refused($"{f.Info.Name} doesn't have that trait");
        f.RemoveTrait(t, showNotification: true);
        return Said($"{f.Info.Name} lost the trait {t}");
    }

    [Action("rename")]
    static object Rename(JObject b)
    {
        var f = One(b); string name = (b.Value<string>("name") ?? "").Trim();
        if (name.Length == 0 || name.Length > 24) throw new Refused("a name is 1 to 24 characters");
        string old = f.Info.Name;
        f._directInfoAccess.Name = name;
        return Said($"{old} is now called {name}");
    }

    [Action("form")] static object FormAction(JObject b) => Form(One(b), b.Value<string>("skin"));

    [Action("recruit")]
    static object Recruit(JObject b)
    {
        var f = FollowerManager.CreateNewRecruit(FollowerLocation.Base, "", NotificationCentre.NotificationType.NewRecruit);
        string name = (b.Value<string>("name") ?? "").Trim();
        if (name.Length > 0 && name.Length <= 24) f.Name = name;
        return Said($"new recruit {f.Name} is waiting at the temple");
    }

    [Action("revive")] static object ReviveAction(JObject b) => Revive(b.Value<int?>("id"));

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
}
