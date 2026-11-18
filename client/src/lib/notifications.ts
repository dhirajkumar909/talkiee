import { toast } from 'sonner';

/**
 * Checks whether the Web Notification API is supported in the current environment.
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Gets the current Notification permission status.
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

/**
 * Requests Notification permission from the user.
 * Must be invoked from an explicit user gesture (e.g. click).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return Notification.permission;
  }
}

/**
 * Displays a desktop notification if permitted.
 */
export function showDesktopNotification(
  title: string,
  options?: NotificationOptions,
): Notification | null {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return null;
  }

  try {
    const notification = new Notification(title, {
      ...options,
    });

    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {
        /* ignore */
      }
    };

    // Automatically close the desktop notification after 4 seconds
    setTimeout(() => {
      try {
        notification.close();
      } catch {
        /* ignore */
      }
    }, 4000);

    return notification;
  } catch (err) {
    console.warn('Could not display desktop notification:', err);
    return null;
  }
}

/**
 * Displays an in-app snackbar (toast) and desktop notification when a member joins.
 */
export function notifyMemberJoin(name: string, officeName?: string) {
  // In-app snackbar
  toast(`${name} joined the office`, {
    icon: '👋',
    description: officeName ? `in ${officeName}` : undefined,
    duration: 4000,
  });

  // Desktop notification
  showDesktopNotification(officeName ? `${officeName} • Talkiee` : 'Talkiee', {
    body: `${name} joined the office`,
    tag: `join-${name}-${Date.now()}`,
  });
}

/**
 * Displays an in-app snackbar (toast) and desktop notification when a member leaves.
 */
export function notifyMemberLeave(name: string, officeName?: string) {
  // In-app snackbar
  toast(`${name} left the office`, {
    icon: '🚪',
    description: officeName ? `from ${officeName}` : undefined,
    duration: 4000,
  });

  // Desktop notification
  showDesktopNotification(officeName ? `${officeName} • Talkiee` : 'Talkiee', {
    body: `${name} left the office`,
    tag: `leave-${name}-${Date.now()}`,
  });
}
