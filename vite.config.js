import { defineConfig } from "vite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Provides `virtual:playlist-tracks`: the track list (title, artist, length) of
// every playlist in playlists.js, keyed by its url.
//
// Spotify's embedded player doesn't say which song is playing and has no
// next/previous command, so the site plays tracks one at a time from this list.
// The list comes from Spotify's public embed page, fetched here in Node because
// browsers aren't allowed to fetch it from the site. It's refetched whenever
// playlists.js changes, and baked in at build time (rebuild to pick up songs
// added to a playlist later).
function playlistTracks() {
  const id = "virtual:playlist-tracks";
  const resolvedId = "\0" + id;
  const playlistsFile = resolve("playlists.js");

  return {
    name: "playlist-tracks",
    resolveId: (source) => (source === id ? resolvedId : undefined),
    async load(moduleId) {
      if (moduleId !== resolvedId) return;
      this.addWatchFile(playlistsFile);
      const { PLAYLISTS } = await import(`${pathToFileURL(playlistsFile).href}?t=${Date.now()}`);
      const entries = await Promise.all(PLAYLISTS.map(async (p) => [p.url, await fetchTracks(p.url)]));
      return `export default ${JSON.stringify(Object.fromEntries(entries))};`;
    },
  };
}

async function fetchTracks(url) {
  const match = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([A-Za-z0-9]+)/);
  if (!match) return [];
  try {
    const res = await fetch(`https://open.spotify.com/embed/${match[1]}/${match[2]}`);
    const html = await res.text();
    const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)?.[1];
    const tracks = JSON.parse(json).props.pageProps.state.data.entity.trackList ?? [];
    return tracks
      .filter((t) => t.isPlayable !== false)
      .map((t) => ({
        uri: t.uri,
        title: t.title,
        artist: t.subtitle.replace(/ /g, " "),
        duration: t.duration,
      }));
  } catch (err) {
    console.warn(`[playlist-tracks] Couldn't fetch tracks for ${url}: ${err.message}`);
    return []; // the player falls back to playing the playlist as a whole
  }
}

export default defineConfig({
  plugins: [playlistTracks()],
});
