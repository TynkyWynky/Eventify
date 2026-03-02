import { useCallback, useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function useInstallPrompt() {
  const [installPromptEvent, setInstallPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [isInstallReady, setInstallReady] = useState(false);
  const [isStandalone, setStandalone] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as InstallPromptEvent);
      setInstallReady(true);
    };
    const onInstalled = () => {
      setInstallPromptEvent(null);
      setInstallReady(false);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstallReady(false);
    }
  }, [installPromptEvent]);

  return { isInstallReady, isStandalone, promptInstall };
}
