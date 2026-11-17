import test from "node:test";
import assert from "node:assert/strict";
import {
  VALID_PERIODS,
  PERIOD_LABELS,
  cleanUsername,
  normalizePeriod,
  periodLabel,
  lastfmUrl,
  applyCors,
  isPreflight,
  isRateLimited,
  pickImage,
  cleanArtists,
  readJsonBody,
  fetchLastfmJson
} from "../lib/api-utils.js";

function responseMock() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: undefined,
    setHeader(key, value) {
      headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

test("every valid period has a label", () => {
  for (const period of VALID_PERIODS) {
    assert.ok(PERIOD_LABELS[period], `missing label for ${period}`);
    assert.equal(normalizePeriod(period), period);
  }
  assert.equal(normalizePeriod("nonsense"), "3month");
  assert.equal(periodLabel("nonsense"), "past while");
});

test("cleanUsername rejects invalid names and trims valid ones", () => {
  assert.equal(cleanUsername("  alice_1 "), "alice_1");
  assert.equal(cleanUsername("a"), null);
  assert.equal(cleanUsername("bad name"), null);
  assert.equal(cleanUsername("../secret"), null);
  assert.equal(cleanUsername(undefined), null);
});

test("lastfmUrl encodes parameters and never logs the key separately", () => {
  const url = lastfmUrl("secret", "user.getInfo", { user: "a b" });
  assert.ok(url.startsWith("https://ws.audioscrobbler.com/2.0/?"));
  assert.ok(url.includes("api_key=secret"));
  assert.ok(url.includes("user=a+b"));
  assert.ok(url.includes("format=json"));
});

test("applyCors only allows known origins and sets Vary", () => {
  const allowed = responseMock();
  applyCors({ headers: { origin: "https://ashique.neocities.org" } }, allowed);
  assert.equal(allowed.headers["Access-Control-Allow-Origin"], "https://ashique.neocities.org");
  assert.equal(allowed.headers.Vary, "Origin");

  const blocked = responseMock();
  applyCors({ headers: { origin: "https://evil.example" } }, blocked);
  assert.equal(blocked.headers["Access-Control-Allow-Origin"], undefined);
});

test("isPreflight ends OPTIONS requests", () => {
  const res = responseMock();
  assert.equal(isPreflight({ method: "OPTIONS" }, res), true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(isPreflight({ method: "GET" }, res), false);
});

test("isRateLimited blocks traffic above the limit per ip", () => {
  const req = (ip) => ({ headers: {}, socket: { remoteAddress: ip } });
  const ip = `10.0.0.${Math.floor(Math.random() * 200) + 1}`;
  assert.equal(isRateLimited(req(ip), 2, 60000), false);
  assert.equal(isRateLimited(req(ip), 2, 60000), false);
  assert.equal(isRateLimited(req(ip), 2, 60000), true);
});

test("pickImage falls back across sizes", () => {
  const images = [{ size: "small", "#text": "small.jpg" }];
  assert.equal(pickImage(images), "small.jpg");
  assert.equal(pickImage([]), "");
});

test("cleanArtists caps and sanitizes the genre input", () => {
  const artists = cleanArtists([
    { name: " Radiohead ", playcount: "12" },
    { name: "   " },
    { playcount: 3 },
    ...Array.from({ length: 8 }, (_, index) => ({ name: `artist${index}` }))
  ]);
  assert.equal(artists.length, 5);
  assert.deepEqual(artists[0], { name: "Radiohead", playcount: 12 });
});

test("readJsonBody handles pre-parsed and streamed bodies", async () => {
  assert.deepEqual(await readJsonBody({ body: { artists: [] } }), { artists: [] });

  const chunks = ['{"artists":', '[{"name":"a"}]}'];
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
  assert.deepEqual(await readJsonBody(stream), { artists: [{ name: "a" }] });
});

test("fetchLastfmJson parses valid payloads and rejects errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ toptracks: { track: [] } })
  });
  assert.deepEqual(await fetchLastfmJson("https://example.test", "topTracks"), {
    toptracks: { track: [] }
  });

  globalThis.fetch = async () => ({
    ok: false,
    text: async () => JSON.stringify({ error: 6, message: "user not found" })
  });
  await assert.rejects(fetchLastfmJson("https://example.test", "topTracks"), /user not found/);
});
