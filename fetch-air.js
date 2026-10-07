// fetch-air.js — 에어코리아 미세먼지 예보 → 반려동물 동반 장소 지역(시군구)별 날짜 → 등급 air.json (캠핑허브와 같은 코드, 데이터만 pets.json)
//
// 왜: "별 보기 좋은 밤" 점수에 미세먼지를 넣기 위해서. 맑아도 미세먼지가 나쁘면 별이 안 보인다.
//  - 일 예보(getMinuDustFrcstDspth): 오늘·내일(·모레, 17시 발표 뒤) 19개 권역별 등급 좋음/보통/나쁨/매우나쁨. PM10·PM2.5 중 나쁜 쪽
//  - 주간 예보(getMinuDustWeekFrcstDspth): 발표일 +3~+6일 권역별 낮음/높음 (매일 발표되진 않아 최근 6일 중 가장 최신 것을 씀)
//  권역: 서울·인천·경기북부·경기남부·강원영동(영동)·강원영서(영서)·충북·충남·세종·대전·전북·전남·광주·경북·경남·대구·부산·울산·제주
// 키: TOUR_API_KEY (공공데이터포털 계정 키, 2026-10-07 "에어코리아 대기오염정보" 활용신청 승인)
// 실행 순서: fetch-pet.js → fetch-weather.js → fetch-air.js → build-pages.js

require("dotenv").config();
const fs = require("fs");

const KEY = process.env.TOUR_API_KEY;
const OUT = "air.json";
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function getItems(path, params) {
  const p = new URLSearchParams({ serviceKey: KEY, returnType: "json", numOfRows: "50", pageNo: "1", ...params });
  const res = await fetch(`https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/${path}?${p}`, { signal: AbortSignal.timeout(40000) });
  const text = await res.text();
  if (!text.trim().startsWith("{")) throw new Error("JSON 아님: " + text.slice(0, 100).replace(/\s+/g, " "));
  const data = JSON.parse(text);
  const code = data?.response?.header?.resultCode;
  if (code && code !== "00") throw new Error(data.response.header.resultMsg || "API 에러");
  if (data?.OpenAPI_ServiceResponse) throw new Error(data.OpenAPI_ServiceResponse.cmmMsgHeader?.returnAuthMsg || "인증 에러");
  return data?.response?.body?.items || [];
}

// "서울 : 좋음,제주 : 좋음,..." → { 서울: "좋음", ... }
function parseGrades(s) {
  const out = {};
  for (const part of String(s || "").split(",")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (k && v && k !== "신뢰도") out[k] = v;
  }
  return out;
}
const RANK = { 좋음: 0, 보통: 1, 나쁨: 2, 매우나쁨: 3 };
const worse = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

// 캠핑장 시도·시군구 → 에어코리아 권역 이름
const GYEONGGI_NORTH = ["고양시", "파주시", "김포시", "양주시", "의정부시", "동두천시", "포천시", "연천군", "구리시", "남양주시", "가평군"];
const GANGWON_EAST = ["강릉시", "속초시", "동해시", "삼척시", "고성군", "양양군"];
const GWANGJU_GU = ["동구", "서구", "남구", "북구", "광산구"];
function airRegion(sido, sigungu) {
  if (/서울/.test(sido)) return "서울";
  if (/인천/.test(sido)) return "인천";
  if (/경기/.test(sido)) return GYEONGGI_NORTH.includes(sigungu) ? "경기북부" : "경기남부";
  if (/강원/.test(sido)) return GANGWON_EAST.includes(sigungu) ? "영동" : "영서";
  if (/충청북|충북/.test(sido)) return "충북";
  if (/충청남|충남/.test(sido)) return "충남";
  if (/세종/.test(sido)) return "세종";
  if (/대전/.test(sido)) return "대전";
  if (/전북|전라북/.test(sido)) return "전북";
  if (/전남광주/.test(sido)) return GWANGJU_GU.includes(sigungu) ? "광주" : "전남";
  if (/광주/.test(sido)) return "광주";
  if (/전남|전라남/.test(sido)) return "전남";
  if (/경상북|경북/.test(sido)) return "경북";
  if (/경상남|경남/.test(sido)) return "경남";
  if (/대구/.test(sido)) return "대구";
  if (/부산/.test(sido)) return "부산";
  if (/울산/.test(sido)) return "울산";
  if (/제주/.test(sido)) return "제주";
  return "";
}
// 주간 예보는 "강원영서/강원영동"으로 적힘 → 일 예보 이름(영서/영동)에 맞춤
const normRegionName = (k) => k.replace(/^강원/, "");

async function main() {
  if (!KEY) { console.log("ℹ️ TOUR_API_KEY가 없어 미세먼지 수집을 건너뜁니다"); return; }
  // 캠핑장 시군구 묶음 (fetch-weather.js와 같은 키 형식: "시도 시군구")
  const normSido = (s) => String(s || "").replace(/^강원도$/, "강원특별자치도").replace(/^전라북도$/, "전북특별자치도");
  const camps = JSON.parse(fs.readFileSync("pets.json", "utf-8"));
  const keys = {};
  for (const c of camps) if (c.sigungu && c.sido && c.sido !== "기타") keys[`${c.sido} ${c.sigungu}`] = airRegion(c.sido, c.sigungu);

  // 1) 일 예보: 오늘 발표분 (없으면 어제) — 같은 날짜는 가장 늦은 발표 시각으로
  const byRegionDate = {}; // { 권역: { "2026-10-10": 등급 } }
  let updated = "";
  for (const sd of [iso(kst), iso(addDays(kst, -1))]) {
    let got = 0;
    for (const code of ["PM10", "PM25"]) {
      let items = [];
      try { items = await getItems("getMinuDustFrcstDspth", { searchDate: sd, InformCode: code }); } catch (e) { console.log(`   ⚠️ 일 예보 ${sd} ${code}: ${e.message}`); }
      const latest = {}; // informData → item (dataTime 최신)
      for (const it of items) if (!latest[it.informData] || it.dataTime > latest[it.informData].dataTime) latest[it.informData] = it;
      for (const [date, it] of Object.entries(latest)) {
        got++;
        updated = updated > it.dataTime ? updated : it.dataTime;
        for (const [region, grade] of Object.entries(parseGrades(it.informGrade))) {
          const r = (byRegionDate[region] ||= {});
          r[date] = worse(r[date], grade);
        }
      }
    }
    if (got) { console.log(`   일 예보 ${sd} 발표분 사용 (${updated})`); break; }
  }
  // 2) 주간 예보: 최근 6일 중 최신 발표분 (낮음→좋음, 높음→나쁨). 일 예보가 있는 날짜는 덮어쓰지 않음
  for (let i = 0; i <= 6; i++) {
    let items = [];
    try { items = await getItems("getMinuDustWeekFrcstDspth", { searchDate: iso(addDays(kst, -i)) }); } catch (e) { console.log(`   ⚠️ 주간 예보: ${e.message}`); break; }
    if (!items.length) continue;
    const it = items[0];
    for (const n of ["One", "Two", "Three", "Four"]) {
      const date = it[`frcst${n}Dt`], cn = it[`frcst${n}Cn`];
      if (!date || !cn) continue;
      for (const [region, g] of Object.entries(parseGrades(cn))) {
        const r = (byRegionDate[normRegionName(region)] ||= {});
        if (!r[date]) r[date] = /높음/.test(g) ? "나쁨" : "좋음";
      }
    }
    console.log(`   주간 예보 ${iso(addDays(kst, -i))} 발표분 사용 (${it.frcstOneDt}~${it.frcstFourDt})`);
    break;
  }

  const areas = {};
  for (const [key, region] of Object.entries(keys)) {
    const r = byRegionDate[region];
    if (!r) continue;
    areas[key] = Object.fromEntries(Object.entries(r).map(([d, g]) => [d.replace(/-/g, ""), g]));
  }
  const dates = [...new Set(Object.values(byRegionDate).flatMap((r) => Object.keys(r)))].sort();
  if (!dates.length) { console.log("⚠️ 받은 예보가 없어 기존 air.json을 유지합니다"); return; }
  fs.writeFileSync(OUT, JSON.stringify({ updated, dates, areas }), "utf-8");
  console.log(`✅ ${OUT} 저장 — 권역 ${Object.keys(byRegionDate).length}개, 날짜 ${dates[0]}~${dates[dates.length - 1]} (${dates.length}일), 시군구 ${Object.keys(areas).length}개`);
}

main().catch((err) => {
  console.error("❌ 미세먼지 수집 실패 (기존 air.json 유지):", err.message);
  process.exit(0);
});
