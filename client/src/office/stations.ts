/**
 * Curated free, legal, directly-streamable internet radio stations.
 *
 * All entries are SomaFM channels — a long-running, listener-supported,
 * commercial-free webcaster that explicitly permits direct streaming of its
 * public stream URLs. Being live streams, every listener hears roughly the
 * same thing at the same time, so the "office speaker" stays in sync for free.
 * Users can also paste any other stream/audio URL in the UI.
 */
export interface Station {
  id: string;
  name: string;
  icon: string;
  url: string;
}

export const STATIONS: Station[] = [
  { id: 'fluid',       name: 'Lofi / Chillhop', icon: '🎧', url: 'https://ice1.somafm.com/fluid-128-mp3' },
  { id: 'groovesalad', name: 'Chill Ambient',   icon: '🌿', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { id: 'secretagent', name: 'Jazz & Lounge',   icon: '🎷', url: 'https://ice1.somafm.com/secretagent-128-mp3' },
  { id: 'dronezone',   name: 'Deep Ambient',    icon: '🌌', url: 'https://ice1.somafm.com/dronezone-128-mp3' },
  { id: 'indiepop',    name: 'Indie Pop',       icon: '🎸', url: 'https://ice1.somafm.com/indiepop-128-mp3' },
  { id: 'beatblender', name: 'Deep House',      icon: '🪩', url: 'https://ice1.somafm.com/beatblender-128-mp3' },
];
