// api/wgenres.js

const ALLOWED_ORIGINS = [
  "https://your-main-site.example",     // replace with your main site
  "https://lastfm-lab.vercel.app"      // adjust if needed
];

// keep in sync with wrapped.js
const VALID_PERIODS = [
  "7day","1month","3month","6month","12month","overall"
];

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { username, period = "3month" } = req.query;

  if (!username) {
    return res.status(400).json({ error: "missing_username" });
  }

  const API_KEY = process.env.LASTFM_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "missing_api_key" });
  }

  const safePeriod = VALID_PERIODS.includes(period) ? period : "3month";

  const base = "https://ws.audioscrobbler.com/2.0/";
  const params = (extra) =>
    `${base}?${extra}&api_key=${API_KEY}&format=json`;

  const topArtistsUrl = params(
    `method=user.getTopArtists&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=15`
  ); // [web:324]

  try {
    const artistsRes = await fetch(topArtistsUrl);

    async function safeJson(r) {
      try {
        const j = await r.json();
        if (j && j.error) return {};
        return j || {};
      } catch {
        return {};
      }
    }

    const artistsJson = await safeJson(artistsRes);
    const artistsArr  = artistsJson.topartists?.artist || [];

    // build tag map from top N artists
    const topGenreMap = {};
    const sample = artistsArr.slice(0, 10); // keep it small

    await Promise.all(
      sample.map(async (a) => {
        const artistName = encodeURIComponent(a.name);
        const url = params(
          `method=artist.getTopTags&artist=${artistName}`
        ); // [web:340]
        try {
          const r = await fetch(url);
          const j = await safeJson(r);
          const tags = j.toptags?.tag || [];
          const playcount = Number(a.playcount) || 1;

          for (const tag of tags.slice(0, 5)) {
            const name = (tag.name || "").toLowerCase();
            if (!name) continue;
            const tagWeight = Number(tag.count) || 1;
            const score = tagWeight * playcount;
            topGenreMap[name] = (topGenreMap[name] || 0) + score;
          }
        } catch {
          // ignore this artist on failure
        }
      })
    );

    const entries = Object.entries(topGenreMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // a small cloud

    const totalWeight = entries.reduce((s, [, w]) => s + w, 0) || 1;

    const topGenres = entries.map(([name, weight]) => ({
      name,
      weight: weight / totalWeight
    }));

    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json({
      username,
      period: safePeriod,
      topGenres
    });
  } catch (e) {
    console.error("wgenres error", e);
    return res.status(502).json({ error: "wgenres_failed" });
  }
}
