import { create } from "zustand";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { flushSave, useStore } from "./store";
import { invoke, isTauri } from "./tauri";

/** Controls the "Minimize to tray or quit?" dialog shown when closeBehavior is "ask". */
export const useCloseDialog = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export async function quitApp() {
  await flushSave();
  if (isTauri) await invoke("app_quit");
}

export async function hideToTray() {
  await flushSave();
  if (!isTauri) return;
  await invoke("window_hide");
  const s = useStore.getState();
  if (!s.settings.trayHintShown) {
    s.updateSettings({ trayHintShown: true });
    try {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok)
        sendNotification({
          title: "Dune Server Manager is still running",
          body: "It's in the system tray (click ^ next to the clock if you don't see it). Right-click the icon and choose Quit to exit.",
        });
    } catch {
      /* notifications unavailable */
    }
  }
}

/** Single entry point for every close path: title-bar X, Alt+F4 and the taskbar's "Close window". */
export function requestClose() {
  const b = useStore.getState().settings.closeBehavior;
  if (b === "quit") return void quitApp();
  if (b === "tray") return void hideToTray();
  useCloseDialog.getState().setOpen(true);
}
