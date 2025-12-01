// api/wrapped.js

const ALLOWED_ORIGINS = [
  "https://your-main-site.example",     // replace with your main site
  "https://lastfm-lab.vercel.app"      // keep or adjust for the lab UI
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
  // registered like "2002-11-20 11:50" with unixtime attr[web:337]
  if (!registered) return null;
  const parts = (registered["#text"] || "").split(" ")[0]?.split("-") || [];
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
  const fallbackOrder = ["large","medium","small"];
  for (const size of fallbackOrder) {
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

  const safePeriod =
    ["7day","1month","3month","6month","12month","overall"].includes(period)
      ? period
      : "3month";

  const base = "https://ws.audioscrobbler.com/2.0/";
  const params = (extra) =>
    `${base}?${extra}&api_key=${API_KEY}&format=json`;

  const topTracksUrl  = params(
    `method=user.getTopTracks&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=50`
  ); // [web:323][web:326]
  const topArtistsUrl = params(
    `method=user.getTopArtists&user=${encodeURIComponent(username)}&period=${safePeriod}&limit=50`
  ); // [web:324]
  const userInfoUrl   = params(
    `method=user.getInfo&user=${encodeURIComponent(username)}`
  ); // [web:335][web:337]

  try {
    // fetch in parallel
    const [tracksRes, artistsRes, userRes] = await Promise.all([
      fetch(topTracksUrl),
      fetch(topArtistsUrl),
      fetch(userInfoUrl)
    ]);

    const [tracksJson, artistsJson, userJson] = await Promise.all([
      tracksRes.json(),
      artistsRes.json(),
      userRes.json()
    ]);

    const tracksArr = tracksJson.toptracks?.track || [];
    const artistsArr = artistsJson.topartists?.artist || [];

    // ----- total scrobbles (approx from top tracks) -----
    let totalScrobbles = 0;
    for (const t of tracksArr) {
      const pc = Number(t.playcount) || 0;
      totalScrobbles += pc;
    }

    // ----- top track -----
    const topTrackRaw = tracksArr[0];
    const topTrack = topTrackRaw
      ? {
          name: topTrackRaw.name || "",
          artist:
            topTrackRaw.artist?.name ||
            topTrackRaw.artist?.["#text"] ||
            "",
          playcount: Number(topTrackRaw.playcount) || 0,
          image: pickImage(topTrackRaw.image)
        }
      : null;

    // ----- top artist -----
    const topArtistRaw = artistsArr[0];
    const topArtist = topArtistRaw
      ? {
          name: topArtistRaw.name || "",
          playcount: Number(topArtistRaw.playcount) || 0,
          image: pickImage(topArtistRaw.image)
        }
      : null;

    // ----- topTracks list (up to 10) -----
    const topTracks = tracksArr.slice(0, 10).map((t) => ({
      name: t.name || "",
      artist:
        t.artist?.name ||
        t.artist?.["#text"] ||
        "",
      playcount: Number(t.playcount) || 0
    }));

    // ----- topArtists list (up to 5) -----
    const topArtists = artistsArr.slice(0, 5).map((a) => ({
      name: a.name || "",
      playcount: Number(a.playcount) || 0
    }));

    // ----- topGenres via artist.getTopTags on top few artists -----
    const topGenreMap = {};
    const tagPromises = artistsArr.slice(0, 8).map(async (a) => {
      const artistName = encodeURIComponent(a.name);
      const url = params(
        `method=artist.getTopTags&artist=${artistName}`
      ); // [web:340]
      try {
        const r = await fetch(url);
        const j = await r.json();
        const tags = j.toptags?.tag || [];
        for (const tag of tags.slice(0, 5)) {
          const name = (tag.name || "").toLowerCase();
          if (!name) continue;
          const count = Number(tag.count) || 1;
          topGenreMap[name] = (topGenreMap[name] || 0) + count;
        }
      } catch (e) {
        // ignore individual tag errors
      }
    });

    await Promise.all(tagPromises);

    const topGenres = Object.entries(topGenreMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const totalTagWeight =
      topGenres.reduce((sum, [, w]) => sum + w, 0) || 1;

    const topGenresNorm = topGenres.map(([name, weight]) => ({
      name,
      weight: weight / totalTagWeight
    }));

    // ----- period label -----
    const baseLabel = PERIOD_LABELS[safePeriod] || "past while";

    // ----- user since (for overall) -----
    let since = null;
    if (safePeriod === "overall") {
      const registered = userJson.user?.registered;
      since = monthYearFromRegistered(registered);
    }

    const response = {
      username,
      period: safePeriod,
      periodLabel: baseLabel,
      since, // null unless overall
      totalScrobbles,

      topTrack,
      topArtist,
      topGenres: topGenresNorm,
      topTracks,
      topArtists
    };

    res.setHeader("Cache-Control", "s-maxage=300"); // cache 5 minutes
    return res.status(200).json(response);
  } catch (e) {
    console.error("wrapped error", e);
    return res.status(502).json({ error: "wrapped_failed" });
  }
}
