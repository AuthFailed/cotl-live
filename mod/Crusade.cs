// The Lamb's health anywhere, and everything about a crusade in progress.
using System;
using System.Collections.Generic;
using System.Linq;
using HarmonyLib;
using Newtonsoft.Json.Linq;
using UnityEngine;

public partial class CotlLive
{
    static HealthPlayer Lamb() => PlayerFarming.Instance?.health ?? throw new Refused("the Lamb isn't here");
    static PlayerFarming Crusader() => InDungeon ? PlayerFarming.Instance : throw new Refused("the Lamb isn't on a crusade");
    static List<Health> Enemies() => Health.team2.Where(e => e != null && e.HP > 0f && e.gameObject.activeInHierarchy).ToList();

    [Status("lamb")]
    static object LambStatus()
    {
        var hp = InDungeon || InBase ? PlayerFarming.Instance?.health : null;
        return hp != null ? new { hp = hp.HP, max = hp.totalHP } : null;
    }

    [Status("run")]
    static object RunStatus()
    {
        if (!InDungeon) return null;
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

    [Action("lambHeal")]
    static object LambHeal(JObject b)
    {
        var h = Lamb();
        if (h.HP >= h.totalHP) throw new Refused("the Lamb is already at full health");
        h.Heal(2f);
        return Said("the Lamb was healed");
    }

    [Action("lambHurt")]
    static object LambHurt(JObject b)
    {
        var h = Lamb();
        if (h.HP <= 1f) throw new Refused("the Lamb is on its last half heart");  // never the killing blow
        h.HP -= 1f;
        return Said("the Lamb lost half a heart");
    }

    [Action("tarot")]
    static object Tarot(JObject b)
    {
        if (!InDungeon) throw new Refused("tarot cards are drawn on a crusade");
        var card = b["card"] != null ? new TarotCards.TarotCard(Enum<TarotCards.Card>(b, "card"), 0)
            : TarotCards.DrawRandomCard(PlayerFarming.Instance) ?? throw new Refused("no tarot cards left to draw");
        TrinketManager.AddTrinket(card, PlayerFarming.Instance);
        return Said($"drew the tarot card {card.CardType}");
    }

    [Action("weapon")]
    static object Weapon(JObject b)
    {
        var p = Crusader(); var w = Enum<EquipmentType>(b, "weapon");
        if (EquipmentManager.GetWeaponData(w) == null) throw new Refused("that isn't a weapon");
        p.playerWeapon.SetWeapon(w, Math.Max(0, b.Value<int?>("level") ?? p.currentWeaponLevel));
        return Said($"the Lamb now holds {w}");
    }

    [Action("curse")]
    static object Curse(JObject b)
    {
        var p = Crusader(); var c = Enum<EquipmentType>(b, "curse");
        if (EquipmentManager.GetCurseData(c) == null) throw new Refused("that isn't a curse");
        p.playerSpells.SetSpell(c, Math.Max(0, b.Value<int?>("level") ?? p.currentCurseLevel));
        return Said($"the Lamb now wields {c}");
    }

    [Action("relic")]
    static object Relic(JObject b)
    {
        var p = Crusader(); var r = Enum<RelicType>(b, "relic");
        var data = EquipmentManager.GetRelicData(r) ?? throw new Refused("unknown relic");
        p.playerRelic.EquipRelic(data);
        return Said($"the Lamb now carries {r}");
    }

    [Action("hearts")]
    static object Hearts(JObject b)
    {
        var h = Crusader().health; int n = Math.Max(1, Math.Min(b.Value<int?>("amount") ?? 2, 20));
        string kind = b.Value<string>("kind") ?? "blue";
        if (kind == "black") h.BlackHearts += n; else if (kind == "spirit") h.SpiritHearts += n; else h.BlueHearts += n;
        return Said(n == 2 ? $"the Lamb got a {kind} heart" : $"the Lamb got {n / 2f} {kind} hearts");
    }

    // The game resets Health.invincible on its own, so damage to the Lamb is refused here until the time is up.
    static float invincibleUntil;
    [HarmonyPrefix, HarmonyPatch(typeof(HealthPlayer), nameof(HealthPlayer.DealDamage))]
    static bool NoDamage(ref bool __result) { if (Time.time >= invincibleUntil) return true; __result = false; return false; }

    [Action("invincible")]
    static object Invincible(JObject b)
    {
        Crusader(); float secs = Math.Max(1, Math.Min(b.Value<float?>("seconds") ?? 15f, 120f));
        invincibleUntil = Time.time + secs;
        return Said($"the Lamb can't be hurt for {secs} seconds");
    }

    static object OnEnemies(Action<Health> act, string verb)
    {
        Crusader();
        var list = Enemies();
        if (list.Count == 0) throw new Refused("no enemies in this room");
        foreach (var e in list) act(e);
        return Said($"{list.Count} enemies {verb}");
    }

    [Action("killEnemies")] static object KillEnemies(JObject b) => OnEnemies(e => e.DealDamage(e.totalHP * 10f, PlayerFarming.Instance.gameObject, e.transform.position, false, Health.AttackTypes.Heavy, dealDamageImmediately: true), "defeated");
    [Action("hurtEnemies")] static object HurtEnemies(JObject b) => OnEnemies(e => e.DealDamage(Math.Max(1f, e.totalHP / 2f), PlayerFarming.Instance.gameObject, e.transform.position, false, Health.AttackTypes.Heavy), "lost half their health");
    [Action("healEnemies")] static object HealEnemies(JObject b) => OnEnemies(e => e.HP = e.totalHP, "were healed");
}
