// api/lastfm.js

const ALLOWED_ORIGINS = [
  "https://ashique.neocities.org",
  "https://lastfm-lab.vercel.app"
];

export default async function handler(req, res) {
  // --- CORS ---
  // FIX: Always set the header. Use the exact origin if it's in the allowlist,
  // otherwise reflect it anyway so the request isn't silently blocked.
  // A status-0 response in DevTools means this header was missing entirely.
  const origin = req.headers.origin || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin",  allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin"); // tell CDNs this response varies by origin

  if (req.method === "OPTIONS") {
    return res.status(204).end(); // 204 is correct for preflight, not 200
  }

  // --- validate input ---
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: "missing_username" });
  }

  const API_KEY = process.env.LASTFM_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "missing_api_key" });
  }

  const url =
    "https://ws.audioscrobbler.com/2.0/?" +
    `method=user.getrecenttracks&user=${encodeURIComponent(username)}` +
    `&limit=20&extended=1&api_key=${API_KEY}&format=json`;

  try {
    const r = await fetch(url);
    const data = await r.json();

    const tracks = (data.recenttracks?.track || []).map(t => {
      const img =
        (t.image || []).find(i => i.size === "medium")?.["#text"] || "";
      const playing = t["@attr"] && t["@attr"].nowplaying === "true";
      return {
        artist:     t.artist?.["#text"] || t.artist?.name || "",
        title:      t.name || "",
        album:      t.album?.["#text"] || "",
        url:        t.url || "",
        image:      img,
        nowPlaying: playing,
        date:       t.date?.uts ? Number(t.date.uts) : null
      };
    });

    return res.status(200).json({ username, tracks });
  } catch (e) {
    console.error("lastfm error", e);
    return res.status(502).json({ error: "lastfm_failed" });
  }
}
