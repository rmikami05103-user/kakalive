export async function onRequestGet(context) {
  // Pages Functions の引数名ゆれ対策
  const request = context.request;
  const ctx = context.ctx || context.context || null;

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = Number(url.searchParams.get("radius") || 1200);

  if (!isFinite(lat) || !isFinite(lon) || !isFinite(radius) || radius <= 0 || radius > 5000) {
    return json({ error: "bad params (lat/lon/radius)" }, 400);
  }

  // キャッシュキー（_t が来ても無視）
  const cacheUrl = new URL(url.toString());
  cacheUrl.searchParams.delete("_t");
  const cacheKey = new Request(cacheUrl.toString(), request);

  // Cache API（使えない環境もあるのでガード）
  const cache = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const qNodeOnly = `
[out:json][timeout:12];
node(around:${radius},${lat},${lon})["amenity"="parking"];
out tags;
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

  let raw = await tryOverpass(endpoints, qNodeOnly);
  let mode = "node_only";

  if (raw && (raw.elements || []).length === 0) {
    const rawAll = await tryOverpass(endpoints, qAll);
    if (rawAll) {
      raw = rawAll;
      mode = "all";
    }
  }

  if (!raw) {
    return json({ error: "overpass failed (all endpoints)" }, 502);
  }

  const items = (raw.elements || []).map(el => {
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

  const body = {
    updatedAt: new Date().toISOString(),
    source: "OpenStreetMap / Overpass",
    mode,
    count: items.length,
    items
  };

  const resp = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=600"
    }
  });

  // waitUntil が無い環境でも落ちないように
  if (cache) {
    const putPromise = cache.put(cacheKey, resp.clone());
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(putPromise);
    else {
      // fire and forget
      putPromise.catch(() => {});
    }
  }

  return resp;
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
      return await r.json();
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
