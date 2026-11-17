import albumArt from "album-art";
import {
  applyCors,
  isPreflight,
  getApiKey,
  cleanUsername,
  normalizePeriod,
  periodLabel,
  lastfmUrl,
  fetchLastfmJson,
  withTimeout,
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

  const period = normalizePeriod(req.query?.period);

  try {
    const [tracksJson, artistsJson, userJson] = await Promise.all([
      fetchLastfmJson(
        lastfmUrl(apiKey, "user.getTopTracks", { user: username, period, limit: 10 }),
        "topTracks"
      ),
      fetchLastfmJson(
        lastfmUrl(apiKey, "user.getTopArtists", { user: username, period, limit: 10 }),
        "topArtists"
      ),
      fetchLastfmJson(
        lastfmUrl(apiKey, "user.getInfo", { user: username }),
        "userInfo"
      )
    ]);

    const tracksArr = tracksJson.toptracks?.track || [];
    const artistsArr = artistsJson.topartists?.artist || [];
    const tracksAttr = tracksJson.toptracks?.["@attr"] || {};
    const artistsAttr = artistsJson.topartists?.["@attr"] || {};

    const topTrackRaw = tracksArr[0];
    const topArtistRaw = artistsArr[0];

    const trackName = topTrackRaw?.name || "";
    const trackArtist =
      topTrackRaw?.artist?.name || topTrackRaw?.artist?.["#text"] || "";
    const artistName = topArtistRaw?.name || "";

    const spotifyTrackCover = trackName && trackArtist
      ? await withTimeout(
          albumArt(trackArtist, { album: trackName, size: "large" }),
          3000,
          ""
        )
      : "";
    const spotifyArtistCover = artistName
      ? await withTimeout(albumArt(artistName, { size: "large" }), 3000, "")
      : "";

    const topTracks = tracksArr.slice(0, 10).map((track, index) => ({
      name: track.name || "",
      artist: track.artist?.name || track.artist?.["#text"] || "",
      playcount: Number(track.playcount) || 0,
      image:
        (index === 0 && (spotifyTrackCover || pickImage(track.image))) || ""
    }));

    const topArtists = artistsArr.slice(0, 10).map((artist, index) => ({
      name: artist.name || "",
      playcount: Number(artist.playcount) || 0,
      image:
        (index === 0 && (spotifyArtistCover || pickImage(artist.image))) || ""
    }));

    const response = {
      username,
      period,
      periodLabel: periodLabel(period),
      totalTracks: Number(tracksAttr.total) || tracksArr.length || 0,
      totalArtists: Number(artistsAttr.total) || artistsArr.length || 0,
      totalScrobbles:
        period === "overall" ? Number(userJson.user?.playcount) || 0 : null,
      topTracks,
      topArtists
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(response);
  } catch (error) {
    console.error("wrapped: request failed", error.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: "lastfm_failed" });
    }
    return res.end();
  }
}
