// Last.fm "recently played" SVG card for Vercel. Wide soft-blue card with your username.
// Env vars: LASTFM_USERNAME, LASTFM_API_KEY
// Optional URL params: username, background_color, text_color, accent_color (hex, no #),
//                      recent=1..8 (how many tracks to list, default 5),
//                      fresh=1 (skip all caching, always the live data)
// Status: playing -> NOW LISTENING | otherwise -> NOT LISTENING
// Album art: Last.fm first; if it has none, iTunes and Deezer are tried at the same time.

const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's default grey star
const LASTFM_TIMEOUT_MS = 4000;
const ART_TIMEOUT_MS = 2000;
const ART_TOTAL_MS = 2500; // hard cap on all art lookups together, so the card never stalls
const MEMO_MS = 5000;
const DEFAULT_RECENT = 5;
const MAX_RECENT = 8;

// Layout
const W = 480;
const HEADER_H = 50;
const ROW_H = 52;
const PAD = 18;
const THUMB = 38;

const DEFAULT_BG = "#3d5c8c";
const GRAD_FROM = "#4a74b0";
const GRAD_TO = "#2f4c7a";
const DEFAULT_ACCENT = "#b9cdea";
const DEFAULT_TEXT = "#f2f6fc";
const ONLINE_DOT = "#6ee7a0";
const IDLE_DOT = "#9aa9c0";

const CACHE_FAST = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";
const CACHE_LIVE = "no-store, no-cache, max-age=0, must-revalidate";

const lastGood = new Map(); // user -> last good result, shown if Last.fm hiccups

const artCache = new Map(); // "artist|title" -> data URI
const memo = new Map(); // "user|n" -> { ts, data }
const inflight = new Map(); // "user|n" -> Promise

const capped = (map, k, v, max) => {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(k, v);
};

const ESC = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ESC[c]);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hex = (v, fallback) => (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v || "") ? "#" + v : fallback);
const norm = (h) => (!h ? null : h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h.slice(0, 7));

const ago = (uts) => {
  if (!uts) return "";
  const s = Math.max(0, Date.now() / 1000 - uts);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  return Math.floor(s / (86400 * 30)) + "mo ago";
};

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
  return toDataUri(u);
}

async function deezerArt(artist, title) {
  const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  const r = await get(`https://api.deezer.com/search?q=${q}&limit=1`, ART_TIMEOUT_MS);
  const j = await r.json();
  const a = j.data && j.data[0] && j.data[0].album;
  const u = a && (a.cover_small || a.cover_medium || a.cover);
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
    art = await Promise.any([itunesArt(artist, title), deezerArt(artist, title)]).catch(() => null);
  }
  if (art) capped(artCache, key, art, 60);
  return art;
}

const artistOf = (t) => (t.artist && (t.artist["#text"] || t.artist.name)) || "";

// One trip to Last.fm. Returns { ok, message?, tracks: [{ title, artist, uts, playing, art }] }.
async function loadTracks(user, key, n) {
  const api =
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&limit=${n}&format=json` +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
  const data = await (await get(api, LASTFM_TIMEOUT_MS)).json();

  if (data && data.error) {
    return { ok: false, message: "Last.fm error " + data.error, detail: String(data.message || ""), tracks: [] };
  }

  let list = data && data.recenttracks && data.recenttracks.track;
  if (list && !Array.isArray(list)) list = [list];
  if (!list || !list.length) return { ok: true, message: "Nothing yet", detail: "No tracks scrobbled", tracks: [] };

  list = list.slice(0, n);
  const tracks = list.map((t) => {
    const imgs = Array.isArray(t.image) ? t.image : [];
    const pick = imgs.find((i) => i.size === "medium") || imgs.find((i) => i.size === "large") || imgs[imgs.length - 1];
    return {
      title: t.name || "Unknown",
      artist: artistOf(t),
      playing: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
      uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
      artUrl: pick ? pick["#text"] : "",
      art: null,
    };
  });

  // All art lookups run in parallel under one overall time cap.
  await Promise.all(
    tracks.map((tr) =>
      Promise.race([
        findArt(tr.artUrl, tr.artist, tr.title).then((a) => (tr.art = a)).catch(() => null),
        new Promise((done) => setTimeout(done, ART_TOTAL_MS)),
      ])
    )
  );
  tracks.forEach((tr) => delete tr.artUrl);
  return { ok: true, tracks };
}

function getTracks(user, key, n, fresh) {
  const k = `${user}|${n}`;
  const m = memo.get(k);
  if (!fresh && m && Date.now() - m.ts < MEMO_MS) return Promise.resolve(m.data);
  if (inflight.has(k)) return inflight.get(k);

  const p = loadTracks(user, key, n)
    .then((data) => {
      capped(memo, k, { ts: Date.now(), data }, 20);
      return data;
    })
    .finally(() => inflight.delete(k));
  capped(inflight, k, p, 20);
  return p;
}

// Animated equalizer for the row that is playing right now. cy = vertical center.
const bars = (cy) =>
  [0, 1, 2, 3]
    .map((i) => {
      const dur = (0.9 + i * 0.15).toFixed(2);
      const b = cy + 8;
      return (
        `<rect x="${W - PAD - 26 + i * 7}" y="${b - 4}" width="4" height="4" class="a">` +
        `<animate attributeName="height" values="4;16;6;12;4" dur="${dur}s" repeatCount="indefinite"/>` +
        `<animate attributeName="y" values="${b - 4};${b - 16};${b - 6};${b - 12};${b - 4}" dur="${dur}s" repeatCount="indefinite"/>` +
        `</rect>`
      );
    })
    .join("");

module.exports = async (req, res) => {
  const q = req.query;
  const user = q.username || process.env.LASTFM_USERNAME;
  const key = process.env.LASTFM_API_KEY;

  const bg = hex(q.background_color, DEFAULT_BG);
  const bgFill = q.background_color ? bg : "url(#g)";
  const accent = norm(hex(q.accent_color || q.bar_color, DEFAULT_ACCENT));
  const text = norm(hex(q.text_color, DEFAULT_TEXT));

  const asked = q.recent === undefined ? DEFAULT_RECENT : parseInt(q.recent, 10);
  const n = Math.min(MAX_RECENT, Math.max(1, Number.isNaN(asked) ? DEFAULT_RECENT : asked));

  let data;
  let fellBack = false;
  try {
    data = await getTracks(user, key, n, q.fresh === "1");
    if (data.ok && data.tracks.length) capped(lastGood, user, data, 20);
  } catch (e) {
    fellBack = true;
    const prev = lastGood.get(user);
    if (prev) {
      data = { ...prev, tracks: prev.tracks.map((t) => ({ ...t, playing: false })) };
    } else {
      data = {
        ok: false,
        message: e && e.name === "TimeoutError" ? "Last.fm is slow" : "Couldn't reach Last.fm",
        detail: "Refresh in a moment",
        tracks: [],
      };
    }
  }

  const tracks = data.tracks || [];
  const first = tracks[0];

  // Status: playing / not listening
  let status = "";
  let dot = IDLE_DOT;
  if (first) {
    if (first.playing) {
      status = "NOW LISTENING";
      dot = ONLINE_DOT;
    } else {
      status = "NOT LISTENING";
    }
  }

  const F = `font-family="-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"`;
  const label = (cls, x, y, size, weight, body, extra = "") =>
    `<text class="${cls}" x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}"${extra}>${body}</text>`;

  // Header: wordmark + status on the left, username on the right.
  let out =
    label("a", PAD, 31, 17, 800, "last.fm", ' letter-spacing="-0.3"') +
    (status
      ? `<circle cx="${PAD + 80}" cy="26.5" r="3.5" fill="${dot}"/>` +
        label("s", PAD + 90, 31, 11, 700, status, ' letter-spacing="1.1"')
      : label("s", PAD + 80, 31, 12, 400, "Recently Played")) +
    label("t", W - PAD, 31, 13, 600, esc(clip(user || "unknown", 24)), ' text-anchor="end"');

  out += `<line x1="${PAD}" y1="${HEADER_H}" x2="${W - PAD}" y2="${HEADER_H}" stroke="#ffffff" stroke-opacity="0.18"/>`;

  const defs = [];
  let rows = "";

  if (!tracks.length) {
    // Error / empty state: one message row
    const y = HEADER_H + 8;
    rows +=
      `<rect x="${PAD}" y="${y + 7}" width="${THUMB}" height="${THUMB}" rx="6" fill="#ffffff" fill-opacity="0.2"/>` +
      label("t", PAD + THUMB + 14, y + 25, 14, 700, esc(clip(data.message || "Nothing yet", 40))) +
      label("s", PAD + THUMB + 14, y + 42, 12, 400, esc(clip(data.detail || "", 48)));
  } else {
    tracks.forEach((tr, i) => {
      const y0 = HEADER_H + 8 + i * ROW_H;
      const cy = y0 + ROW_H / 2 - 4;
      const ty = y0 + 7;
      defs.push(`<clipPath id="c${i}"><rect x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" rx="6"/></clipPath>`);
      const thumb = tr.art
        ? `<g clip-path="url(#c${i})"><image href="${tr.art}" x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" preserveAspectRatio="xMidYMid slice"/></g>`
        : `<rect x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" rx="6" fill="#ffffff" fill-opacity="0.2"/>`;
      if (i > 0) {
        rows += `<line x1="${PAD}" y1="${y0 - 4}" x2="${W - PAD}" y2="${y0 - 4}" stroke="#ffffff" stroke-opacity="0.1"/>`;
      }
      rows +=
        thumb +
        label("t", PAD + THUMB + 14, y0 + 23, 14, i === 0 ? 700 : 600, esc(clip(tr.title, 36))) +
        label("s", PAD + THUMB + 14, y0 + 40, 12, 400, esc(clip(tr.artist, 42))) +
        (tr.playing ? bars(cy) : label("s", W - PAD, y0 + 27, 11, 400, esc(ago(tr.uts)), ' text-anchor="end"'));
    });
  }

  const count = Math.max(1, tracks.length);
  const height = HEADER_H + 8 + count * ROW_H + 6;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" text-rendering="geometricPrecision">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${GRAD_FROM}"/><stop offset="1" stop-color="${GRAD_TO}"/>` +
    `</linearGradient>${defs.join("")}</defs>` +
    `<style>.a{fill:${accent}}.t{fill:${text}}.s{fill:${text};fill-opacity:.8}</style>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="${bgFill}" stroke="#ffffff" stroke-opacity="0.18"/>` +
    out +
    rows +
    `</svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", q.fresh === "1" || fellBack || !data.ok ? CACHE_LIVE : CACHE_FAST);
  res.status(200).send(svg);
};
