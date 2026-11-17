import {
  applyCors,
  isPreflight,
  getApiKey,
  cleanUsername,
  normalizePeriod,
  periodLabel,
  lastfmUrl,
  fetchLastfmJson,
  isRateLimited,
  pickImage
} from "../lib/api-utils.js";

function monthYearFromRegistered(registered) {
  const datePart = (registered?.["#text"] || "").split(" ")[0] || "";
  const parts = datePart.split("-");
  if (parts.length < 2) return null;

  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const month = monthNames[Number(parts[1]) - 1] || "";
  return month ? { month, year: Number(parts[0]) || null } : null;
}

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
        lastfmUrl(apiKey, "user.getTopTracks", { user: username, period, limit: 50 }),
        "topTracks"
      ),
      fetchLastfmJson(
        lastfmUrl(apiKey, "user.getTopArtists", { user: username, period, limit: 50 }),
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

    const playcountSum = tracksArr.reduce(
      (sum, track) => sum + (Number(track.playcount) || 0),
      0
    );
    const allTimePlaycount = Number(userJson.user?.playcount) || 0;

    const response = {
      username,
      period,
      periodLabel: periodLabel(period),
      since: period === "overall"
        ? monthYearFromRegistered(userJson.user?.registered)
        : null,
      totalScrobbles: period === "overall"
        ? allTimePlaycount || playcountSum
        : playcountSum,
      totalArtistCount: Number(artistsAttr.total) || artistsArr.length || 0,
      totalTrackCount: Number(tracksAttr.total) || tracksArr.length || 0,
      topTrack: tracksArr[0]
        ? {
            name: tracksArr[0].name || "",
            artist:
              tracksArr[0].artist?.name || tracksArr[0].artist?.["#text"] || "",
            playcount: Number(tracksArr[0].playcount) || 0,
            image: pickImage(tracksArr[0].image)
          }
        : null,
      topArtist: artistsArr[0]
        ? {
            name: artistsArr[0].name || "",
            playcount: Number(artistsArr[0].playcount) || 0,
            image: pickImage(artistsArr[0].image)
          }
        : null,
      topGenres: [],
      topTracks: tracksArr.slice(0, 10).map((track) => ({
        name: track.name || "",
        artist: track.artist?.name || track.artist?.["#text"] || "",
        playcount: Number(track.playcount) || 0,
        image: pickImage(track.image)
      })),
      topArtists: artistsArr.slice(0, 10).map((artist) => ({
        name: artist.name || "",
        playcount: Number(artist.playcount) || 0,
        image: pickImage(artist.image)
      }))
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(response);
  } catch (error) {
    console.error("wrapper: request failed", error.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: "lastfm_failed" });
    }
    return res.end();
  }
}
