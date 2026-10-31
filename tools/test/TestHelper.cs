// A test helper for running cotl-live on a real game, never shipped. It does nothing unless asked through flag files
// on the host (Z: under Proton is the Linux root), so it stays harmless if it's left installed:
//   /tmp/cotl-live-load     on the main menu, continue save slot 0 as the menu's Continue does
//   /tmp/cotl-live-crusade  in the cult, walk the Lamb into the first unlocked crusade door
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using BepInEx;
using MMTools;
using UnityEngine;
using UnityEngine.SceneManagement;

[BepInPlugin("chrsnv.cotl.live.test", "COTL Live test helper", "0.1.0")]
public class TestHelper : BaseUnityPlugin
{
    const string LoadFlag = @"Z:\tmp\cotl-live-load", CrusadeFlag = @"Z:\tmp\cotl-live-crusade";
    float next;

    void Awake() => SceneManager.sceneLoaded += (scene, mode) => { if (scene.name == "Main Menu") StartCoroutine(Load()); };

    IEnumerator Load()
    {
        yield return new WaitForSecondsRealtime(8f);
        if (!File.Exists(LoadFlag)) yield break;
        File.Delete(LoadFlag);
        SaveAndLoad.SAVE_SLOT = 0;
        MMTransition.Play(MMTransition.TransitionType.ChangeRoomWaitToResume, MMTransition.Effect.BlackFade, "Base Biome 1", 3f, "", () => SaveAndLoad.Load(0));
    }

    void Update()
    {
        if (Time.unscaledTime < next) return;
        next = Time.unscaledTime + 1f;
        if (!File.Exists(CrusadeFlag)) return;
        File.Delete(CrusadeFlag);
        StartCoroutine(Crusade());
    }

    // The doors are in the cult scene's door room; walking into one is what starts a run.
    IEnumerator Crusade()
    {
        if (BiomeBaseManager.Instance == null || PlayerFarming.Instance == null) { Logger.LogWarning("not in the cult"); yield break; }
        BiomeBaseManager.Instance.ActivateDoorRoom();
        yield return new WaitForSeconds(3f);
        var door = FindObjectsOfType<Interaction_BaseDungeonDoor>().FirstOrDefault(d => d.Unlocked);
        if (door == null) { Logger.LogWarning("no unlocked crusade door"); yield break; }
        PlayerFarming.Instance.transform.position = door.transform.position;
        Logger.LogInfo($"entering {door.name}");
        typeof(Interaction_BaseDungeonDoor).GetMethod("OnTriggerEnter2D", BindingFlags.NonPublic | BindingFlags.Instance)
            .Invoke(door, new object[] { PlayerFarming.Instance.GetComponentInChildren<Collider2D>() });
    }
}
