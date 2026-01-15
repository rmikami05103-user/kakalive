const CONFIG = {
  youtube: {
    defaultVideoId: "nXWsWO-mVmc",
  },

  // 近隣駐車場（OSM）検索
  nearbyMap: {
    lat: 35.344669744946366,
    lon: 139.51592005954566,
    radiusPrimaryM: 1200,   // 患者向け：徒歩圏
    radiusFallbackM: 2500,  // 0件の時だけ拡張
    maxList: 10,
  },

  // 推奨駐車場（手動）
  recommended: {
    url: "/recommended_parking.json",
    maxShow: 10
  },

  // ダッシュボード（試作）
  parking: {
    apiUrl: "/parking_status.json",
    pollMs: 15000
  },

  ui: {
    showDashboard: false,  // ← 次ステップ1：テスト公開で隠すなら false
    showNotes: false       // ← 次ステップ1：テスト公開で隠すなら false
  }
};

// ---------- YouTube ----------
function getVideoId() {
  const u = new URL(location.href);
  return u.searchParams.get("v") || CONFIG.youtube.defaultVideoId;
}

function setYouTubePlayer(videoId) {
  const iframe = document.getElementById("ytPlayer");
  const info = document.getElementById("ytInfo");
  const openBtn = document.getElementById("btnOpenYouTube");

  const src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1&rel=0`;
  iframe.src = src;

  openBtn.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  info.textContent = `Video ID: ${videoId}`;
}

function wireYouTubeControls() {
  document.getElementById("btnReload").addEventListener("click", () => {
    const id = getVideoId();
    const iframe = document.getElementById("ytPlayer");
    iframe.src = ""; // いったん切る
    setTimeout(() => setYouTubePlayer(id), 50);
  });
}

// ---------- 推奨駐車場 ----------
async function fetchRecommended() {
  try {
    const res = await fetch(CONFIG.recommended.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`recommended ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    // priority昇順
    items.sort((a,b) => (Number(a.priority)||999) - (Number(b.priority)||999));
    return items;
  } catch {
    return [];
  }
}

// ---------- 近隣駐車場（OSM API） ----------
async function fetchNearby(radiusM) {
  const { lat, lon } = CONFIG.nearbyMap;
  const url = new URL("/api/nearby-parking", window.location.href);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("radius", String(radiusM));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`nearby api ${res.status}`);
  return await res.json();
}

async function fetchNearbyWithFailSafe() {
  const badge = document.getElementById("fallbackBadge");
  badge.style.display = "none";

  const primary = CONFIG.nearbyMap.radiusPrimaryM;
  const fallback = CONFIG.nearbyMap.radiusFallbackM;

  const data1 = await fetchNearby(primary);
  if ((data1.count || 0) > 0) return { ...data1, usedRadius: primary, usedFallback: false };

  // 0件ならフェイルセーフ
  badge.style.display = "";
  const data2 = await fetchNearby(fallback);
  return { ...data2, usedRadius: fallback, usedFallback: true };
}

// ---------- 距離計算 ----------
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function walkMinutesFromMeters(m) {
  // 80m/分（徒歩ざっくり）
  return Math.max(1, Math.round(m / 80));
}

// ---------- 地図 ----------
let map;
let layerGroup;

function initMap() {
  const { lat, lon } = CONFIG.nearbyMap;

  map = L.map("nearbyMap", { scrollWheelZoom: true }).setView([lat, lon], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);

  // 病院（中心点）
  const hospitalIcon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:999px;background:#ef4444;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.2)"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  });
  L.marker([lat, lon], { icon: hospitalIcon })
    .addTo(layerGroup)
    .bindPopup("現在地（病院付近）");
}

function clearMarkers() {
  layerGroup.clearLayers();
  // 病院マーカーは描き直し
  const { lat, lon } = CONFIG.nearbyMap;
  const hospitalIcon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:999px;background:#ef4444;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.2)"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  });
  L.marker([lat, lon], { icon: hospitalIcon })
    .addTo(layerGroup)
    .bindPopup("現在地（病院付近）");
}

function addParkingMarker(p, opts) {
  const icon = L.divIcon({
    className: "",
    html: `<div style="width:12px;height:12px;border-radius:999px;background:${opts.color};border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.18)"></div>`,
    iconSize: [12,12],
    iconAnchor: [6,6]
  });

  const title = p.name && p.name.trim()
    ? p.name.trim()
    : "周辺駐車場（名称未登録）";

  const lines = [];
  lines.push(`<strong>${escapeHtml(title)}</strong>`);
  if (p.fee) lines.push(`料金: ${escapeHtml(String(p.fee))}`);
  if (p.operator) lines.push(`運営: ${escapeHtml(String(p.operator))}`);
  if (p.note) lines.push(`${escapeHtml(String(p.note))}`);
  if (p.url) lines.push(`<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">詳細</a>`);

  L.marker([p.lat, p.lon], { icon }).addTo(layerGroup).bindPopup(lines.join("<br>"));
}

// ---------- リスト ----------
function renderList(el, items, centerLat, centerLon) {
  el.innerHTML = "";

  if (!items.length) {
    el.innerHTML = `<div class="small">該当する駐車場が見つかりませんでした。</div>`;
    return;
  }

  for (const p of items) {
    const name = (p.name && p.name.trim()) ? p.name.trim() : "周辺駐車場（名称未登録）";
    const distM = Math.round(haversineM(centerLat, centerLon, p.lat, p.lon));
    const walkMin = walkMinutesFromMeters(distM);

    const badges = [];
    if (p._recommended) badges.push(`<span class="badge rec">病院推奨</span>`);

    el.insertAdjacentHTML("beforeend", `
      <div class="item">
        <div class="item-title">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong>${escapeHtml(name)}</strong>
            ${badges.join("")}
          </div>
          <div class="small">${distM}m / 徒歩${walkMin}分</div>
        </div>
        <div class="item-sub">
          ${p.fee ? `<span>料金: ${escapeHtml(String(p.fee))}</span>` : ""}
          ${p.note ? `<span>${escapeHtml(String(p.note))}</span>` : ""}
          ${p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">詳細</a>` : ""}
        </div>
      </div>
    `);
  }
}

// ---------- ダッシュボード（ダミー表示） ----------
async function fetchParkingStatus() {
  const res = await fetch(CONFIG.parking.apiUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`parking api ${res.status}`);
  return await res.json();
}

function updateDashboardDummy(data) {
  // ここは将来の解析結果で差し替える前提（今は既存ダミーJSON想定）
  const pct = Number(data.congestionPct ?? 0);
  const free = Number(data.free ?? 0);
  const total = Number(data.total ?? 0);
  const updatedAt = data.updatedAt || "";

  document.getElementById("congestionPct").textContent = isFinite(pct) ? Math.round(pct) : "—";
  document.getElementById("freeCount").textContent = isFinite(free) ? free : "—";
  document.getElementById("totalCount").textContent = isFinite(total) ? total : "—";
  document.getElementById("dashUpdatedAt").textContent = updatedAt || "—";

  const label = pct >= 80 ? "混雑" : pct >= 50 ? "やや混雑" : "空きあり";
  document.getElementById("congestionLabel").textContent = label;

  const bar = document.getElementById("congestionBar");
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bar.style.background = pct >= 80 ? "var(--bad)" : pct >= 50 ? "var(--warn)" : "var(--ok)";

  // 模式図（60枠ダミー）
  const schematic = document.getElementById("schematic");
  schematic.innerHTML = "";
  const N = 60;
  for (let i=1; i<=N; i++) {
    const used = Math.random() < (pct/100); // ダミー
    const bg = used ? "#fee2e2" : "#dcfce7";
    schematic.insertAdjacentHTML("beforeend", `
      <div title="${i.toString().padStart(2,"0")}"
           style="border:1px solid var(--border); border-radius:8px; padding:6px; text-align:center; font-size:11px; background:${bg}">
        ${i.toString().padStart(2,"0")}
      </div>
    `);
  }
}

// ---------- 初期化 ----------
async function main() {
  // UI表示フラグ（次ステップの1に直結）
  document.getElementById("dashboardSection").classList.toggle("hidden", !CONFIG.ui.showDashboard);
  document.getElementById("notesSection").classList.toggle("hidden", !CONFIG.ui.showNotes);

  // YouTube
  const videoId = getVideoId();
  setYouTubePlayer(videoId);
  wireYouTubeControls();

  // Map
  initMap();

  // 推奨 + OSM を取得して描画
  const errEl = document.getElementById("nearbyErr");
  const listEl = document.getElementById("nearbyList");
  const { lat, lon } = CONFIG.nearbyMap;

  try {
    errEl.textContent = "";

    const [recommended, nearby] = await Promise.all([
      fetchRecommended(),
      fetchNearbyWithFailSafe()
    ]);

    // 中心点から距離を計算してソート
    const recItems = (recommended || [])
      .map(x => ({ ...x, _recommended: true }))
      .slice(0, CONFIG.recommended.maxShow);

    const nearbyItems = (nearby.items || [])
      .map(x => ({ ...x, _recommended: false }));

    // 近い順
    const byDist = (a, b) => (
      haversineM(lat, lon, a.lat, a.lon) - haversineM(lat, lon, b.lat, b.lon)
    );

    recItems.sort(byDist);
    nearbyItems.sort(byDist);

    // リストは「推奨 → 周辺」の順で上位表示
    const listItems = [
      ...recItems,
      ...nearbyItems
    ].slice(0, CONFIG.nearbyMap.maxList);

    // マーカー描画
    clearMarkers();
    for (const p of recItems) addParkingMarker(p, { color: "#22c55e" });   // 推奨
    for (const p of nearbyItems) addParkingMarker(p, { color: "#3b82f6" }); // OSM

    // 表示範囲調整（全マーカーが見えるように）
    const all = [...recItems, ...nearbyItems];
    if (all.length) {
      const bounds = L.latLngBounds(all.map(p => [p.lat, p.lon]));
      bounds.extend([lat, lon]);
      map.fitBounds(bounds.pad(0.15));
    }

    // リスト描画（名称空は “名称未登録” に）
    renderList(listEl, listItems, lat, lon);

  } catch (e) {
    console.error(e);
    errEl.textContent = "近隣駐車場の取得に失敗しました（API/通信/制限）。時間をおいて再表示してください。";
    listEl.innerHTML = "";
  }

  // ダッシュボード（ダミー）
  if (CONFIG.ui.showDashboard) {
    try {
      const data = await fetchParkingStatus();
      updateDashboardDummy(data);
      setInterval(async () => {
        try {
          const d = await fetchParkingStatus();
          updateDashboardDummy(d);
        } catch {}
      }, CONFIG.parking.pollMs);
    } catch {
      // ダッシュボードが落ちてもページは動くようにする
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

main();
