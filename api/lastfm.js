import {
  applyCors,
  isPreflight,
  getApiKey,
  cleanUsername,
  lastfmUrl,
  fetchLastfmJson,
  isRateLimited,
  pickImage
} from "../lib/api-utils.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (isPreflight(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (isRateLimited(req)) {
    return res.status(429).json({ error: "rate_limited" });
  }

  const username = cleanUsername(req.query?.username);
  if (!username) {
    return res.status(400).json({ error: "invalid_username" });
  }

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  try {
    const data = await fetchLastfmJson(
      lastfmUrl(apiKey, "user.getrecenttracks", {
        user: username,
        limit: 20,
        extended: 1
      }),
      "recentTracks"
    );

    const tracks = (data.recenttracks?.track || []).map((track) => ({
      artist: track.artist?.["#text"] || track.artist?.name || "",
      title: track.name || "",
      album: track.album?.["#text"] || "",
      url: track.url || "",
      image: pickImage(track.image, "medium"),
      nowPlaying: track["@attr"]?.nowplaying === "true",
      date: track.date?.uts ? Number(track.date.uts) : null
    }));

    res.setHeader("Cache-Control", "s-maxage=60");
    return res.status(200).json({ username, tracks });
  } catch (error) {
    console.error("lastfm: request failed", error.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: "lastfm_failed" });
    }
    return res.end();
  }
}
