export async function onRequestGet({ request, env, ctx }) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = Number(url.searchParams.get("radius") || 1200);

  if (!isFinite(lat) || !isFinite(lon) || !isFinite(radius) || radius <= 0 || radius > 5000) {
    return json({ error: "bad params (lat/lon/radius)" }, 400);
  }

  // キャッシュ（Functions側でOverpassへの負荷を抑える）
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Overpass QL：amenity=parking を半径で取得
  // out center tags; で way/relation も中心点を返す
  const query = `
[out:json][timeout:25];
(
  node(around:${radius},${lat},${lon})["amenity"="parking"];
  way(around:${radius},${lat},${lon})["amenity"="parking"];
  relation(around:${radius},${lat},${lon})["amenity"="parking"];
);
out center tags;
`;

  const endpoint = "https://overpass-api.de/api/interpreter";
  const overpassRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({ data: query }).toString()
  });

  if (!overpassRes.ok) {
    return json({ error: "overpass failed", status: overpassRes.status }, 502);
  }

  const raw = await overpassRes.json();

  const items = (raw.elements || []).map(el => {
    const center = el.type === "node"
      ? { lat: el.lat, lon: el.lon }
      : (el.center || {});

    const tags = el.tags || {};

    return {
      id: `${el.type}:${el.id}`,
      lat: center.lat,
      lon: center.lon,

      // 名前（日本語優先→英名→空）
      name: tags["name:ja"] || tags.name || "",

      // 取れたり取れなかったりする（OSM依存）
      capacity: tags.capacity || "",
      fee: tags.fee || tags["parking:fee"] || "",
      operator: tags.operator || ""
    };
  }).filter(p => isFinite(p.lat) && isFinite(p.lon));

  const body = {
    updatedAt: new Date().toISOString(),
    source: "OpenStreetMap / Overpass",
    count: items.length,
    items
  };

  // 5分キャッシュ（患者向けには十分。Overpass保護のため）
  const resp = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300"
    }
  });

  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" }
  });
}
