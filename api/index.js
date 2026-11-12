// Last.fm "now playing" SVG card for Vercel (speed-tuned).
// Env vars: LASTFM_USERNAME, LASTFM_API_KEY
// Optional URL params: username, background_color (hex, no #), text_color, bar_color
// Album art: Last.fm first; if it has none, iTunes and Deezer are tried at the same time.

const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's default grey star
const ART_TIMEOUT_MS = 2500; // album art lookups
const LASTFM_TIMEOUT_MS = 5000; // the main Last.fm request gets more patience

// Last good result, kept while the function is warm. If Last.fm hiccups, the card
// shows this instead of an error message.
let lastGood = null;

// Remembers art between requests while the function is warm (skips repeat lookups).
const artCache = new Map();
const rememberArt = (k, v) => {
  if (artCache.size >= 40) artCache.delete(artCache.keys().next().value);
  artCache.set(k, v);
};

const esc = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const hex = (v, fallback) => (/^[0-9a-fA-F]{3,8}$/.test(v || "") ? "#" + v : fallback);

const get = (url, ms = ART_TIMEOUT_MS) => fetch(url, { signal: AbortSignal.timeout(ms) });

async function toDataUri(url) {
  const r = await get(url);
  if (!r.ok) throw new Error("bad image");
  const type = r.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

async function itunesArt(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const j = await (await get(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`)).json();
  const u = j.results && j.results[0] && j.results[0].artworkUrl100;
  if (!u) throw new Error("no itunes art");
  return toDataUri(u.replace("100x100", "200x200"));
}

async function deezerArt(artist, title) {
  const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  const j = await (await get(`https://api.deezer.com/search?q=${q}&limit=1`)).json();
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
    // iTunes and Deezer run in parallel; the first one that returns art wins.
    art = await Promise.any([itunesArt(artist, title), deezerArt(artist, title)]).catch(() => null);
  }
  rememberArt(key, art);
  return art;
}

module.exports = async (req, res) => {
  const user = req.query.username || process.env.LASTFM_USERNAME;
  const key = process.env.LASTFM_API_KEY;
  // Pastel blue accent, medium intensity. It sits naturally on AniList's blue/purple page.
  const accent = hex(req.query.accent_color || req.query.bar_color, "#7fb0ec");
  // No background by default: the card is see-through and blends into whatever page it sits on.
  const bg = req.query.background_color ? hex(req.query.background_color, null) : null;
  const fg = hex(req.query.text_color, "#eef3fb");
  const bar = accent;

  let title = "Nothing yet";
  let artist = "";
  let playing = false;
  let art = null;

  try {
    const api =
      "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&limit=1&format=json" +
      `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
    const data = await (await get(api, LASTFM_TIMEOUT_MS)).json();
    if (data && data.error) {
      title = "Last.fm error " + data.error;
      artist = String(data.message || "");
    }
    let t = data && data.recenttracks && data.recenttracks.track;
    if (Array.isArray(t)) t = t[0];
    if (t) {
      title = t.name || title;
      artist = (t.artist && (t.artist["#text"] || t.artist.name)) || "";
      playing = !!(t["@attr"] && t["@attr"].nowplaying === "true");
      // The card art is only 80px, so the 174px size is plenty and loads faster than 300px.
      const imgs = Array.isArray(t.image) ? t.image : [];
      const pick = imgs.find((i) => i.size === "large") || imgs[imgs.length - 1];
      art = await findArt(pick ? pick["#text"] : "", artist, title);
      lastGood = { title, artist, art };
    }
  } catch (e) {
    if (lastGood) {
      // Show the last track we saw instead of an error.
      ({ title, artist, art } = lastGood);
      playing = false;
    } else {
      title = e && e.name === "TimeoutError" ? "Last.fm is slow" : "Couldn't reach Last.fm";
      artist = "Refresh in a moment";
    }
  }

  const panel = bg
    ? `<rect width="300" height="100" rx="12" fill="${bg}"/>`
    : `<rect x="0.5" y="0.5" width="299" height="99" rx="12" fill="${accent}" fill-opacity="0.10" stroke="${accent}" stroke-opacity="0.35"/>`;

  const status = playing ? "NOW LISTENING" : "LAST PLAYED";
  const artEl = art
    ? `<image href="${art}" x="10" y="10" width="80" height="80" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="10" y="10" width="80" height="80" rx="6" fill="#2a2a2a"/>`;

  // Animated equalizer bars only while playing
  const bars = playing
    ? [0, 1, 2, 3]
        .map(
          (i) =>
            `<rect x="${268 + i * 7}" y="78" width="4" height="4" fill="${bar}">` +
            `<animate attributeName="height" values="4;16;6;12;4" dur="${0.9 + i * 0.15}s" repeatCount="indefinite"/>` +
            `<animate attributeName="y" values="86;74;84;78;86" dur="${0.9 + i * 0.15}s" repeatCount="indefinite"/>` +
            `</rect>`
        )
        .join("")
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
  ${panel}
  <clipPath id="c"><rect x="10" y="10" width="80" height="80" rx="6"/></clipPath>
  <g clip-path="url(#c)">${artEl}</g>
  <text x="104" y="32" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="${bar}">${status}</text>
  <text x="104" y="54" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${fg}">${esc(clip(title, 22))}</text>
  <text x="104" y="74" font-family="Arial, sans-serif" font-size="12" fill="${fg}" fill-opacity="0.7">${esc(clip(artist, 24))}</text>
  ${bars}
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  // No caching on our side, so every fetch gets the current track.
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  res.status(200).send(svg);
};
