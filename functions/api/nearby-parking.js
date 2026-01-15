export async function onRequestGet(context) {
  const request = context.request;
  const ctx = context.ctx || context.context || null;

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = Number(url.searchParams.get("radius") || 1200);
  const debug = url.searchParams.get("debug") === "1";

  if (!isFinite(lat) || !isFinite(lon) || !isFinite(radius) || radius <= 0 || radius > 10000) {
    return json({ error: "bad params (lat/lon/radius)" }, 400);
  }

  // キャッシュキー（_t は無視）
  const cacheUrl = new URL(url.toString());
  cacheUrl.searchParams.delete("_t");
  const cacheKey = new Request(cacheUrl.toString(), request);

  const cache = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  // ✅ node_only は out tags; をやめて out body; にする（lat/lon を確実に含める）
  const qNodeOnly = `
[out:json][timeout:12];
node(around:${radius},${lat},${lon})["amenity"="parking"];
out body;
`.trim();

  // ✅ way/relation も含める（駐車場は面で入ってることが多い）
  const qAll = `
[out:json][timeout:20];
(
  node(around:${radius},${lat},${lon})["amenity"="parking"];
  way(around:${radius},${lat},${lon})["amenity"="parking"];
  relation(around:${radius},${lat},${lon})["amenity"="parking"];
);
out center tags;
`.trim();

  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  // 1) node_only を試す
  const nodeRes = await tryOverpass(endpoints, qNodeOnly);
  const nodeItems = mapElementsToItems(nodeRes?.raw);

  // 2) ✅ “itemsが0”なら all を必ず試す（raw.elements があっても lat/lon 欠損等で0になり得る）
  let mode = "node_only";
  let usedEndpoint = nodeRes?.endpoint || null;
  let rawCountNode = nodeRes?.raw?.elements?.length ?? null;
  let rawCountAll = null;

  let finalItems = nodeItems;

  if (finalItems.length === 0) {
    const allRes = await tryOverpass(endpoints, qAll);
    rawCountAll = allRes?.raw?.elements?.length ?? null;
    const allItems = mapElementsToItems(allRes?.raw);
    if (allItems.length > 0) {
      finalItems = allItems;
      mode = "all";
      usedEndpoint = allRes?.endpoint || usedEndpoint;
    }
  }

  const body = {
    updatedAt: new Date().toISOString(),
    source: "OpenStreetMap / Overpass",
    mode,
    count: finalItems.length,
    items: finalItems
  };

  if (debug) {
    body.debug = {
      endpoint: usedEndpoint,
      rawCountNode,
      rawCountAll
    };
  }

  const resp = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=600"
    }
  });

  if (cache) {
    const putPromise = cache.put(cacheKey, resp.clone());
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(putPromise);
    else putPromise.catch(() => {});
  }

  return resp;
}

function mapElementsToItems(raw) {
  if (!raw || !Array.isArray(raw.elements)) return [];

  return raw.elements.map(el => {
    const tags = el.tags || {};
    const center = el.type === "node"
      ? { lat: el.lat, lon: el.lon }
      : (el.center || {});

    return {
      id: `${el.type}:${el.id}`,
      lat: center.lat,
      lon: center.lon,
      name: tags["name:ja"] || tags.name || "",
      capacity: tags.capacity || "",
      fee: tags.fee || tags["parking:fee"] || "",
      operator: tags.operator || ""
    };
  }).filter(p => isFinite(p.lat) && isFinite(p.lon));
}

async function tryOverpass(endpoints, query) {
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "kakalive-parking-map/1.0"
        },
        body: new URLSearchParams({ data: query }).toString()
      });

      if (!r.ok) continue;
      const raw = await r.json();
      return { raw, endpoint };
    } catch {
      // 次へ
    }
  }
  return null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" }
  });
}
