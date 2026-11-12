// Last.fm "now playing" SVG card for Vercel.
// Env vars: LASTFM_USERNAME, LASTFM_API_KEY
// Optional URL params: username, background_color (hex, no #), text_color, bar_color
// Album art: Last.fm first, then iTunes, then Deezer when Last.fm has none.

const PLACEHOLDER_ID = "2a96cbd8b46e442fc41c2b86b821562f"; // Last.fm's default grey star

const esc = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const hex = (v, fallback) => (/^[0-9a-fA-F]{3,8}$/.test(v || "") ? "#" + v : fallback);

const get = (url) => fetch(url, { signal: AbortSignal.timeout(4000) });

async function toDataUri(url) {
  try {
    const r = await get(url);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function itunesArt(artist, title) {
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const r = await get(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
    const j = await r.json();
    const u = j.results && j.results[0] && j.results[0].artworkUrl100;
    return u ? u.replace("100x100", "300x300") : null;
  } catch {
    return null;
  }
}

async function deezerArt(artist, title) {
  try {
    const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
    const r = await get(`https://api.deezer.com/search?q=${q}&limit=1`);
    const j = await r.json();
    const a = j.data && j.data[0] && j.data[0].album;
    return a ? a.cover_medium || a.cover : null;
  } catch {
    return null;
  }
}

async function findArt(lastfmUrl, artist, title) {
  if (lastfmUrl && !lastfmUrl.includes(PLACEHOLDER_ID)) {
    const d = await toDataUri(lastfmUrl);
    if (d) return d;
  }
  if (!artist && !title) return null;
  for (const finder of [itunesArt, deezerArt]) {
    const url = await finder(artist, title);
    if (url) {
      const d = await toDataUri(url);
      if (d) return d;
    }
  }
  return null;
}

module.exports = async (req, res) => {
  const user = req.query.username || process.env.LASTFM_USERNAME;
  const key = process.env.LASTFM_API_KEY;
  const bg = hex(req.query.background_color, "#121212");
  const fg = hex(req.query.text_color, "#ffffff");
  const bar = hex(req.query.bar_color, "#b3b3b3");

  let title = "Nothing yet";
  let artist = "";
  let playing = false;
  let art = null;

  try {
    const api =
      "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&limit=1&format=json" +
      `&user=${encodeURIComponent(user)}&api_key=${encodeURIComponent(key)}`;
    const data = await (await get(api)).json();
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
      const imgs = Array.isArray(t.image) ? t.image : [];
      const best = imgs.length ? imgs[imgs.length - 1]["#text"] : "";
      art = await findArt(best, artist, title);
    }
  } catch (e) {
    title = "Couldn't reach Last.fm";
  }

  const status = playing ? "NOW PLAYING" : "LAST PLAYED";
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
  <rect width="300" height="100" rx="12" fill="${bg}"/>
  <clipPath id="c"><rect x="10" y="10" width="80" height="80" rx="6"/></clipPath>
  <g clip-path="url(#c)">${artEl}</g>
  <text x="104" y="32" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1" fill="${bar}">${status}</text>
  <text x="104" y="54" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${fg}">${esc(clip(title, 22))}</text>
  <text x="104" y="74" font-family="Arial, sans-serif" font-size="12" fill="${fg}" fill-opacity="0.7">${esc(clip(artist, 24))}</text>
  ${bars}
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  res.status(200).send(svg);
};
