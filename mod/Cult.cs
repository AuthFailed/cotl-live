// The cult as a whole: its name, the day, faith and weather, and the actions that change them.
using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

public partial class CotlLive
{
    [Status("cult")] static object CultStatus() => SaveAndLoad.Loaded ? DataManager.Instance.CultName : null;
    [Status("day")] static object DayStatus() => SaveAndLoad.Loaded ? TimeManager.CurrentDay : (int?)null;
    [Status("phase")] static object PhaseStatus() => SaveAndLoad.Loaded ? TimeManager.CurrentPhase.ToString() : null;
    [Status("faith")] static object FaithStatus() => SaveAndLoad.Loaded ? Mathf.RoundToInt(Mathf.Clamp01(CultFaithManager.CultFaithNormalised) * 100f) : (int?)null;
    [Status("weather")] static object WeatherStatus() => WeatherSystemController.Instance != null ? WeatherSystemController.Instance.CurrentWeatherType.ToString() : null;

    [Action("faith")]
    static object Faith(JObject b)
    {
        int n = Math.Max(-85, Math.Min(b.Value<int?>("amount") ?? 10, 85));
        CultFaithManager.GetFaith(n, n, true, n >= 0 ? NotificationBase.Flair.Positive : NotificationBase.Flair.Negative);
        return Said(n >= 0 ? "the cult feels inspired" : "the cult loses heart");
    }

    [Action("nextPhase")]
    static object NextPhase(JObject b)
    {
        if (!InBase) throw new Refused("time can only be skipped in the cult");
        TimeManager.SkipTime(TimeManager.TimeRemainingInCurrentPhase());
        return Said("skipping to the next time of day");
    }

    [Action("weather")]
    static object Weather(JObject b)
    {
        if (WeatherSystemController.Instance == null) throw new Refused("there is no weather here");
        var w = Enum<WeatherSystemController.WeatherType>(b, "weather");
        WeatherSystemController.Instance.SetWeather(w, WeatherSystemController.WeatherStrength.Medium, 4f, true, allowNone: true);
        return Said(w == WeatherSystemController.WeatherType.None ? "the sky cleared" : $"the weather turned to {w}");
    }
}
