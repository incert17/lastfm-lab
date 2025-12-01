// api/wrapped.js

const ALLOWED_ORIGINS = [
  "https://your-main-site.example",     // replace with your main site
  "https://lastfm-lab.vercel.app"      // adjust as needed
];

const VALID_PERIODS = [
  "7day","1month","3month","6month","12month","overall"
];

const PERIOD_LABELS = {
  "7day":   "last 7 days",
  "1month": "past month",
  "3month": "past 3 months",
  "6month": "past 6 months",
  "12month":"past year",
  "overall":"overall"
};

function monthYearFromRegistered(registered) {
  if (!registered) return null;
  const txt = registered["#text"] || "";
  const datePart = txt.split(" ")[0] || "";
  const parts = datePart.split("-");
  if (parts.length < 2) return null;
  const year = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  const monthNames = [
    "january","february","march","april","may","june",
    "july","august","september","october","november","december"
  ];
  return {
    month: monthNames[monthIdx] || "",
    year
  };
}

function pickImage(images, preferred = "extralarge") {
  if (!Array.isArray(images)) return "";
  const exact = images.find(i => i.size === preferred && i["#text"]);
  if (exact) return exact["#text"];
  const fallbacks = ["large","medium","small"];
  for (const size of fallbacks) {
    const img = images.find(i => i.size === size && i["#text"]);
    if (img) return img["#text"];
  }
  return "";
}

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

  const topTracksUrl  = params(
    `method=user.getTopTracks&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=10`
  ); // [web:323][web:326]
  const topArtistsUrl = params(
    `method=user.getTopArtists&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=5`
  ); // [web:324]
  const userInfoUrl   = params(
    `method=user.getInfo&user=${encodeURIComponent(username)}`
  ); // [web:337][web:335]

  try {
    // three core calls in parallel
    const [tracksRes, artistsRes, userRes] = await Promise.all([
      fetch(topTracksUrl),
      fetch(topArtistsUrl),
      fetch(userInfoUrl)
    ]);

    async function safeJson(r) {
      try {
        const j = await r.json();
        if (j && j.error) return {};
        return j || {};
      } catch {
        return {};
      }
    }

    const [tracksJson, artistsJson, userJson] = await Promise.all([
      safeJson(tracksRes),
      safeJson(artistsRes),
      safeJson(userRes)
    ]);

    const tracksArr  = tracksJson.toptracks?.track || [];
    const artistsArr = artistsJson.topartists?.artist || [];

    // ----- total artists (period) -----
    const artistsAttr = artistsJson.topartists?.["@attr"] || {};
    const totalArtistsPeriod =
      Number(artistsAttr.total) || artistsArr.length || 0; // [web:324][web:323]

    // ----- total scrobbles -----
    // per-period: approximate as sum of track playcounts
    let totalScrobblesPeriod = 0;
    for (const t of tracksArr) {
      totalScrobblesPeriod += Number(t.playcount) || 0;
    }

    // overall: all-time from user.getInfo.playcount[web:337][web:335]
    const totalScrobblesOverall = Number(userJson.user?.playcount) || 0;

    // ----- origin date (overall only) -----
    const since =
      safePeriod === "overall"
        ? monthYearFromRegistered(userJson.user?.registered)
        : null;

    // ----- top tracks / artists -----
    const topTracks = tracksArr.map((t) => ({
      name: t.name || "",
      artist:
        t.artist?.name ||
        t.artist?.["#text"] ||
        "",
      playcount: Number(t.playcount) || 0,
      image: pickImage(t.image)
    }));

    const topArtists = artistsArr.map((a) => ({
      name: a.name || "",
      playcount: Number(a.playcount) || 0,
      image: pickImage(a.image)
    }));

    const periodLabel = PERIOD_LABELS[safePeriod] || "past while";

    const response =
      safePeriod === "overall"
        ? {
            // overall case
            username,
            period: safePeriod,
            periodLabel,
            since,                     // { month, year }
            totalScrobbles: totalScrobblesOverall,
            totalArtists: totalArtistsPeriod,
            topTracks: topTracks.slice(0, 5),
            topArtists: topArtists.slice(0, 5)
          }
        : {
            // non-overall case
            username,
            period: safePeriod,
            periodLabel,
            totalScrobbles: totalScrobblesPeriod,
            totalArtists: totalArtistsPeriod,
            topTracks: topTracks.slice(0, 10),
            topArtists: topArtists.slice(0, 5)
          };

    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json(response);
  } catch (e) {
    console.error("wrapped core error", e);
    return res.status(500).json({ error: "wrapped_failed" });
  }
}
