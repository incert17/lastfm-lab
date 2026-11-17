export const VALID_PERIODS = [
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall"
];

export const PERIOD_LABELS = {
  "7day": "last 7 days",
  "1month": "past month",
  "3month": "past 3 months",
  "6month": "past 6 months",
  "12month": "past year",
  "overall": "overall"
};

const DEFAULT_ORIGINS = [
  "https://ashique.neocities.org",
  "https://lastfm-lab.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173"
];

const requestCounts = new Map();

function configuredOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function applyCors(req, res, methods = "GET, OPTIONS") {
  const origin = req.headers?.origin || "";
  if (configuredOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export function isPreflight(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}

export function getApiKey(res) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "missing_api_key" });
    return null;
  }
  return apiKey;
}

export function cleanUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return /^[\w.-]{2,30}$/.test(username) ? username : null;
}

export function normalizePeriod(value) {
  return VALID_PERIODS.includes(value) ? value : "3month";
}

export function periodLabel(period) {
  return PERIOD_LABELS[period] || "past while";
}

export function lastfmUrl(apiKey, method, params = {}) {
  const search = new URLSearchParams({
    method,
    api_key: apiKey,
    format: "json",
    ...params
  });
  return `https://ws.audioscrobbler.com/2.0/?${search}`;
}

export async function fetchLastfmJson(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  if (!text) throw new Error(`${label}: empty response`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid response`);
  }

  if (!response.ok || json?.error) {
    throw new Error(`${label}: ${json?.message || `http ${response.status}`}`);
  }
  return json;
}

export async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isRateLimited(req, limit = 60, windowMs = 60000) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" && forwarded.split(",")[0].trim()) ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();

  if (requestCounts.size > 5000) {
    for (const [key, entry] of requestCounts) {
      if (entry.reset <= now) requestCounts.delete(key);
    }
  }

  const entry = requestCounts.get(ip);
  if (!entry || entry.reset <= now) {
    requestCounts.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

export function pickImage(images, preferred = "extralarge") {
  if (!Array.isArray(images)) return "";
  const usable = (image) => image && typeof image["#text"] === "string" && image["#text"];
  const exact = images.find((image) => image.size === preferred && usable(image));
  if (exact) return exact["#text"];
  for (const size of ["large", "medium", "small"]) {
    const fallback = images.find((image) => image.size === size && usable(image));
    if (fallback) return fallback["#text"];
  }
  return "";
}

export function cleanArtists(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((artist) => artist && typeof artist.name === "string")
    .map((artist) => ({
      name: artist.name.trim().slice(0, 100),
      playcount: Math.max(1, Number(artist.playcount) || 1)
    }))
    .filter((artist) => artist.name)
    .slice(0, 5);
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 16384) throw new Error("body too large");
  }
  return JSON.parse(data || "{}");
}
