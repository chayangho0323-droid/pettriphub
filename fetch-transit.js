// fetch-transit.js — 반려동물 동반 장소마다 가장 가까운 지하철역·버스정류장을 계산해 pets.json의 transit 칸에 넣는다. (API 호출 없음)
//
// 데이터:
//  - data/stations.json   전국 도시철도역 1,099곳 (철도산업정보센터 "전체_도시철도역사정보_20260630" 파일 → JSON, 연 1회 갱신)
//  - data/busstops.json.gz 전국 버스정류장 227,053곳 (국토교통부 "전국 버스정류장 위치정보" API → fetch-busstops.js, 연 1회 갱신)
// 기준: 역은 3km 안, 정류장은 800m 안 2곳(이름 중복 제거). 거리는 직선거리, 도보 시간은 분당 67m(4km/h)로 환산.
// 실행 순서: fetch-pet.js → fetch-transit.js → fetch-weather.js → fetch-air.js → build-pages.js

const fs = require("fs");
const zlib = require("zlib");

const STATION_MAX_M = 3000;
const STOP_MAX_M = 800;
const PARKING_MAX_M = 1500; // 주차장: 걸어서 20분 안

const rad = (d) => (d * Math.PI) / 180;
function distM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
}
// 0.01도(약 1.1km) 격자로 묶어 가까운 칸만 비교 (정류장 22만 곳 × 축제 400건을 전부 비교하지 않기 위해)
function buildGrid(items, latOf, lngOf) {
  const g = new Map();
  items.forEach((it, i) => {
    const k = `${Math.floor(latOf(it) * 100)},${Math.floor(lngOf(it) * 100)}`;
    (g.get(k) || g.set(k, []).get(k)).push(i);
  });
  return g;
}
function nearby(grid, items, latOf, lngOf, lat, lng, maxM) {
  const cells = Math.ceil(maxM / 1100) + 1;
  const cy = Math.floor(lat * 100), cx = Math.floor(lng * 100);
  const out = [];
  for (let dy = -cells; dy <= cells; dy++) for (let dx = -cells; dx <= cells; dx++) {
    for (const i of grid.get(`${cy + dy},${cx + dx}`) || []) {
      const d = distM(lat, lng, latOf(items[i]), lngOf(items[i]));
      if (d <= maxM) out.push({ item: items[i], dist: d });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

function main() {
  const places = JSON.parse(fs.readFileSync("pets.json", "utf-8"));
  let stations = [], stops = [];
  try { stations = JSON.parse(fs.readFileSync("data/stations.json", "utf-8")); } catch { console.log("ℹ️ data/stations.json 없음 — 지하철역 생략"); }
  try { stops = JSON.parse(zlib.gunzipSync(fs.readFileSync("data/busstops.json.gz")).toString("utf-8")).stops; } catch { console.log("ℹ️ data/busstops.json.gz 없음 — 버스정류장 생략"); }
  // 주차장: 전국주차장정보표준데이터 (fetch-parking.js → data/parking.json.gz) [이름,위도,경도,구분,유형,면수,요금,운영시간,운영일,전화]
  let lots = [];
  try { lots = JSON.parse(zlib.gunzipSync(fs.readFileSync("data/parking.json.gz")).toString("utf-8")).lots; } catch { console.log("ℹ️ data/parking.json.gz 없음 — 주차장 생략"); }
  const sg = buildGrid(stations, (s) => s.lat, (s) => s.lng);
  const bg = buildGrid(stops, (s) => s[1], (s) => s[2]);
  const pg = buildGrid(lots, (s) => s[1], (s) => s[2]);

  let withStation = 0, withStop = 0, withLot = 0, cleared = 0;
  for (const f of places) {
    const lat = Number(f.lat), lng = Number(f.lng);
    if (!(lat > 33 && lng > 124)) { if (f.transit) { delete f.transit; cleared++; } continue; }
    const transit = {};
    // 지하철: 가장 가까운 역 1곳 (같은 역이 여러 노선에 있으면 노선을 합침)
    const st = nearby(sg, stations, (s) => s.lat, (s) => s.lng, lat, lng, STATION_MAX_M);
    if (st.length) {
      const top = st[0];
      const lines = [...new Set(st.filter((x) => x.item.name === top.item.name && x.dist <= top.dist + 150).map((x) => x.item.line))];
      transit.station = { name: top.item.name, lines, dist: top.dist, walkMin: Math.max(1, Math.round(top.dist / 67)) };
      withStation++;
    }
    // 버스: 800m 안 정류장 2곳 (이름 중복 제거)
    const bs = nearby(bg, stops, (s) => s[1], (s) => s[2], lat, lng, STOP_MAX_M);
    const seen = new Set(), picked = [];
    for (const x of bs) { if (seen.has(x.item[0])) continue; seen.add(x.item[0]); picked.push({ name: x.item[0], dist: x.dist, walkMin: Math.max(1, Math.round(x.dist / 67)) }); if (picked.length >= 2) break; }
    if (picked.length) { transit.stops = picked; withStop++; }
    // 주차장: 1.5km 안 3곳. 같은 거리면 공영 우선 (민영은 300m 손해를 주고 정렬), 노상(길가) 주차는 뒤로
    const pl = nearby(pg, lots, (s) => s[1], (s) => s[2], lat, lng, PARKING_MAX_M)
      .sort((a, b) => (a.dist + (a.item[3] === "공영" ? 0 : 300) + (a.item[4] === "노상" ? 150 : 0)) - (b.dist + (b.item[3] === "공영" ? 0 : 300) + (b.item[4] === "노상" ? 150 : 0)))
      .slice(0, 3)
      .map((x) => ({ name: x.item[0], se: x.item[3], type: x.item[4], cap: x.item[5], fee: x.item[6], hours: x.item[7], days: x.item[8], tel: x.item[9], dist: x.dist, walkMin: Math.max(1, Math.round(x.dist / 67)) }));
    if (pl.length) { transit.parking = pl; withLot++; }
    if (transit.station || transit.stops || transit.parking) f.transit = transit; else delete f.transit;
  }
  fs.writeFileSync("pets.json", JSON.stringify(places, null, 2), "utf-8");
  console.log(`✅ 대중교통·주차: 장소 ${places.length}곳 중 지하철역(3km) ${withStation}건 · 버스정류장(800m) ${withStop}건 · 주차장(1.5km) ${withLot}건${cleared ? ` · 좌표 없어 제거 ${cleared}` : ""}`);
}

try { main(); } catch (err) { console.error("❌ 대중교통 계산 실패 (기존 데이터는 그대로):", err.message); process.exit(0); }
