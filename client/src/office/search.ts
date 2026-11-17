/**
 * Resolve a free-text song name to a YouTube video (top match).
 *
 * No setup needed: by default it queries public Piped / Invidious search APIs
 * (community-run YouTube front-ends that allow cross-origin requests and need
 * no key). If `VITE_YT_API_KEY` is set in client/.env, it uses the official
 * YouTube Data API first for best reliability. All of this is client-side.
 */
export interface SongResult {
  id: string;
  title: string;
}

// Public instances tried in order. If one is down/rate-limited, the next is
// used. Edit these freely for personal use.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.privacydev.net',
];
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
];

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaApiKey(query: string, key: string): Promise<SongResult | null> {
  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1' +
    `&q=${encodeURIComponent(query)}&key=${key}`;
  const data = (await fetchJson(url)) as {
    items?: { id: { videoId: string }; snippet: { title: string } }[];
  };
  const item = data.items?.[0];
  return item ? { id: item.id.videoId, title: item.snippet.title } : null;
}

async function viaPiped(query: string): Promise<SongResult | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = (await fetchJson(`${base}/search?q=${encodeURIComponent(query)}&filter=videos`)) as {
        items?: { url?: string; title?: string }[];
      };
      const item = data.items?.find((i) => i.url?.includes('/watch?v='));
      if (item?.url) {
        const id = new URLSearchParams(item.url.split('?')[1]).get('v');
        if (id) return { id, title: item.title ?? query };
      }
    } catch {
      /* try next instance */
    }
  }
  return null;
}

async function viaInvidious(query: string): Promise<SongResult | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = (await fetchJson(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`)) as {
        videoId?: string;
        title?: string;
      }[];
      const item = Array.isArray(data) ? data.find((i) => i.videoId) : undefined;
      if (item?.videoId) return { id: item.videoId, title: item.title ?? query };
    } catch {
      /* try next instance */
    }
  }
  return null;
}

export async function searchSong(query: string): Promise<SongResult | null> {
  const key = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_YT_API_KEY;
  if (key) {
    try {
      const r = await viaApiKey(query, key);
      if (r) return r;
    } catch {
      /* fall through to public instances */
    }
  }
  return (await viaPiped(query)) ?? (await viaInvidious(query));
}
