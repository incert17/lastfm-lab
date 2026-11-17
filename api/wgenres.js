import {
  applyCors,
  isPreflight,
  getApiKey,
  lastfmUrl,
  fetchLastfmJson,
  isRateLimited,
  cleanArtists,
  readJsonBody
} from "../lib/api-utils.js";

export default async function handler(req, res) {
  applyCors(req, res, "POST, OPTIONS");
  if (isPreflight(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (isRateLimited(req, 30)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  try {
    const body = await readJsonBody(req);
    const artists = cleanArtists(body.artists);

    if (!artists.length) {
      return res.status(400).json({ error: "no_artists" });
    }

    const tagScores = new Map();

    await Promise.all(
      artists.map(async (artist) => {
        try {
          const json = await fetchLastfmJson(
            lastfmUrl(apiKey, "artist.getTopTags", { artist: artist.name }),
            "artist.getTopTags"
          );
          const tags = json.toptags?.tag || [];

          tags.slice(0, 5).forEach((tag) => {
            const name = (tag.name || "").trim().toLowerCase();
            if (!name) return;
            const count = Number(tag.count) || 1;
            const score = count * artist.playcount;
            tagScores.set(name, (tagScores.get(name) || 0) + score);
          });
        } catch (error) {
          console.error("wgenres: tag lookup failed", error.message);
        }
      })
    );

    const entries = [...tagScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const totalScore = entries.reduce((sum, [, score]) => sum + score, 0) || 1;

    const topGenres = entries.map(([name, score]) => ({
      name,
      weight: score / totalScore
    }));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ topGenres });
  } catch (error) {
    console.error("wgenres: request failed", error.message);
    if (!res.headersSent) {
      return res.status(400).json({ error: "invalid_body" });
    }
    return res.end();
  }
}
