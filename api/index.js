// Last.fm "recently played" SVG card for Vercel. Wide soft-blue card with your username.
// Env vars: LASTFM_USERNAME, LASTFM_API_KEY
// Optional URL params: username, background_color, text_color, accent_color (hex, no #),
//                      recent=1..8 (how many tracks to list, default 5),
//                      loved_color (hex, no #), loved=0 (hide the hearts on loved tracks),
//                      theme=ocean|sakura|miku|mint|sunset|midnight|dark (whole palette in one word),
//                      art_bg=1 (blurred album art of the top track as the card background),
//                      anim=0 (turn off the fade-in of the rows),
//                      scrobbles=0 (hide the scrobble count shown in the header when idle),
//                      marquee=0 (don't scroll long titles, cut them with "…" instead),
//                      fresh=1 (skip all caching, always the live data)
// Status: playing -> NOW LISTENING | otherwise -> NOT LISTENING + total scrobbles
// Album art: Last.fm first; if it has none, iTunes and Deezer are tried at the same time.
// Header: Last.fm logo on the left, profile picture + username on the right.

const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's default grey star (album art)
const AVATAR_PLACEHOLDER_ID = "818148bf682d429dc215c1705eb27b98"; // Last.fm's default profile picture
const LASTFM_TIMEOUT_MS = 4000;
const ART_TIMEOUT_MS = 2000;
const ART_TOTAL_MS = 2500; // hard cap on all art lookups together, so the card never stalls
const MEMO_MS = 5000;
const PROFILE_TTL_MS = 60 * 60 * 1000; // profile picture + scrobble count: keep for an hour
const DEFAULT_RECENT = 5;
const MAX_RECENT = 8;

// Layout
const W = 480;
const HEADER_H = 50;
const ROW_H = 52;
const PAD = 18;
const THUMB = 38;
const BOTTOM_PAD = 8; // extra space under the last row so the bottom matches the top

// Header pieces
// Official Last.fm wordmark (paths from the Last.fm logo SVG, viewBox 708.767 x 179.332).
const LOGO_VB_W = 708.767;
const LOGO_VB_H = 179.332;
const LOGO_H = 22; // logo height on the card
const LOGO_SCALE = LOGO_H / LOGO_VB_H;
const LOGO_W = Math.round(LOGO_VB_W * LOGO_SCALE); // so the status text can start right after it
const LOGO_PATHS = [
  "M158.431,165.498l-8.354-22.708c0,0-13.575,15.14-33.932,15.14c-18.013,0-30.802-15.662-30.802-40.721 c0-32.106,16.182-43.591,32.107-43.591c22.969,0,30.277,14.878,36.543,33.934l8.354,26.103 c8.351,25.318,24.013,45.678,69.17,45.678c32.37,0,54.295-9.918,54.295-36.02c0-21.143-12.009-32.107-34.458-37.328l-16.705-3.654 c-11.484-2.61-14.877-7.309-14.877-15.14c0-8.875,7.046-14.096,18.533-14.096c12.529,0,19.315,4.699,20.36,15.923l26.102-3.133 c-2.088-23.492-18.271-33.15-44.896-33.15c-23.491,0-46.462,8.875-46.462,37.327c0,17.75,8.614,28.975,30.277,34.195l17.752,4.175 c13.312,3.133,17.748,8.614,17.748,16.185c0,9.656-9.396,13.572-27.146,13.572c-26.364,0-37.325-13.834-43.591-32.89l-8.614-26.101 c-10.961-33.934-28.452-46.463-63.169-46.463c-38.37,0-58.731,24.275-58.731,65.517c0,39.677,20.361,61.08,56.906,61.08 C144.333,179.332,158.431,165.498,158.431,165.498L158.431,165.498z",
  "M46.726,153.229c-2.61,0.784-5.221,1.306-8.614,1.306c-6.265,0-10.703-2.87-10.703-10.442V1.827H0v148.792 c0,19.577,13.575,27.672,29.497,27.672c5.221,0,10.181-0.785,16.446-2.349L46.726,153.229L46.726,153.229z",
  "M376.911,149.053c-6.787,4.701-12.529,7.051-20.36,7.051c-9.92,0-15.401-5.221-15.401-18.012V77.006h36.023V55.603H341.41 V26.625l-27.669,3.394v25.583h-17.49v21.403h17.49v66.826c0,24.02,13.834,35.5,36.284,35.5c12.269,0,23.232-2.346,31.847-7.305 L376.911,149.053L376.911,149.053z",
  "M400.718,158.449c0,10.705,8.354,19.318,19.056,19.318c11.226,0,19.578-8.613,19.578-19.318 c0-10.963-8.353-19.313-19.578-19.313C409.072,139.136,400.718,147.486,400.718,158.449L400.718,158.449z",
  "M467.727,77.006v99.195h27.409V77.006h30.803V55.603h-30.803V44.638c0-16.444,7.049-21.665,18.534-21.665 c8.092,0,13.574,1.825,19.839,5.221l4.437-22.974C530.638,1.827,522.023,0,511.582,0c-22.973,0-43.855,10.963-43.855,43.593v12.01 h-17.489v21.403H467.727L467.727,77.006z",
  "M635.154,79.358c-3.133-19.578-15.923-26.629-32.63-26.629c-16.706,0-31.062,7.571-37.329,26.104l-3.393-23.23h-22.188 v120.598h27.409v-68.129c0-23.235,12.008-32.11,24.799-32.11c13.312,0,18.795,8.875,18.795,23.232v77.006h27.147v-68.39 c0-22.974,12.269-31.849,25.061-31.849c13.052,0,18.532,8.875,18.532,23.232v77.006h27.409V89.539 c0-25.843-15.14-36.81-35.24-36.81C656.561,52.729,641.419,60.3,635.154,79.358L635.154,79.358z",
];
const AV = 22; // profile picture diameter
const AV_GAP = 9; // space between profile picture and username
const NAME_CHAR_W = 7.4; // rough width of one username character at 13px

// Theme presets. Any single color param in the URL still overrides its part of the theme.
const THEMES = {
  ocean: { from: "#4a74b0", to: "#2f4c7a", accent: "#b9cdea", text: "#f2f6fc", dot: "#6ee7a0", loved: "#ff6b8b", glow: "#a9d2ff" },
  sakura: { from: "#c9729b", to: "#7d3f6b", accent: "#ffd1e3", text: "#fff5f9", dot: "#a6f0c6", loved: "#ffe27a", glow: "#ffc2dc" },
  miku: { from: "#2f9aa6", to: "#1b4a66", accent: "#c2f7f2", text: "#f0fffd", dot: "#d8ff7a", loved: "#ff7ab8", glow: "#7ff0e8" },
  mint: { from: "#3f9a8a", to: "#1f5a62", accent: "#c4f5e6", text: "#f1fffb", dot: "#d8ff7a", loved: "#ff8aa5", glow: "#9af0d8" },
  sunset: { from: "#e0735a", to: "#7a3470", accent: "#ffd9a8", text: "#fff7ef", dot: "#b5f5c8", loved: "#ffe27a", glow: "#ffb27a" },
  midnight: { from: "#232b4a", to: "#0f1426", accent: "#9db3ff", text: "#e9edff", dot: "#6ee7a0", loved: "#ff6b8b", glow: "#5468d8" },
  dark: { from: "#30343d", to: "#15171c", accent: "#b9cdea", text: "#eef1f6", dot: "#6ee7a0", loved: "#ff6b8b", glow: "#7d8cab" },
};
const IDLE_DOT = "#9aa9c0";
const HEART_PATH = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";
const HEART_SIZE = 13;
const HEART_X = W - PAD - 62 - HEART_SIZE; // fixed column for the heart: same x on every row, clear of the widest timestamp
const NOTE_PATH = "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"; // music note for tracks with no cover art

const CACHE_FAST = "public, max-age=0, s-maxage=10, stale-while-revalidate=20";
const CACHE_LIVE = "no-store, no-cache, max-age=0, must-revalidate";

const lastGood = new Map(); // user -> last good result, shown if Last.fm hiccups

const artCache = new Map(); // "artist|title" -> data URI
const profileCache = new Map(); // user -> { ts, uri, scrobbles }
const memo = new Map(); // "user|n" -> { ts, data }
const inflight = new Map(); // "user|n" -> Promise

const capped = (map, k, v, max) => {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(k, v);
};

const ESC = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" };
// Characters XML can't contain (control codes, lone surrogates) would make the whole SVG fail to render, so drop them.
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const esc = (s) => String(s).replace(BAD_XML, "").replace(/[<>&"']/g, (c) => ESC[c]);

// Rough text width in "units" (a typical lowercase letter = 1). Japanese/Chinese/Korean/emoji are about twice as wide,
// capitals and m/w are wider, thin letters like i and l are narrower. Used so long text is cut by width, not by character count.
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
const units = (ch) => {
  if (isWide(ch.codePointAt(0))) return 2;
  if (/[MWmw@]/.test(ch)) return 1.5;
  if (/[A-Z]/.test(ch)) return 1.25;
  if (/[ilj't.,:;!|()\[\]]/.test(ch)) return 0.55;
  return 1;
};
// Cut text to at most maxUnits wide, adding "…" when something was removed. Splits by whole characters (never half an emoji).
const clip = (s, maxUnits) => {
  const chars = Array.from(String(s));
  let used = 0;
  for (let i = 0; i < chars.length; i++) {
    used += units(chars[i]);
    if (used > maxUnits) {
      let keep = chars.slice(0, i);
      let u = keep.reduce((a, c) => a + units(c), 0);
      while (keep.length && u + 1 > maxUnits) u -= units(keep.pop());
      return keep.join("").trimEnd() + "…";
    }
  }
  return chars.join("");
};
const hex = (v, fallback) => (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v || "") ? "#" + v : fallback);
const norm = (h) => (!h ? null : h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h.slice(0, 7));

const ago = (uts) => {
  if (!uts) return "";
  const s = Math.max(0, Date.now() / 1000 - uts);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
  const months = Math.floor(s / (86400 * 30.44));
  if (months < 12) return months + "mo ago";
  return Math.floor(s / (86400 * 365.25)) + "y ago";
};

// Scrobblers (like a YouTube extension) can scrobble a track at ~70% while it is still "now playing", or send it twice.
// Last.fm then lists the same song twice in a row, so those copies are merged into one row.
const NOWPLAYING_DUP_S = 15 * 60; // the scrobbled copy of the song that is playing now is at most this old
const DOUBLE_SCROBBLE_S = 90; // the same song scrobbled twice within this many seconds counts as one
const sameSong = (a, b) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase();
function dedupeScrobbles(list) {
  const out = [];
  const nowS = Date.now() / 1000;
  for (const t of list) {
    const prev = out[out.length - 1];
    if (prev && sameSong(prev, t)) {
      const nowPlayingCopy = prev.playing && !t.playing && t.uts && nowS - t.uts <= NOWPLAYING_DUP_S;
      const doubleScrobble = !prev.playing && !t.playing && prev.uts && t.uts && Math.abs(prev.uts - t.uts) <= DOUBLE_SCROBBLE_S;
      if (nowPlayingCopy || doubleScrobble) {
        prev.loved = prev.loved || t.loved; // keep the heart if either copy has it
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

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

// The user's Last.fm profile picture (data URI, or null if none) and total scrobble count.
async function getProfile(user, key) {
  const hit = profileCache.get(user);
  if (hit && Date.now() - hit.ts < PROFILE_TTL_MS) return hit;

  const api =
    `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&format=json` +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
  const data = await (await get(api, ART_TIMEOUT_MS)).json();
  const u = data && data.user ? data.user : {};
  const imgs = Array.isArray(u.image) ? u.image : [];
  const pick = imgs.find((i) => i.size === "medium") || imgs.find((i) => i.size === "large") || imgs[imgs.length - 1];
  const url = pick ? pick["#text"] : "";

  let uri = null;
  if (url && !url.includes(AVATAR_PLACEHOLDER_ID)) uri = await toDataUri(url);
  const rec = { ts: Date.now(), uri, scrobbles: Number(u.playcount) || 0 };
  capped(profileCache, user, rec, 20);
  return rec;
}

const artistOf = (t) => (t.artist && (t.artist["#text"] || t.artist.name)) || "";

// One trip to Last.fm. Returns { ok, message?, avatar, scrobbles, tracks: [{ title, artist, uts, playing, loved, art }] }.
async function loadTracks(user, key, n) {
  // Start the profile lookup right away so it runs alongside everything else.
  const profileP = Promise.race([
    getProfile(user, key).catch(() => profileCache.get(user) || null),
    new Promise((done) => setTimeout(() => done(null), ART_TOTAL_MS)),
  ]);

  const api =
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&limit=${n + 3}&format=json&extended=1` +
    `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
  const data = await (await get(api, LASTFM_TIMEOUT_MS)).json();

  if (data && data.error) {
    return { ok: false, message: "Last.fm error " + data.error, detail: String(data.message || ""), tracks: [] };
  }

  let list = data && data.recenttracks && data.recenttracks.track;
  if (list && !Array.isArray(list)) list = [list];
  if (!list || !list.length) {
    const prof = await profileP;
    return {
      ok: true,
      message: "Nothing yet",
      detail: "No tracks scrobbled",
      tracks: [],
      avatar: prof ? prof.uri : null,
      scrobbles: prof ? prof.scrobbles : 0,
    };
  }

  const mapped = list.map((t) => {
    const imgs = Array.isArray(t.image) ? t.image : [];
    const pick = imgs.find((i) => i.size === "medium") || imgs.find((i) => i.size === "large") || imgs[imgs.length - 1];
    return {
      title: t.name || "Unknown",
      artist: artistOf(t),
      playing: !!(t["@attr"] && t["@attr"].nowplaying === "true"),
      loved: t.loved === "1" || t.loved === 1,
      uts: t.date && t.date.uts ? Number(t.date.uts) : 0,
      artUrl: pick ? pick["#text"] : "",
      art: null,
    };
  });
  const tracks = dedupeScrobbles(mapped).slice(0, n);

  // All art lookups (and the profile) run in parallel under one overall time cap.
  const [, prof] = await Promise.all([
    Promise.all(
      tracks.map((tr) =>
        Promise.race([
          findArt(tr.artUrl, tr.artist, tr.title).then((a) => (tr.art = a)).catch(() => null),
          new Promise((done) => setTimeout(done, ART_TOTAL_MS)),
        ])
      )
    ),
    profileP,
  ]);
  tracks.forEach((tr) => delete tr.artUrl);
  return { ok: true, tracks, avatar: prof ? prof.uri : null, scrobbles: prof ? prof.scrobbles : 0 };
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

// The Last.fm logo. x = left edge, cy = vertical center.
const logo = (x, cy, color) =>
  `<g transform="translate(${x} ${cy - LOGO_H / 2}) scale(${LOGO_SCALE.toFixed(5)})" fill="${color}">` +
  LOGO_PATHS.map((d) => `<path d="${d}"/>`).join("") +
  `</g>`;

// Profile picture (round) or a simple silhouette if the user has none. cx/cy = center.
const avatarSvg = (uri, cx, cy) => {
  const r = AV / 2;
  const inner = uri
    ? `<image href="${uri}" x="${cx - r}" y="${cy - r}" width="${AV}" height="${AV}" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>`
    : `<g clip-path="url(#av)">` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.2"/>` +
      `<circle cx="${cx}" cy="${cy - 3}" r="3.6" fill="#ffffff" fill-opacity="0.65"/>` +
      `<path d="M${cx - 7.5},${cy + r} a7.5,7.5 0 0 1 15,0z" fill="#ffffff" fill-opacity="0.65"/>` +
      `</g>`;
  return inner + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.35"/>`;
};

// Small heart for a loved track. x = left edge, y = top edge.
const heart = (x, y, color) =>
  `<path d="${HEART_PATH}" fill="${color}" transform="translate(${x.toFixed(1)} ${y}) scale(${(HEART_SIZE / 24).toFixed(4)})"/>`;

// Thumbnail: cover art (or a music-note placeholder) with a thin light border. ty = top edge.
const thumbSvg = (art, i, ty) => {
  const border = `<rect x="${PAD + 0.5}" y="${ty + 0.5}" width="${THUMB - 1}" height="${THUMB - 1}" rx="5.5" fill="none" stroke="#ffffff" stroke-opacity="0.28"/>`;
  if (art) {
    return (
      `<g clip-path="url(#c${i})"><image href="${art}" x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" preserveAspectRatio="xMidYMid slice"/></g>` +
      border
    );
  }
  const s = (THUMB * 0.48) / 24;
  const nx = PAD + (THUMB - 24 * s) / 2;
  const ny = ty + (THUMB - 24 * s) / 2;
  return (
    `<rect x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" rx="6" fill="#ffffff" fill-opacity="0.16"/>` +
    `<path d="${NOTE_PATH}" fill="#ffffff" fill-opacity="0.6" transform="translate(${nx.toFixed(1)} ${ny.toFixed(1)}) scale(${s.toFixed(4)})"/>` +
    border
  );
};

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
  const user = String((Array.isArray(q.username) ? q.username[0] : q.username) || process.env.LASTFM_USERNAME || "").trim();
  const key = process.env.LASTFM_API_KEY;

  const themeKey = String(Array.isArray(q.theme) ? q.theme[0] : q.theme || "").toLowerCase();
  const th = Object.prototype.hasOwnProperty.call(THEMES, themeKey) ? THEMES[themeKey] : THEMES.ocean;
  const bg = hex(q.background_color, null);
  const bgFill = bg || "url(#g)";
  const accent = norm(hex(q.accent_color || q.bar_color, th.accent));
  const text = norm(hex(q.text_color, th.text));
  const showLoved = q.loved !== "0";
  const loved = norm(hex(q.loved_color, th.loved));
  const animate = q.anim !== "0";
  const scrollTitles = q.marquee !== "0";
  const showScrobbles = q.scrobbles !== "0";

  const asked = q.recent === undefined ? DEFAULT_RECENT : parseInt(q.recent, 10);
  const n = Math.min(MAX_RECENT, Math.max(1, Number.isNaN(asked) ? DEFAULT_RECENT : asked));

  let data;
  let fellBack = false;
  if (!user || !key) {
    data = {
      ok: false,
      message: !user ? "Username missing" : "API key missing",
      detail: !user ? "Set LASTFM_USERNAME or add ?username=" : "Set LASTFM_API_KEY in Vercel",
      tracks: [],
    };
  } else try {
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
      dot = th.dot;
    } else {
      status = "NOT LISTENING";
    }
  }

  const F = `font-family="-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"`;
  const label = (cls, x, y, size, weight, body, extra = "") =>
    `<text class="${cls}" x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}"${extra}>${body}</text>`;

  const defs = [];

  // Header: logo + status on the left, profile picture + username on the right.
  const name = clip(user || "unknown", 24);
  const avCx = W - PAD - name.length * NAME_CHAR_W - AV_GAP - AV / 2;
  const avCy = 26;
  defs.push(`<clipPath id="av"><circle cx="${avCx}" cy="${avCy}" r="${AV / 2}"/></clipPath>`);

  const SX = PAD + LOGO_W + 13; // where the status starts, just after the logo

  // Idle header: show the total scrobble count after the status, only if it fits before the avatar.
  let extra = "";
  if (first && !first.playing && showScrobbles && data.scrobbles) {
    const statusEnd = SX + 10 + status.length * 8.4;
    const txt = `${data.scrobbles.toLocaleString("en-US")} scrobbles`;
    if (statusEnd + 14 + txt.length * 5.8 <= avCx - AV / 2 - 10) {
      extra =
        `<circle cx="${(statusEnd + 6).toFixed(1)}" cy="26.5" r="1.6" fill="${text}" fill-opacity="0.45"/>` +
        label("s", (statusEnd + 14).toFixed(1), 31, 11, 400, esc(txt));
    }
  }

  let out =
    logo(PAD, 26, accent) +
    (status
      ? `<circle cx="${SX}" cy="26.5" r="3.5" fill="${dot}"/>` +
        label("s", SX + 10, 31, 11, 700, status, ' letter-spacing="1.1"') +
        extra
      : label("s", SX - 3, 31, 12, 400, "Recently Played")) +
    avatarSvg(data.avatar, avCx, avCy) +
    label("t", W - PAD, 31, 13, 600, esc(name), ' text-anchor="end"');

  out += `<line x1="${PAD}" y1="${HEADER_H}" x2="${W - PAD}" y2="${HEADER_H}" stroke="#ffffff" stroke-opacity="0.18"/>`;

  let mqCss = ""; // keyframes for scrolling titles (one per row that needs it)
  let rows = "";

  if (!tracks.length) {
    // Error / empty state: one message row
    const y = HEADER_H;
    rows +=
      `<rect x="${PAD}" y="${y + 7}" width="${THUMB}" height="${THUMB}" rx="6" fill="#ffffff" fill-opacity="0.2"/>` +
      label("t", PAD + THUMB + 14, y + 25, 14, 700, esc(clip(data.message || "Nothing yet", 40))) +
      label("s", PAD + THUMB + 14, y + 42, 12, 400, esc(clip(data.detail || "", 48)));
  } else {
    tracks.forEach((tr, i) => {
      const y0 = HEADER_H + i * ROW_H; // every row is the same height, thumbnail centered in it
      const cy = y0 + ROW_H / 2 - 4;
      const ty = y0 + 7;
      defs.push(`<clipPath id="c${i}"><rect x="${PAD}" y="${ty}" width="${THUMB}" height="${THUMB}" rx="6"/></clipPath>`);

      // Now-playing row: soft accent panel + a small accent bar on the left.
      const hilite = tr.playing
        ? `<rect x="${PAD - 9}" y="${y0 + 3}" width="${W - 2 * PAD + 18}" height="${ROW_H - 6}" rx="10" fill="${accent}" fill-opacity="0.16"/>` +
          `<rect x="${PAD - 5}" y="${y0 + 14}" width="3" height="${ROW_H - 28}" rx="1.5" fill="${accent}"/>`
        : "";
      const sep =
        i > 0 ? `<line x1="${PAD}" y1="${y0}" x2="${W - PAD}" y2="${y0}" stroke="#ffffff" stroke-opacity="0.1"/>` : "";

      const ts = tr.playing ? "" : ago(tr.uts);
      const rightEdge = tr.playing ? W - PAD - 26 : W - PAD - ts.length * 6.2;
      const hasHeart = showLoved && tr.loved;
      const loveMark = hasHeart ? heart(HEART_X, y0 + 17, loved) : "";

      // Title: short ones are drawn exactly as before; long ones scroll sideways inside a window instead of ending in "…".
      // The browser measures the text itself (-100% = the text's own width), so the distance is exact for any font.
      const TX = PAD + THUMB + 14;
      const tWeight = tr.playing ? 700 : 600;
      const tUnits = Array.from(tr.title).reduce((a, c) => a + units(c), 0);
      let titleEl;
      if (scrollTitles && tUnits > 34) {
        const visW = Math.max(60, (hasHeart ? HEART_X - 8 : rightEdge - 10) - TX); // room before the heart / timestamp
        const dur = Math.max(5, (tUnits * 8 - visW) / 20); // only sets the speed
        defs.push(`<clipPath id="m${i}"><rect x="${TX}" y="${y0 + 4}" width="${visW}" height="28"/></clipPath>`);
        mqCss += `@keyframes mq${i}{0%,18%{transform:translateX(0)}82%,100%{transform:translateX(min(0px,calc(-100% + ${visW - 12}px)))}}`;
        titleEl =
          `<g clip-path="url(#m${i})">` +
          label("t", TX, y0 + 23, 14.5, tWeight, esc(tr.title), ` style="transform-box:fill-box;animation:mq${i} ${dur.toFixed(1)}s ease-in-out infinite alternate"`) +
          `</g>`;
      } else {
        titleEl = label("t", TX, y0 + 23, 14.5, tWeight, esc(clip(tr.title, 34)));
      }

      const body =
        hilite +
        sep +
        thumbSvg(tr.art, i, ty) +
        titleEl +
        label("n", PAD + THUMB + 14, y0 + 40, 12, 400, esc(clip(tr.artist, 42))) +
        loveMark +
        (tr.playing ? bars(cy) : label("s", W - PAD, y0 + 27, 12, 400, esc(ts), ' text-anchor="end"'));

      // Rows fade/slide in one after another (CSS, backwards-fill so nothing is hidden where CSS animation isn't supported).
      rows += animate ? `<g class="r" style="animation-delay:${120 + i * 90}ms">${body}</g>` : body;
    });
  }

  const count = Math.max(1, tracks.length);
  const height = HEADER_H + count * ROW_H + BOTTOM_PAD;

  // Card-wide depth: gradient, corner glow, bottom shade, optional blurred album-art background.
  const artBg = q.art_bg === "1" && first && first.art;
  defs.push(
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th.from}"/><stop offset="1" stop-color="${th.to}"/></linearGradient>`,
    `<radialGradient id="gl" cx="0.1" cy="0" r="0.8"><stop offset="0" stop-color="${th.glow}" stop-opacity="0.4"/><stop offset="1" stop-color="${th.glow}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>`,
    `<clipPath id="card"><rect x="0" y="0" width="${W}" height="${height}" rx="14"/></clipPath>`
  );
  if (artBg) {
    defs.push(
      `<filter id="bl" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="26"/><feColorMatrix type="saturate" values="1.5"/></filter>`
    );
  }

  const artLayer = artBg
    ? `<g clip-path="url(#card)"><image href="${first.art}" x="-60" y="-60" width="${W + 120}" height="${height + 120}" preserveAspectRatio="xMidYMid slice" filter="url(#bl)"/>` +
      `<rect width="${W}" height="${height}" fill="#0a0e1c" fill-opacity="0.5"/></g>`
    : "";

  const style =
    `.a{fill:${accent}}.t{fill:${text}}.s{fill:${text};fill-opacity:.8}.n{fill:${text};fill-opacity:.66}` +
    mqCss +
    (animate
      ? `@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}` +
        `.r{animation:in .55s cubic-bezier(.2,.7,.2,1) backwards}`
      : "");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" text-rendering="geometricPrecision">` +
    `<defs>${defs.join("")}</defs>` +
    `<style>${style}</style>` +
    `<rect x="0" y="0" width="${W}" height="${height}" rx="14" fill="${bgFill}"/>` +
    artLayer +
    `<rect x="0" y="0" width="${W}" height="${height}" rx="14" fill="url(#gl)"/>` +
    `<rect x="0" y="0" width="${W}" height="${height}" rx="14" fill="url(#vg)"/>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>` +
    out +
    rows +
    `</svg>`;

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", q.fresh === "1" || fellBack || !data.ok ? CACHE_LIVE : CACHE_FAST);
  res.status(200).send(svg);
};
