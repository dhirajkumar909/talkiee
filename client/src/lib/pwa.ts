import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyListeners();
    toast.success('Talkiee has been installed as an app!');
  });
}

export function initPWA() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast.info('New version of Talkiee available', {
        action: {
          label: 'Update',
          onClick: () => {
            updateSW(true);
          },
        },
        duration: 10000,
      });
    },
    onOfflineReady() {
      // Ready for offline use
    },
  });
}

export function usePWAInstall() {
  const isStandalone = () => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true,
    );
  };

  const [canInstall, setCanInstall] = useState(
    () => Boolean(deferredPrompt) && !isStandalone(),
  );

  const [isInstalled, setIsInstalled] = useState(isStandalone);

  useEffect(() => {
    const update = () => {
      const standalone = isStandalone();
      setIsInstalled(standalone);
      setCanInstall(Boolean(deferredPrompt) && !standalone);
    };

    listeners.add(update);
    update();

    return () => {
      listeners.delete(update);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        setCanInstall(false);
      }
    } catch (err) {
      console.error('PWA install error:', err);
    }
  };

  return { canInstall, isInstalled, install };
}
