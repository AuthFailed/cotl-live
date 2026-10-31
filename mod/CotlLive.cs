// CotlLive: lets a web page see and control the running game over http://127.0.0.1.
//
// Listens on the first free port of 47820-47824, so a page can find the game by trying each. Only pages from
// AllowedOrigins (and http://localhost, for development) get answers; the browser sends Origin and a page
// can't fake it. Requests are handled on a background thread, the game work runs in Update on the main thread.
//
// The plugin is one class split over files by subject (Followers.cs, Base.cs, Crusade.cs, ...). Each file declares
// what it adds, and this file finds it all when the plugin starts:
//   [Action("name")] static object X(JObject body)   POST /act {"action": "name", ...}
//   [Get("/path")]   static object X()                GET /path, answered as JSON
//   [Status("key")]  static object X()                one field of GET /status
// GET /capabilities lists them, so a page can tell what this version of the plugin can do.
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
public partial class CotlLive : BaseUnityPlugin
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

    [AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
    class ActionAttribute : Attribute
    {
        public readonly string Name;
        public bool NeedsSave = true;  // most actions act on a loaded save; the few that don't (saves, settings) say so
        public ActionAttribute(string name) { Name = name; }
    }

    [AttributeUsage(AttributeTargets.Method)]
    class GetAttribute : Attribute { public readonly string Path; public GetAttribute(string path) { Path = path; } }

    [AttributeUsage(AttributeTargets.Method)]
    class StatusAttribute : Attribute { public readonly string Key; public StatusAttribute(string key) { Key = key; } }

    // Filled once in Awake, before the listener thread starts, and only read after that.
    static readonly Dictionary<string, (Func<JObject, object> Run, bool NeedsSave)> actions = new Dictionary<string, (Func<JObject, object>, bool)>();
    static readonly Dictionary<string, Func<object>> gets = new Dictionary<string, Func<object>>();
    static readonly List<(string Key, Func<object> Get)> statusParts = new List<(string, Func<object>)>();

    void Awake()
    {
        allowed = Config.Bind("General", "AllowedOrigins", "https://live.cotl.info",
            "Comma-separated origins of pages allowed to control the game. http://localhost and http://127.0.0.1 pages always are.");
        Register();
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

    void Register()
    {
        foreach (var m in typeof(CotlLive).GetMethods(BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public))
        {
            foreach (ActionAttribute a in m.GetCustomAttributes(typeof(ActionAttribute), false))
                actions[a.Name] = ((Func<JObject, object>)Delegate.CreateDelegate(typeof(Func<JObject, object>), m), a.NeedsSave);
            foreach (GetAttribute g in m.GetCustomAttributes(typeof(GetAttribute), false))
                gets[g.Path] = (Func<object>)Delegate.CreateDelegate(typeof(Func<object>), m);
            foreach (StatusAttribute s in m.GetCustomAttributes(typeof(StatusAttribute), false))
                statusParts.Add((s.Key, (Func<object>)Delegate.CreateDelegate(typeof(Func<object>), m)));
        }
        Logger.LogInfo($"{actions.Count} actions, {gets.Count} endpoints, {statusParts.Count} status parts");
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
        bool get = gets.ContainsKey(path) || path == "/screen";
        if (!get && path != "/act") { Reply(res, 404, new { error = $"no such path: {path}" }); return; }
        if (get != (req.HttpMethod == "GET")) { Reply(res, 405, new { error = get ? $"GET {path}" : "POST /act" }); return; }
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
            try { job.Result = job.Path == "/act" ? Act(job.Body) : gets[job.Path](); }
            catch (Refused e) { job.Status = 409; job.Result = new { error = e.Message }; }
            catch (Exception e) { job.Status = 500; job.Result = new { error = e.Message }; Logger.LogError(e); }
            job.Done.Set();
        }
    }

    // One action per call; see the [Action] methods for what each takes.
    static object Act(JObject b)
    {
        string name = b.Value<string>("action") ?? throw new Refused("no action");
        if (!actions.TryGetValue(name, out var a)) throw new Refused($"no such action: {name}");
        if (a.NeedsSave && !SaveAndLoad.Loaded) throw new Refused("no save is loaded");
        return a.Run(b);
    }

    // Each part is read on its own, so a part broken by a game update leaves the rest of the status working.
    [Get("/status")]
    static object Status()
    {
        var s = new Dictionary<string, object>
        {
            ["app"] = "cotl-live",
            ["mod"] = Version,
            ["game"] = Application.version,
            ["scene"] = SceneManager.GetActiveScene().name,
            ["loaded"] = SaveAndLoad.Loaded,
            ["inBase"] = InBase,
            ["inDungeon"] = InDungeon,
        };
        List<string> errors = null;
        foreach (var (key, get) in statusParts)
        {
            try { s[key] = get(); }
            catch (Exception e) { s[key] = null; (errors = errors ?? new List<string>()).Add($"{key}: {e.Message}"); }
        }
        if (errors != null) s["errors"] = errors;
        return s;
    }

    [Get("/capabilities")]
    static object Capabilities() => new
    {
        app = "cotl-live",
        mod = Version,
        game = Application.version,
        actions = actions.Keys.OrderBy(k => k).ToList(),
        endpoints = gets.Keys.Concat(new[] { "/screen", "/act" }).OrderBy(k => k).ToList(),
        status = statusParts.Select(p => p.Key).ToList(),
    };

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

    // --- shared by every module ---

    static bool InBase => SaveAndLoad.Loaded && PlacementRegion.Instance != null;
    static bool InDungeon => SaveAndLoad.Loaded && PlayerFarming.Instance != null && GameManager.IsDungeon(PlayerFarming.Location);

    static object Said(string message) => new { message };

    static int Count(JObject b, int max, string key = "count") => Math.Max(1, Math.Min(b.Value<int?>(key) ?? 1, max));

    static T Enum<T>(JObject b, string key) where T : struct
    {
        string v = b.Value<string>(key);
        if (v == null || !System.Enum.TryParse(v, true, out T t) || !System.Enum.IsDefined(typeof(T), t)) throw new Refused($"unknown {key}: {v}");
        return t;
    }
}
