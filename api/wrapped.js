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
    console.error("wrapped: LASTFM_API_KEY is missing");
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
    `method=user.getTopArtists&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=10`
  ); // [web:324]
  const userInfoUrl   = params(
    `method=user.getInfo&user=${encodeURIComponent(username)}`
  ); // [web:337][web:335] (for logging / potential future use)

  console.log("wrapped: starting", {
    username,
    period: safePeriod,
    topTracksUrl,
    topArtistsUrl,
    userInfoUrl
  });

  try {
    const [tracksRes, artistsRes, userRes] = await Promise.all([
      fetch(topTracksUrl),
      fetch(topArtistsUrl),
      fetch(userInfoUrl)
    ]);

    console.log("wrapped: response statuses", {
      tracks: tracksRes.status,
      artists: artistsRes.status,
      user: userRes.status
    });

    async function safeJson(name, r) {
      try {
        const txt = await r.text();
        if (!txt) {
          console.warn(`wrapped: empty body from ${name}`);
          return {};
        }
        let j;
        try {
          j = JSON.parse(txt);
        } catch (parseErr) {
          console.error(`wrapped: JSON parse error from ${name}`, parseErr, txt.slice(0, 200));
          return {};
        }
        if (j && j.error) {
          console.error(`wrapped: logical error from ${name}`, j);
          return {};
        }
        return j || {};
      } catch (err) {
        console.error(`wrapped: safeJson failed for ${name}`, err);
        return {};
      }
    }

    const [tracksJson, artistsJson, userJson] = await Promise.all([
      safeJson("topTracks", tracksRes),
      safeJson("topArtists", artistsRes),
      safeJson("userInfo", userRes)
    ]);

    console.log("wrapped: shapes", {
      hasTracks: !!tracksJson.toptracks,
      hasArtists: !!artistsJson.topartists,
      hasUser: !!userJson.user
    });

    const tracksArr  = tracksJson.toptracks?.track || [];
    const artistsArr = artistsJson.topartists?.artist || [];

    // ----- totals from @attr -----
    const tracksAttr  = tracksJson.toptracks?.["@attr"] || {};
    const artistsAttr = artistsJson.topartists?.["@attr"] || {};

    const totalTracksDistinct  =
      Number(tracksAttr.total)  || tracksArr.length || 0;   // distinct tracks in period[web:323][web:326]
    const totalArtistsDistinct =
      Number(artistsAttr.total) || artistsArr.length || 0;   // distinct artists in period[web:324][web:323]

    // ----- top tracks / artists arrays -----
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

    const response = {
      username,
      period: safePeriod,
      periodLabel,
      totalScrobbles: totalTracksDistinct,
      totalArtists: totalArtistsDistinct,
      topTracks: topTracks.slice(0, 10),
      topArtists: topArtists.slice(0, 5)
    };

    console.log("wrapped: success summary", {
      totalScrobbles: response.totalScrobbles,
      totalArtists: response.totalArtists,
      tracksReturned: response.topTracks.length,
      artistsReturned: response.topArtists.length
    });

    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json(response);
  } catch (e) {
    console.error("wrapped core error", e);
    if (!res.headersSent) {
      return res.status(500).json({ error: "wrapped_failed" });
    }
  }
}
