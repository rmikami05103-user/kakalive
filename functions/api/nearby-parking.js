export async function onRequestGet(context) {
  const request = context.request;
  const ctx = context.ctx || context.context || null;

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = Number(url.searchParams.get("radius") || 1200);

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

  const qNodeOnly = `
[out:json][timeout:12];
node(around:${radius},${lat},${lon})["amenity"="parking"];
out body;
`.trim();

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

  // 1) 軽量(node)を試す
  const nodeRes = await tryOverpass(endpoints, qNodeOnly);
  const nodeItems = mapElementsToItems(nodeRes?.raw);

  // 2) itemsが0なら(all)を試す（way/relation対策）
  let mode = "node_only";
  let finalItems = nodeItems;

  if (finalItems.length === 0) {
    const allRes = await tryOverpass(endpoints, qAll);
    const allItems = mapElementsToItems(allRes?.raw);
    if (allItems.length > 0) {
      finalItems = allItems;
      mode = "all";
    }
  }

  const body = {
    updatedAt: new Date().toISOString(),
    source: "OpenStreetMap / Overpass",
    mode,
    count: finalItems.length,
    items: finalItems
  };

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
