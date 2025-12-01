// api/lastfm.js

const ALLOWED_ORIGINS = [
  "https://ashique.gt.tc",   // put your real site origin here
  "https://lastfm-lab.vercel.app"     // keep if you also call it from its own UI
];

export default async function handler(req, res) {
  // --- CORS ---
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
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
        artist: t.artist?.["#text"] || t.artist?.name || "",
        title: t.name || "",
        album: t.album?.["#text"] || "",
        url: t.url || "",
        image: img,
        nowPlaying: playing,
        date: t.date?.uts ? Number(t.date.uts) : null
      };
    });

    return res.status(200).json({ username, tracks });
  } catch (e) {
    console.error("lastfm error", e);
    return res.status(502).json({ error: "lastfm_failed" });
  }
}
