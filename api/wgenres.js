// api/wgenres.js

const ALLOWED_ORIGINS = [
  "https://your-main-site.example",
  "https://lastfm-lab.vercel.app"
];

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const API_KEY = process.env.LASTFM_API_KEY;
  if (!API_KEY) {
    console.error("wgenres: LASTFM_API_KEY missing");
    return res.status(500).json({ error: "missing_api_key" });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });

    const artists = Array.isArray(body.artists) ? body.artists : [];
    // expect [{ name, playcount }, ...] from wrapped.js

    console.log("wgenres: received artists", artists.map(a => a.name));

    const base = "https://ws.audioscrobbler.com/2.0/";
    const params = (extra) =>
      `${base}?${extra}&api_key=${API_KEY}&format=json`;

    const tagScores = {};

    async function safeJson(name, r) {
      try {
        const txt = await r.text();
        if (!txt) {
          console.warn(`wgenres: empty body from ${name}`);
          return {};
        }
        let j;
        try {
          j = JSON.parse(txt);
        } catch (err) {
          console.error(`wgenres: JSON parse error from ${name}`, err, txt.slice(0, 200));
          return {};
        }
        if (j && j.error) {
          console.error(`wgenres: logical error from ${name}`, j);
          return {};
        }
        return j || {};
      } catch (err) {
        console.error(`wgenres: safeJson failed for ${name}`, err);
        return {};
      }
    }

    await Promise.all(
      artists.slice(0, 5).map(async (a) => {
        const name = a.name;
        if (!name) return;
        const playcount = Number(a.playcount) || 1;

        const url = params(
          `method=artist.getTopTags&artist=${encodeURIComponent(name)}`
        );

        try {
          const r = await fetch(url);
          const j = await safeJson("artist.getTopTags", r);
          const tags = j.toptags?.tag || [];

          tags.slice(0, 5).forEach((tag) => {
            const tagName = (tag.name || "").toLowerCase();
            if (!tagName) return;
            const tagWeight = Number(tag.count) || 1;
            const score = tagWeight * playcount;
            tagScores[tagName] = (tagScores[tagName] || 0) + score;
          });
        } catch (err) {
          console.error("wgenres: error fetching tags for", name, err);
        }
      })
    );

    const entries = Object.entries(tagScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const totalScore = entries.reduce((s, [, w]) => s + w, 0) || 1;

    const topGenres = entries.map(([name, score]) => ({
      name,
      weight: score / totalScore
    }));

    console.log("wgenres: topGenres", topGenres);

    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json({ topGenres });
  } catch (e) {
    console.error("wgenres error", e);
    if (!res.headersSent) {
      return res.status(500).json({ error: "wgenres_failed" });
    }
  }
}
