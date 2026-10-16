// fetch-local.js — 네이버 지역 검색(NAVER API HUB)으로 장소마다 네이버 지도 등록 정보를 받아 local.json에 캐시
//
// 왜: 식약처 업소 2,800곳은 이름·주소·업종(일반음식점/휴게음식점)밖에 없다. 네이버 지도에 등록된 가게는
//     홈페이지·인스타그램·예약(캐치테이블 등) 링크, 세부 업종("음식점>카페,디저트"), 가게 정확 좌표를 준다.
//     전화번호(telephone)는 네이버가 더 이상 내려주지 않아(2026-10-16 확인, 전부 빈칸) 못 채운다 — LOCALDATA 복구 때 처리.
//     네이버에 같은 이름 업소가 없으면 found:false → 상세에 "방문 전 영업 여부 확인" 안내 (폐업 추정 신호, 삭제는 안 함).
//
// API: GET https://naverapihub.apigw.ntruss.com/search/v1/local?query=…&display=5  (헤더는 fetch-reviews.js와 같음, 하루 25,000회 공용)
//   응답 mapx/mapy = 경도·위도 × 10^7 (WGS84)
// 방식: "시군구 장소명" 5개 → 제목이 장소명과 같거나 서로 포함 + (주소에 시군구 포함 또는 좌표 2km 이내) 인 첫 결과 채택.
//   30일 캐시, 한 번에 LOCAL_BUDGET(기본 300)곳: 캐시 없는 곳 → 오래된 곳 순.
// 실행 순서: fetch-pet.js → fetch-reviews.js → fetch-local.js → build-pages.js

require("dotenv").config({ quiet: true });
const fs = require("fs");

const ID = process.env.NAVER_CLIENT_ID;
const SECRET = process.env.NAVER_CLIENT_SECRET;
const OUT = "local.json";
const BUDGET = Number(process.env.LOCAL_BUDGET || 300);
const TTL_DAYS = 30;
const kst = () => new Date(Date.now() + 9 * 3600 * 1000);
const TODAY = kst().toISOString().slice(0, 10).replace(/-/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!ID || !SECRET) { console.log("⚠️ NAVER_CLIENT_ID/SECRET 없음 — 네이버 지역 정보 수집 건너뜀"); process.exit(0); }

const pets = JSON.parse(fs.readFileSync("pets.json", "utf-8"));
let cache = { updated: "", places: {} };
try { cache = JSON.parse(fs.readFileSync(OUT, "utf-8")); } catch {}
if (!cache.places) cache.places = {};

const stripName = (n) => String(n || "")
  .replace(/\((주|유|합|사|재)\)|주식회사|유한회사|㈜/g, " ")
  .replace(/\[[^\]]*\]/g, " ")
  .replace(/\s+/g, " ").trim();
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").trim();
const norm = (s) => stripTags(s).replace(/[\s·:,\-'"“”‘’!?.~()\[\]&]/g, "").toLowerCase();
// "툭툭누들타이(티티그릴)" → ["툭툭누들타이티티그릴", "툭툭누들타이", "티티그릴"] 괄호 안 별칭도 이름으로 인정
const nameForms = (name) => {
  const forms = new Set([norm(name)]);
  const m = name.match(/^(.*?)\(([^)]+)\)\s*$/);
  if (m) { forms.add(norm(m[1])); forms.add(norm(m[2])); }
  return [...forms].filter((f) => f.length >= 2);
};
const distKm = (a, b, c, d) => { const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLng = ((d - b) * Math.PI) / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

function pickMatch(p, name, items) {
  const forms = nameForms(name);
  for (const it of items) {
    const t = norm(it.title);
    if (!t) continue;
    const nameOk = forms.some((f) => t === f || (f.length >= 3 && t.includes(f)) || (t.length >= 3 && f.includes(t) && t.length >= f.length * 0.6));
    if (!nameOk) continue;
    const lat = it.mapy ? Number(it.mapy) / 1e7 : null, lng = it.mapx ? Number(it.mapx) / 1e7 : null;
    const addr = `${it.address || ""} ${it.roadAddress || ""}`;
    const areaOk = (p.sigungu && addr.includes(p.sigungu)) || (lat && p.lat && distKm(p.lat, p.lng, lat, lng) <= 2);
    if (!areaOk) continue;
    return { title: stripTags(it.title), link: String(it.link || "").trim(), category: it.category || "", roadAddress: it.roadAddress || it.address || "", lat, lng };
  }
  return null;
}

async function searchLocal(query) {
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/local?query=${encodeURIComponent(query)}&display=5`;
  const res = await fetch(url, { headers: { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }, signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("인증 실패 " + res.status), { fatal: true });
  if (res.status === 429) throw Object.assign(new Error("하루 호출 한도 초과(429)"), { fatal: true });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return (await res.json()).items || [];
}

(async () => {
  const stale = (e) => !e || !e.at || (Date.parse(`${e.at.slice(0, 4)}-${e.at.slice(4, 6)}-${e.at.slice(6, 8)}`) < Date.now() - TTL_DAYS * 86400000);
  const todo = pets
    .map((p) => ({ p, name: stripName(p.name), e: cache.places[p.id] }))
    .filter((x) => norm(x.name).length >= 2 && stale(x.e))
    .sort((a, b) => (a.e ? 1 : 0) - (b.e ? 1 : 0) || String(a.e?.at || "").localeCompare(String(b.e?.at || "")))
    .slice(0, BUDGET);
  console.log(`📍 네이버 지역 정보 수집: 대상 ${todo.length}곳 (전체 ${pets.length}, 캐시 ${Object.keys(cache.places).length}, 예산 ${BUDGET})`);

  let done = 0, found = 0, calls = 0;
  for (const { p, name } of todo) {
    const query = `${p.sigungu || p.sido || ""} ${name}`.trim();
    try {
      calls++;
      let items = await searchLocal(query);
      let m = pickMatch(p, name, items);
      // 괄호 별칭이 있는 이름은 괄호 앞부분만으로 한 번 더 (예: "Hrr(흐르르)" → "Hrr"가 0건이면 "흐르르")
      if (!m && /\(/.test(name)) {
        const alt = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
        const alias = (name.match(/\(([^)]+)\)/) || [])[1];
        for (const q of [alt, alias].filter((s) => s && norm(s).length >= 2)) {
          calls++; await sleep(120);
          items = await searchLocal(`${p.sigungu || p.sido || ""} ${q}`.trim());
          m = pickMatch(p, name, items);
          if (m) break;
        }
      }
      cache.places[p.id] = m ? { at: TODAY, q: query, found: true, ...m } : { at: TODAY, q: query, found: false };
      done++; if (m) found++;
      if (done % 50 === 0) { console.log(`  … ${done}/${todo.length} (네이버 등록 확인 ${found})`); fs.writeFileSync(OUT, JSON.stringify(cache), "utf-8"); }
      await sleep(120);
    } catch (e) {
      if (e.fatal) { console.log("⛔ 중단:", e.message); break; }
      console.log(`  ! ${p.name}: ${e.message}`);
      await sleep(1000);
    }
  }
  cache.updated = TODAY;
  fs.writeFileSync(OUT, JSON.stringify(cache), "utf-8");
  const all = Object.values(cache.places);
  const withLink = all.filter((e) => e.found && e.link).length;
  console.log(`✅ ${OUT}: 이번 ${done}곳 처리(등록 확인 ${found}, 호출 ${calls}) · 누적 ${all.length}곳 중 등록 ${all.filter((e) => e.found).length}, 링크 있음 ${withLink}`);
})();
