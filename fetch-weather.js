// fetch-weather.js — 기상청 단기예보·중기예보로 반려동물 동반 장소 지역(시군구)별 7일 날씨를 weather.json에 저장한다.
// 캠핑허브 fetch-weather.js와 같은 코드. 차이: 데이터 파일 pets.json, 시도가 "제주"처럼 짧은 이름(정규식에 짧은 이름 추가), '기타' 시도 제외.
//
// 왜: 캠핑은 "이번 주말 비 오나?"가 예약을 결정한다. 상위 유입 페이지가 신규 캠핑장(정보 없음)이라
// 날씨·주말 적합도가 머물 이유가 된다. (2026-10-06 사용자 요청)
//
// 호출 방식: 캠핑장 3,100곳을 하나씩 부르지 않고 시군구(188개)로 묶어 그 시군구 캠핑장들의 평균 좌표로 1회 호출.
//  - 단기예보(getVilageFcst, 5km 격자): 오늘~3일 뒤 시간별 → 날짜별 비 확률 최대값·하늘·최저/최고 기온
//  - 중기육상예보(getMidLandFcst, 전국 11개 권역): 4~6일 뒤 비 확률·하늘
//  - 중기기온(getMidTa, 시도 대표 도시): 4~6일 뒤 최저/최고 기온
// 키: TOUR_API_KEY (공공데이터포털 계정 키 하나로 기상청 두 서비스 활용신청 승인됨, 2026-10-06)
// 실행 순서: fetch-campings.js → fetch-weather.js → build-pages.js (실패해도 기존 weather.json 유지)

require("dotenv").config();
const fs = require("fs");

const KEY = process.env.TOUR_API_KEY;
const OUT = "weather.json";
const DAYS = 7;

// ── 시간 (한국시간) ──
const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 단기예보 발표 시각(02,05,…,23시)은 발표 10분 뒤부터 조회 가능 → 지금 기준 가장 최근 것
function shortBase() {
  const h = nowKst.getUTCHours(), m = nowKst.getUTCMinutes();
  const times = [2, 5, 8, 11, 14, 17, 20, 23];
  let day = nowKst, bt = times.filter((t) => h > t || (h === t && m >= 10)).pop();
  if (bt === undefined) { day = addDays(nowKst, -1); bt = 23; }
  return { base_date: ymd(day), base_time: String(bt).padStart(2, "0") + "00" };
}
// 중기예보는 06시·18시 발표
function midBase() {
  const h = nowKst.getUTCHours(), m = nowKst.getUTCMinutes();
  if (h > 18 || (h === 18 && m >= 10)) return ymd(nowKst) + "1800";
  if (h > 6 || (h === 6 && m >= 10)) return ymd(nowKst) + "0600";
  return ymd(addDays(nowKst, -1)) + "1800";
}

// ── 위경도 → 기상청 5km 격자 (기상청 공식 LCC 변환식) ──
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5, SLAT1 = 30, SLAT2 = 60, OLON = 126, OLAT = 38, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, ol = OLON * D, oa = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5); sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + oa * 0.5); ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5); ra = (re * sf) / Math.pow(ra, sn);
  let th = lon * D - ol; if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI; th *= sn;
  return { nx: Math.floor(ra * Math.sin(th) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(th) + YO + 0.5) };
}

// ── 지역 코드 ──
// 시도 표기 통일 (고캠핑 데이터에 "강원도"와 "강원특별자치도"가 섞여 있음)
const normSido = (s) => String(s || ""); // 펫트립 시도는 이미 짧은 이름
// 중기육상예보 권역 코드
const GANGWON_EAST = ["강릉시", "속초시", "동해시", "삼척시", "고성군", "양양군"];
function landRegId(sido, sigungu) {
  if (/서울|인천|경기/.test(sido)) return "11B00000";
  if (/강원/.test(sido)) return GANGWON_EAST.includes(sigungu) ? "11D20000" : "11D10000";
  if (/충북|충청북/.test(sido)) return "11C10000";
  if (/대전|세종|충남|충청남/.test(sido)) return "11C20000";
  if (/전북/.test(sido)) return "11F10000";
  if (/전남|광주/.test(sido)) return "11F20000";
  if (/대구|경북|경상북/.test(sido)) return "11H10000";
  if (/부산|울산|경남|경상남/.test(sido)) return "11H20000";
  if (/제주/.test(sido)) return "11G00000";
  return "11B00000";
}
// 중기기온 대표 도시 코드 (시도마다 1곳 — 4~6일 뒤 기온은 "대표 도시 기준"으로 표시)
function taRegId(sido, sigungu) {
  if (/서울/.test(sido)) return "11B10101";
  if (/인천/.test(sido)) return "11B20201";
  if (/경기/.test(sido)) return "11B20601"; // 수원
  if (/강원/.test(sido)) return GANGWON_EAST.includes(sigungu) ? "11D20501" : "11D10301"; // 강릉 / 춘천
  if (/충북|충청북/.test(sido)) return "11C10301"; // 청주
  if (/대전/.test(sido)) return "11C20401";
  if (/세종/.test(sido)) return "11C20404";
  if (/충남|충청남/.test(sido)) return "11C20104"; // 홍성
  if (/전북/.test(sido)) return "11F10201"; // 전주
  if (/광주/.test(sido)) return "11F20501";
  if (/전남/.test(sido)) return "11F20401"; // 목포
  if (/대구/.test(sido)) return "11H10701";
  if (/경북|경상북/.test(sido)) return "11H10501"; // 안동
  if (/부산/.test(sido)) return "11H20201";
  if (/울산/.test(sido)) return "11H20101";
  if (/경남|경상남/.test(sido)) return "11H20301"; // 창원
  if (/제주/.test(sido)) return "11G00201";
  return "11B10101";
}

// ── API 호출 ──
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!text.trim().startsWith("{")) throw new Error("JSON 아님: " + text.slice(0, 100).replace(/\s+/g, " "));
  const data = JSON.parse(text);
  const code = data?.response?.header?.resultCode;
  if (code === "03") return []; // NO_DATA
  if (code !== "00") throw new Error(data?.response?.header?.resultMsg || "API 에러");
  let items = data.response.body?.items?.item ?? [];
  return Array.isArray(items) ? items : [items];
}
const SKY_TXT = { 1: "맑음", 3: "구름많음", 4: "흐림" };
const PTY_TXT = { 1: "비", 2: "비/눈", 3: "눈", 4: "소나기" };

async function fetchShort(nx, ny, base) {
  // 3일 치 시간별 × 12항목 ≈ 1,100~1,300행이라 한 페이지(1,000행)로는 마지막 날이 잘린다 → 다 받을 때까지 페이지를 넘긴다
  const items = [];
  for (let page = 1; page <= 4; page++) {
    const p = new URLSearchParams({ serviceKey: KEY, numOfRows: "1000", pageNo: String(page), dataType: "JSON", base_date: base.base_date, base_time: base.base_time, nx, ny });
    const chunk = await getJson(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${p}`);
    items.push(...chunk);
    if (chunk.length < 1000) break;
  }
  // 날짜별로 접기: 비 확률 최대, 낮(09~18시) 하늘, 강수형태, 최저/최고
  const days = {};
  for (const it of items) {
    const d = (days[it.fcstDate] ||= { pop: 0, sky: {}, pty: 0, tmn: null, tmx: null, tmp: [] });
    const v = Number(it.fcstValue), h = Number(it.fcstTime.slice(0, 2));
    if (it.category === "POP") d.pop = Math.max(d.pop, v);
    else if (it.category === "SKY" && h >= 9 && h <= 18) d.sky[v] = (d.sky[v] || 0) + 1;
    else if (it.category === "PTY" && v > 0) d.pty = d.pty || v;
    else if (it.category === "TMN") d.tmn = v;
    else if (it.category === "TMX") d.tmx = v;
    else if (it.category === "TMP") d.tmp.push(v);
  }
  const out = {};
  for (const [date, d] of Object.entries(days)) {
    const skyCode = Object.entries(d.sky).sort((a, b) => b[1] - a[1])[0]?.[0];
    // 오늘은 TMN/TMX가 이미 지난 시각이라 빠질 수 있음 → 남은 시간대 TMP로 대체
    const tmn = d.tmn ?? (d.tmp.length ? Math.min(...d.tmp) : null);
    const tmx = d.tmx ?? (d.tmp.length ? Math.max(...d.tmp) : null);
    out[date] = { pop: d.pop, sky: d.pty ? PTY_TXT[d.pty] : SKY_TXT[skyCode] || "", pty: d.pty, tmn, tmx, src: "short", complete: d.tmp.length >= 12 };
  }
  return out;
}

async function main() {
  if (!KEY) { console.log("ℹ️ TOUR_API_KEY가 없어 날씨 수집을 건너뜁니다"); return; }
  const camps = JSON.parse(fs.readFileSync("pets.json", "utf-8"));

  // 시군구별 평균 좌표
  const areas = {};
  for (const c of camps) {
    if (!c.lat || !c.lng || !c.sigungu || !c.sido || c.sido === "기타") continue;
    const key = `${normSido(c.sido)} ${c.sigungu}`;
    const a = (areas[key] ||= { sido: normSido(c.sido), sigungu: c.sigungu, lat: 0, lng: 0, n: 0 });
    a.lat += Number(c.lat); a.lng += Number(c.lng); a.n++;
  }
  for (const a of Object.values(areas)) { a.lat /= a.n; a.lng /= a.n; Object.assign(a, toGrid(a.lat, a.lng)); }
  console.log(`🌤️ 날씨 수집: 장소 ${camps.length}곳 → 시군구 ${Object.keys(areas).length}개`);

  const base = shortBase(), tmFc = midBase();
  const dates = Array.from({ length: DAYS }, (_, i) => ymd(addDays(nowKst, i)));
  const midIndexOf = (date) => Math.round((new Date(date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6)) - new Date(tmFc.slice(0, 4) + "-" + tmFc.slice(4, 6) + "-" + tmFc.slice(6, 8))) / 86400000);

  // 중기예보(권역·대표도시) 캐시 — 같은 코드는 한 번만
  const landCache = {}, taCache = {};
  const land = async (id) => landCache[id] ??= (await getJson(`https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?${new URLSearchParams({ serviceKey: KEY, numOfRows: "10", pageNo: "1", dataType: "JSON", regId: id, tmFc })}`).catch((e) => (console.log(`   ⚠️ 중기육상 ${id}: ${e.message}`), [])))[0] || {};
  const ta = async (id) => taCache[id] ??= (await getJson(`https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?${new URLSearchParams({ serviceKey: KEY, numOfRows: "10", pageNo: "1", dataType: "JSON", regId: id, tmFc })}`).catch((e) => (console.log(`   ⚠️ 중기기온 ${id}: ${e.message}`), [])))[0] || {};

  const result = { updated: `${base.base_date.slice(0, 4)}-${base.base_date.slice(4, 6)}-${base.base_date.slice(6)} ${base.base_time.slice(0, 2)}:00`, areas: {} };
  let ok = 0, fail = 0;
  const keys = Object.keys(areas);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], a = areas[key];
    let short = {};
    try { short = await fetchShort(a.nx, a.ny, base); ok++; } catch (e) { fail++; console.log(`   ⚠️ 단기예보 ${key}: ${e.message}`); }
    const mid = await land(landRegId(a.sido, a.sigungu));
    const temp = await ta(taRegId(a.sido, a.sigungu));
    const days = dates.map((date, i) => {
      const dow = DOW[new Date(date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6) + "T00:00:00").getDay()];
      const s = short[date];
      const k = midIndexOf(date);
      // 단기예보가 그날을 온전히 덮으면 단기, 아니면 중기(4일 뒤부터) — 중기도 없는 날(3일 뒤)은 부분 단기라도 사용
      if (s && (i < 3 || s.complete || k < 4)) return { date, dow, pop: s.pop, sky: s.sky, pty: s.pty, tmn: s.tmn, tmx: s.tmx, src: "short" };
      if (k >= 4 && k <= 10) {
        const popAm = mid[`rnSt${k}Am`], popPm = mid[`rnSt${k}Pm`], popDay = mid[`rnSt${k}`];
        const pop = popDay ?? (popAm != null ? Math.max(popAm, popPm ?? 0) : null);
        const sky = mid[`wf${k}Pm`] ?? mid[`wf${k}Am`] ?? mid[`wf${k}`] ?? "";
        if (pop == null && !sky) return null;
        return { date, dow, pop, sky, pty: /비|눈|소나기/.test(sky) ? 1 : 0, tmn: temp[`taMin${k}`] ?? null, tmx: temp[`taMax${k}`] ?? null, src: "mid" };
      }
      return null;
    }).filter(Boolean);
    if (days.length) result.areas[key] = { sigungu: a.sigungu, days };
    if ((i + 1) % 40 === 0) console.log(`   ${i + 1}/${keys.length}`);
  }

  // 단기예보가 대부분 실패했으면(기상청 장애) 기존 파일을 지키고 끝낸다
  if (ok < keys.length * 0.5 && fs.existsSync(OUT)) {
    console.log(`⚠️ 단기예보 성공 ${ok}/${keys.length} — 기존 ${OUT}을 유지합니다`);
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(result), "utf-8");
  console.log(`✅ ${OUT} 저장 — 시군구 ${Object.keys(result.areas).length}개, 발표 ${result.updated} (단기 성공 ${ok}, 실패 ${fail}, 중기 권역 ${Object.keys(landCache).length}·도시 ${Object.keys(taCache).length})`);
}

main().catch((err) => {
  console.error("❌ 날씨 수집 실패 (기존 weather.json 유지):", err.message);
  process.exit(0);
});
