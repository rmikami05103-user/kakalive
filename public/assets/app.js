/* ==========================================================
   設定（ここだけ触れば運用できる）
   ========================================================== */
const CONFIG = {
  youtube: {
    // "channel" or "video"
    mode: "channel",
    channelId: "UCJbgL1kCXtXWVcTPwIDFS6w",
    manualVideoUrl: "",
    autoplay: true,
    mute: true,
    playsinline: true
  },

  // 混雑インジケータ（まずは public/parking_status.json を読む想定）
  parking: {
    apiUrl: "/parking_status.json",
    pollMs: 5000,
    thresholdYellow: 60,
    thresholdRed: 85,
    mapTotalSlots: 60,
    mapCols: 10
  },

  // 近隣駐車場マップ（方式B）
  nearbyMap: {
    lat: 35.344669744946366,
    lon: 139.51592005954566,
    zoom: 15,
    radiusM: 1200,
    topN: 10
  }
};

/* ==========================================================
   共通ユーティリティ
   ========================================================== */
function $(id) { return document.getElementById(id); }

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function extractVideoId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    const parts = u.pathname.split("/").filter(Boolean);
    const idxEmbed = parts.indexOf("embed");
    if (idxEmbed >= 0 && parts[idxEmbed + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idxEmbed + 1])) {
      return parts[idxEmbed + 1];
    }
    const idxLive = parts.indexOf("live");
    if (idxLive >= 0 && parts[idxLive + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idxLive + 1])) {
      return parts[idxLive + 1];
    }
    return "";
  } catch {
    return "";
  }
}

function buildEmbedParams() {
  const p = new URLSearchParams();
  if (CONFIG.youtube.autoplay) p.set("autoplay", "1");
  if (CONFIG.youtube.mute) p.set("mute", "1");
  if (CONFIG.youtube.playsinline) p.set("playsinline", "1");
  return p.toString();
}

function buildChannelEmbedSrc() {
  const params = buildEmbedParams();
  const base = `https://www.youtube.com/embed/live_stream?channel=${CONFIG.youtube.channelId}`;
  return params ? `${base}&${params}` : base;
}

function buildVideoEmbedSrc(videoId) {
  const params = buildEmbedParams();
  const base = `https://www.youtube.com/embed/${videoId}`;
  return params ? `${base}?${params}` : base;
}

function forceReloadIframe(iframe) {
  const current = new URL(iframe.src, window.location.href);
  current.searchParams.set("_r", String(Date.now()));
  iframe.src = current.toString();
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "--" : d.toLocaleString();
  } catch { return "--"; }
}

/* ==========================================================
   1) YouTube埋め込み
   ========================================================== */
function initYouTube() {
  const iframe = $("ytFrame");
  const openBtn = $("openOnYouTube");

  const qpV = getQueryParam("v");
  const qpUrl = getQueryParam("url");

  let mode = CONFIG.youtube.mode;
  let videoId = "";

  if (qpV) {
    mode = "video";
    videoId = extractVideoId(qpV);
  } else if (qpUrl) {
    mode = "video";
    videoId = extractVideoId(qpUrl);
  } else if (CONFIG.youtube.mode === "video") {
    videoId = extractVideoId(CONFIG.youtube.manualVideoUrl);
  }

  let embedSrc = "";
  let openHref = "";

  if (mode === "video") {
    if (!videoId) {
      embedSrc = buildChannelEmbedSrc();
      openHref = `https://www.youtube.com/channel/${CONFIG.youtube.channelId}/live`;
    } else {
      embedSrc = buildVideoEmbedSrc(videoId);
      openHref = `https://www.youtube.com/watch?v=${videoId}`;
    }
  } else {
    embedSrc = buildChannelEmbedSrc();
    openHref = `https://www.youtube.com/channel/${CONFIG.youtube.channelId}/live`;
  }

  iframe.src = embedSrc;
  openBtn.href = openHref;

  $("reloadBtn").addEventListener("click", () => forceReloadIframe(iframe));
}

/* ==========================================================
   2) 混雑インジケータ + 模式図
   ========================================================== */
function calcOccPct(data) {
  if (!data) return null;
  if (typeof data.occupancyPct === "number") return Math.max(0, Math.min(100, data.occupancyPct));
  const total = Number(data.total);
  const occ = Number(data.occupied);
  if (!total || total <= 0 || isNaN(total) || isNaN(occ)) return null;
  return Math.max(0, Math.min(100, Math.round((occ / total) * 100)));
}

function occLevel(pct) {
  if (pct == null) return { label: "不明", color: "#64748b" };
  if (pct >= CONFIG.parking.thresholdRed) return { label: "混雑", color: "#ef4444" };
  if (pct >= CONFIG.parking.thresholdYellow) return { label: "やや混雑", color: "#f59e0b" };
  return { label: "空きあり", color: "#3b82f6" };
}

function setGauge(pct, updatedAt, total, occupied) {
  const fill = $("occFill");
  const pctEl = $("occPct");
  const lvlEl = $("occLevel");
  const updEl = $("occUpdated");
  const totalEl = $("totalCount");
  const freeEl = $("freeCount");

  const lvl = occLevel(pct);
  fill.style.setProperty("--occColor", lvl.color);
  fill.style.width = (pct == null ? 0 : pct) + "%";

  pctEl.textContent = pct == null ? "--" : String(pct);
  lvlEl.textContent = pct == null ? "取得失敗/不明" : lvl.label;
  updEl.textContent = fmtTime(updatedAt);

  const t = (typeof total === "number" && isFinite(total) && total > 0) ? total : null;
  const o = (typeof occupied === "number" && isFinite(occupied) && occupied >= 0) ? occupied : null;

  if (t != null && o != null) {
    totalEl.textContent = String(t);
    freeEl.textContent = String(Math.max(0, t - o));
  } else {
    totalEl.textContent = "--";
    freeEl.textContent = "--";
  }

  fill.parentElement.setAttribute("aria-valuenow", String(pct == null ? 0 : pct));
}

function buildGridOnce(total, cols) {
  const grid = $("lotGrid");
  grid.style.setProperty("--cols", String(cols));
  grid.innerHTML = "";
  for (let i = 1; i <= total; i++) {
    const id = String(i).padStart(3, "0");
    const cell = document.createElement("div");
    cell.className = "slot unknown";
    cell.dataset.slotId = id;
    cell.textContent = id;
    grid.appendChild(cell);
  }
}

function updateGrid(slots) {
  const map = new Map();
  (slots || []).forEach(s => {
    if (!s || s.id == null) return;
    const id = String(s.id).padStart(3, "0");
    map.set(id, s.state);
  });

  const grid = $("lotGrid");
  grid.querySelectorAll(".slot").forEach(cell => {
    const id = cell.dataset.slotId;
    const st = map.get(id);
    cell.classList.remove("free", "occupied", "unknown");
    if (st === "free") cell.classList.add("free");
    else if (st === "occupied") cell.classList.add("occupied");
    else cell.classList.add("unknown");
    cell.title = `枠 ${id}: ${st || "unknown"}`;
  });
}

async function fetchParking() {
  const url = new URL(CONFIG.parking.apiUrl, window.location.href);
  url.searchParams.set("_t", String(Date.now()));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`parking api ${res.status}`);
  return await res.json();
}

async function tickParking() {
  try {
    const data = await fetchParking();
    const pct = calcOccPct(data);

    const total = (data.total != null) ? Number(data.total) : CONFIG.parking.mapTotalSlots;
    const occupied = (data.occupied != null) ? Number(data.occupied) : null;

    setGauge(pct, data.updatedAt, isFinite(total) ? total : null, isFinite(occupied) ? occupied : null);

    const cols = CONFIG.parking.mapCols;
    const grid = $("lotGrid");
    if (!grid.hasChildNodes()) buildGridOnce(isFinite(total) && total > 0 ? total : CONFIG.parking.mapTotalSlots, cols);

    updateGrid(data.slots || []);
    $("lotNote").textContent = "※模式図（カメラ画角内）";
  } catch (e) {
    setGauge(null, null, null, null);
    $("lotNote").textContent = "※取得失敗（API未接続/停止/通信）";
    console.warn(e);
  }
}

function initParkingDashboard() {
  buildGridOnce(CONFIG.parking.mapTotalSlots, CONFIG.parking.mapCols);
  tickParking();
  setInterval(tickParking, CONFIG.parking.pollMs);
}

/* ==========================================================
   3) 近隣駐車場マップ（Leaflet + /api/nearby-parking）
   ========================================================== */
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function fmtWalkMin(distM) {
  // 80m/分（ざっくり）
  const min = Math.max(1, Math.round(distM / 80));
  return `${min}分`;
}

async function fetchNearbyParking() {
  const { lat, lon, radiusM } = CONFIG.nearbyMap;
  const url = new URL("/api/nearby-parking", window.location.href);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("_t", String(Date.now())); // 体感更新用（Functions側でキャッシュしてるので負荷は軽い）

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`nearby-parking api ${res.status}`);
  return await res.json();
}

function setMapInteraction(enabled) {
  const wrap = $("mapWrap");
  if (enabled) wrap.classList.remove("locked");
  else wrap.classList.add("locked");
}

function renderList(items) {
  const list = $("parkingList");
  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = `<div class="sub">近隣駐車場が見つかりませんでした（データ未登録の可能性があります）。</div>`;
    return;
  }

  items.forEach(p => {
    const div = document.createElement("div");
    div.className = "parkingItem";
    const name = p.name || "駐車場";
    const dist = (typeof p.distanceM === "number") ? `${Math.round(p.distanceM)}m / 徒歩${fmtWalkMin(p.distanceM)}` : "";
    const cap = p.capacity ? `台数: ${p.capacity}` : "";
    const fee = p.fee ? `料金: ${p.fee}` : "";
    const meta = [dist, cap, fee].filter(Boolean).join(" / ");

    div.innerHTML = `
      <div class="parkingName">${escapeHtml(name)}</div>
      <div class="parkingMeta">${escapeHtml(meta || "")}</div>
    `;
    list.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function initNearbyMap() {
  $("radiusLabel").textContent = String(CONFIG.nearbyMap.radiusM);

  // Leaflet map
  const map = L.map("nearbyMap", { scrollWheelZoom: false }).setView([CONFIG.nearbyMap.lat, CONFIG.nearbyMap.lon], CONFIG.nearbyMap.zoom);

  // タイル：PoC向け（アクセス増が見えたらタイル提供サービスへ移行推奨）
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  // 病院（アイコン画像を使わず circleMarker にして壊れにくくする）
  L.circleMarker([CONFIG.nearbyMap.lat, CONFIG.nearbyMap.lon], { radius: 8 }).addTo(map).bindPopup("<strong>病院</strong>");

  // 操作ON/OFF（スマホ誤スクロール対策）
  setMapInteraction(false);
  $("toggleMapInteract").addEventListener("click", () => {
    const locked = $("mapWrap").classList.contains("locked");
    setMapInteraction(locked);
    $("toggleMapInteract").textContent = locked ? "操作を終了" : "地図を操作する";
  });

  // データ取得→描画
  const data = await fetchNearbyParking();
  const items = (data.items || []).map(p => {
    const d = haversineM(CONFIG.nearbyMap.lat, CONFIG.nearbyMap.lon, p.lat, p.lon);
    return { ...p, distanceM: d };
  }).sort((a, b) => a.distanceM - b.distanceM);

  // マーカー描画（こちらも circleMarker）
  items.forEach(p => {
    const name = p.name || "駐車場";
    const dist = `${Math.round(p.distanceM)}m / 徒歩${fmtWalkMin(p.distanceM)}`;
    const cap = p.capacity ? `<br>台数: ${escapeHtml(p.capacity)}` : "";
    const fee = p.fee ? `<br>料金: ${escapeHtml(p.fee)}` : "";

    L.circleMarker([p.lat, p.lon], { radius: 7 }).addTo(map)
      .bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(dist)}${cap}${fee}`);
  });

  // リスト（上位N件）
  renderList(items.slice(0, CONFIG.nearbyMap.topN));
}

/* ==========================================================
   起動
   ========================================================== */
window.addEventListener("DOMContentLoaded", () => {
  initYouTube();
  initParkingDashboard();

  initNearbyMap().catch(err => {
    console.warn(err);
    $("parkingList").innerHTML = `<div class="sub">近隣駐車場の取得に失敗しました（API/通信/制限）。</div>`;
  });
});
