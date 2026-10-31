// The base: its buildings on the build grid (GET /map), building, moving and removing them, and the mess and crops.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using UnityEngine;

public partial class CotlLive
{
    [Status("buildings")]
    static object BuildingsStatus() => InBase ? Demolishable().Select(s => new
    {
        id = s.Brain.Data.ID, type = s.Brain.Data.Type.ToString(), name = StructuresData.LocalizedName(s.Brain.Data.Type),
    }).ToList() : null;

    [Action("remove")] static object RemoveAction(JObject b) => Remove(b.Value<int?>("id"));
    [Action("build")] static object BuildAction(JObject b) => Build(b);
    [Action("move")] static object MoveAction(JObject b) => Move(b);
    [Action("flip")] static object FlipAction(JObject b) => Flip(b);
    [Action("upgrade")] static object UpgradeAction(JObject b) => Upgrade(b);
    [Action("poop")] static object Poop(JObject b) => Spawn(StructureBrain.TYPES.POOP, Count(b, 20), "poop");
    [Action("vomit")] static object Vomit(JObject b) => Spawn(StructureBrain.TYPES.VOMIT, Count(b, 20), "vomit");

    [Action("goto")]
    static object Goto(JObject b)
    {
        if (!InBase || PlayerFarming.Instance == null) throw new Refused("the Lamb can only be sent around the cult");
        var tile = Region.GetTileGridTile(At(b)) ?? throw new Refused("that isn't part of the cult's ground");
        PlayerFarming.Instance.transform.position = tile.WorldPosition;
        return Said("the Lamb went there");
    }

    [Action("clean")]
    static object Clean(JObject b)
    {
        var mess = Structure.Structures.Where(s => s?.Brain?.Data != null && (s.Brain.Data.Type == StructureBrain.TYPES.VOMIT || s.Brain.Data.Type.ToString().StartsWith("POOP") && s.Brain.Data.Type != StructureBrain.TYPES.POOP_BUCKET)).ToList();
        foreach (var s in mess) s.Brain.Remove();
        return Said(mess.Count == 0 ? "the cult was already clean" : $"cleaned up {mess.Count} messes");
    }

    [Action("grow")]
    static object Grow(JObject b)
    {
        if (!InBase) throw new Refused("crops only grow while you are in the cult");
        var plots = StructureManager.GetAllStructuresOfType(StructureBrain.TYPES.FARM_PLOT).OfType<Structures_FarmerPlot>().Where(p => p.HasPlantedSeed() && !p.IsFullyGrown).ToList();
        foreach (var p in plots) { p.Data.GrowthStage = p.growthTime; p.OnGrowthStageChanged?.Invoke(); }
        return Said(plots.Count == 0 ? "no crops were growing" : $"{plots.Count} plots are ready to harvest");
    }

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

    [Get("/map")]
    static object Map()
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
