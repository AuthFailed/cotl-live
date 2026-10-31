// The chest: what the cult owns, and giving, taking or setting items.
using System;
using System.Linq;
using Newtonsoft.Json.Linq;

public partial class CotlLive
{
    [Status("chest")]
    static object ChestStatus() => SaveAndLoad.Loaded
        ? Inventory.items.Where(i => i.quantity > 0).Select(i => new { item = ((InventoryItem.ITEM_TYPE)i.type).ToString(), count = i.quantity }).ToList()
        : null;

    [Action("give")]
    static object Give(JObject b)
    {
        var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int n = Count(b, 999, "amount");
        Inventory.AddItem(item, n);
        return Said($"added {n} {item}");
    }

    [Action("set")]
    static object SetItem(JObject b)
    {
        var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int want = Math.Max(0, Math.Min(b.Value<int?>("amount") ?? 0, 9999));
        int have = Inventory.GetItemQuantity(item);
        if (want > have) Inventory.AddItem(item, want - have); else if (want < have) Inventory.ChangeItemQuantity(item, want - have);
        return Said($"{item} is now {want}");
    }

    [Action("take")]
    static object Take(JObject b)
    {
        var item = Enum<InventoryItem.ITEM_TYPE>(b, "item"); int have = Inventory.GetItemQuantity(item);
        int n = Math.Min(Count(b, 999, "amount"), have);
        if (n == 0) throw new Refused($"there is no {item} to take");
        Inventory.ChangeItemQuantity(item, -n);
        return Said($"took {n} {item}");
    }
}
