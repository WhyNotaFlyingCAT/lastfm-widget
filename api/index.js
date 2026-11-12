// Last.fm "now playing" SVG card for Vercel. Soft blue card, tuned for speed.
// Env vars: LASTFM_USERNAME, LASTFM_API_KEY
// Optional URL params: username, background_color, text_color, accent_color (hex, no #),
//                      fresh=1 (skip all caching, always the live track)
// Album art: Last.fm first; if it has none, iTunes and Deezer are tried at the same time.

const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's default grey star
const LASTFM_TIMEOUT_MS = 4000;
const ART_TIMEOUT_MS = 2000;
const ART_TOTAL_MS = 2500; // hard cap on all art lookups together, so the card never stalls
const MEMO_MS = 5000; // reuse the same Last.fm answer for a few seconds (bursts of views)

const DEFAULT_BG = "#3d5c8c";
const GRAD_FROM = "#4a74b0"; // gradient: lighter blue (top-left)
const GRAD_TO = "#2f4c7a"; // gradient: deeper blue (bottom-right)
const DEFAULT_ACCENT = "#b9cdea";
const DEFAULT_TEXT = "#f2f6fc";

// Normal mode: Vercel's edge serves the card instantly and refreshes it in the background.
// The browser still asks the edge every time (max-age=0), so a new song shows up within ~10-30s.
const CACHE_FAST = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";
const CACHE_LIVE = "no-store, no-cache, max-age=0, must-revalidate";

const lastGood = new Map(); // user -> last good track, shown if Last.fm hiccups

const artCache = new Map(); // "artist|title" -> data URI
const memo = new Map(); // user -> { ts, track }
const inflight = new Map(); // user -> Promise (so simultaneous views share one request)

const capped = (map, k, v, max) => {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(k, v);
};

const ESC = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ESC[c]);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hex = (v, fallback) => (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v || "") ? "#" + v : fallback);
const norm = (h) => (!h ? null : h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h.slice(0, 7));

const get = (url, ms) => fetch(url, { signal: AbortSignal.timeout(ms) });

async function toDataUri(url) {
  const r = await get(url, ART_TIMEOUT_MS);
  if (!r.ok) throw new Error("bad image");
  const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
  const type = /^image\/[\w.+-]+$/.test(ct) ? ct : "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

async function itunesArt(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const r = await get(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`, ART_TIMEOUT_MS);
  const j = await r.json();
  const u = j.results && j.results[0] && j.results[0].artworkUrl100;
  if (!u) throw new Error("no itunes art");
  return toDataUri(u.replace("100x100", "200x200"));
}

async function deezerArt(artist, title) {
  const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  const r = await get(`https://api.deezer.com/search?q=${q}&limit=1`, ART_TIMEOUT_MS);
  const j = await r.json();
  const a = j.data && j.data[0] && j.data[0].album;
  const u = a && (a.cover_medium || a.cover);
  if (!u) throw new Error("no deezer art");
  return toDataUri(u);
}

async function findArt(lastfmUrl, artist, title) {
  const key = `${artist}|${title}`;
  if (artCache.has(key)) return artCache.get(key);

  let art = null;
  if (lastfmUrl && !lastfmUrl.includes(PLACEHOLDER_ID)) {
    try {
      art = await toDataUri(lastfmUrl);
    } catch {}
  }
  if (!art && (artist || title)) {
    // Both fallbacks run at the same time; the first one with art wins.
    art = await Promise.any([itunesArt(artist, title), deezerArt(artist, title)]).catch(() => null);
  }
  if (art) capped(artCache, key, art, 40); // failures are retried next time
  return art;
}

// One trip to Last.fm. Returns { ok, title, artist, playing, art }.
async function loadTrack(user, key) {
  const api =
    "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&limit=1&format=json" +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
  const data = await (await get(api, LASTFM_TIMEOUT_MS)).json();

  if (data && data.error) {
    return { ok: false, title: "Last.fm error " + data.error, artist: String(data.message || ""), playing: false, art: null, isTrack: false };
  }

  let t = data && data.recenttracks && data.recenttracks.track;
  if (Array.isArray(t)) t = t[0];
  if (!t) return { ok: true, title: "Nothing yet", artist: "", playing: false, art: null, isTrack: false };

  const title = t.name || "Nothing yet";
  const artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
  const playing = !!(t["@attr"] && t["@attr"].nowplaying === "true");
  const imgs = Array.isArray(t.image) ? t.image : [];
  const pick = imgs.find((i) => i.size === "large") || imgs[imgs.length - 1];
  const art = await Promise.race([
    findArt(pick ? pick["#text"] : "", artist, title),
    new Promise((done) => setTimeout(() => done(null), ART_TOTAL_MS)),
  ]);
  return { ok: true, title, artist, playing, art, isTrack: true };
}

// Short memory + sharing of simultaneous requests.
function getTrack(user, key, fresh) {
  const m = memo.get(user);
  if (!fresh && m && Date.now() - m.ts < MEMO_MS) return Promise.resolve(m.track);
  if (inflight.has(user)) return inflight.get(user);

  const p = loadTrack(user, key)
    .then((track) => {
      capped(memo, user, { ts: Date.now(), track }, 20);
      return track;
    })
    .finally(() => inflight.delete(user));
  capped(inflight, user, p, 20);
  return p;
}

// Equalizer bars never change, so build them once.
const BARS = [0, 1, 2, 3]
  .map((i) => {
    const dur = (0.9 + i * 0.15).toFixed(2);
    return (
      `<rect x="${268 + i * 7}" y="78" width="4" height="4" class="a">` +
      `<animate attributeName="height" values="4;16;6;12;4" dur="${dur}s" repeatCount="indefinite"/>` +
      `<animate attributeName="y" values="86;74;84;78;86" dur="${dur}s" repeatCount="indefinite"/>` +
      `</rect>`
    );
  })
  .join("");

module.exports = async (req, res) => {
  const q = req.query;
  const user = q.username || process.env.LASTFM_USERNAME;
  const key = process.env.LASTFM_API_KEY;

  const bg = hex(q.background_color, DEFAULT_BG);
  const bgFill = q.background_color ? bg : "url(#g)"; // gradient unless a color is passed
  const accent = norm(hex(q.accent_color || q.bar_color, DEFAULT_ACCENT));
  const text = norm(hex(q.text_color, DEFAULT_TEXT));

  let track;
  let fellBack = false;
  try {
    track = await getTrack(user, key, q.fresh === "1");
    if (track.ok) capped(lastGood, user, track, 20);
  } catch (e) {
    fellBack = true;
    const prev = lastGood.get(user);
    if (prev) {
      track = { ...prev, playing: false };
    } else {
      track = {
        title: e && e.name === "TimeoutError" ? "Last.fm is slow" : "Couldn't reach Last.fm",
        artist: "Refresh in a moment",
        playing: false,
        art: null,
        isTrack: false,
      };
    }
  }

  const { title, artist, playing, art, isTrack } = track;
  const F = `font-family="-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"`;
  const label = (cls, y, size, weight, body, extra = "") =>
    `<text class="${cls}" x="104" y="${y}" ${F} font-size="${size}" font-weight="${weight}"${extra}>${body}</text>`;
  const t = esc(clip(title, 22));
  const a = esc(clip(artist, 24));
  const status = playing ? "NOW LISTENING" : isTrack ? "LAST PLAYED" : "LAST.FM";
  const labels =
    label("a", 32, 10, 700, status, ' letter-spacing="1.2"') +
    label("t", 54, 16, 700, t) +
    label("s", 74, 12.5, 400, a);
  const artEl = art
    ? `<image href="${art}" x="10" y="10" width="80" height="80" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="10" y="10" width="80" height="80" rx="6" fill="#ffffff" fill-opacity="0.25"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100" text-rendering="geometricPrecision">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${GRAD_FROM}"/><stop offset="1" stop-color="${GRAD_TO}"/>` +
    `</linearGradient></defs>` +
    `<style>.a{fill:${accent}}.t{fill:${text}}.s{fill:${text};fill-opacity:.85}</style>` +
    `<rect x="0.5" y="0.5" width="299" height="99" rx="12" fill="${bgFill}" stroke="#ffffff" stroke-opacity="0.18"/>` +
    `<clipPath id="c"><rect x="10" y="10" width="80" height="80" rx="6"/></clipPath>` +
    `<g clip-path="url(#c)">${artEl}</g>` +
    labels +
    (playing ? BARS : "") +
    `</svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  // Errors and fresh=1 are never cached; everything else is served from the edge.
  res.setHeader("Cache-Control", q.fresh === "1" || fellBack || !track.ok ? CACHE_LIVE : CACHE_FAST);
  res.status(200).send(svg);
};
