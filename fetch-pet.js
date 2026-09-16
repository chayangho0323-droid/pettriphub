// fetch-pet.js — 반려동물 동반 가능 장소 데이터를 모아 pets.json을 만든다.
// 실행: node fetch-pet.js  (그다음 node build-pages.js)
//
// 데이터 3층 구조:
//   ① 식약처 "반려동물 동반출입 음식점" 공식 등록부 (식당·카페·베이커리, 주소만 있음)
//      → VWorld 지오코더로 좌표 변환 (하루 3만 건 무료, VWORLD_KEY 필요)
//   ② 한국관광공사 반려동물 동반여행 API (관광지·숙박·레포츠·문화시설 — 동반조건·사진 있음)
//      → 쇼핑(약국·안경원 등 8,600건)은 여행 정보가 아니라서 제외
//   ③ 캠핑허브 반려동물 캠핑장은 build-pages.js에서 링크로 연결
//
// 캐시: 어제 pets.json을 읽어 좌표·상세정보가 이미 있으면 API를 다시 부르지 않는다.
// 하루 한도(관광공사 1,000회)를 넘지 않게 상세정보는 매일 조금씩 채워진다 (자가복구 캐시).

require("dotenv").config();
const fs = require("fs");

const TOUR_KEY = process.env.TOUR_API_KEY;
const VWORLD_KEY = process.env.VWORLD_KEY;

const MFDS_URL = "https://www.foodsafetykorea.go.kr/portal/petKorea.do";
const PET_BASE = "https://apis.data.go.kr/B551011/KorPetTourService2";
const TOUR_TYPES = [
  [12, "관광지"], [14, "문화시설"], [28, "레포츠"], [32, "숙박"], [39, "식당"],
];
const DETAIL_BUDGET = 400; // 하루에 관광공사 상세정보를 채울 최대 건수 (한도 보호)
// 하루에 식약처 업소 사진을 관광공사 DB(KorService2)에서 찾아볼 최대 건수 (약 10%가 매칭됨)
// KorService2 한도(일 1,000회)는 축제 사이트와 같이 쓰므로 여유를 둔다. 환경변수로 늘릴 수 있음.
const PHOTO_BUDGET = Number(process.env.PHOTO_BUDGET) || 200;
const PHOTO_RETRY_DAYS = 90; // 못 찾은 업소는 이 기간 뒤에 다시 찾아본다 (관광공사 DB가 계속 늘어남)

// ── 공통 도우미 ─────────────────────────────────────────
function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function todayStr() {
  const d = kstNow();
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 이름+주소를 짧은 안정 ID로 (같은 데이터면 항상 같은 ID → 페이지 주소가 안 바뀜)
function hashId(prefix, s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return prefix + Math.abs(h).toString(36);
}

// 주소 → 시도 축약 / 시군구 (지역 필터·내 주변용)
const SIDO_MAP = [
  ["서울", "서울"], ["부산", "부산"], ["대구", "대구"], ["인천", "인천"], ["광주", "광주"],
  ["대전", "대전"], ["울산", "울산"], ["세종", "세종"], ["경기", "경기"], ["강원", "강원"],
  ["충청북", "충북"], ["충북", "충북"], ["충청남", "충남"], ["충남", "충남"],
  ["전라북", "전북"], ["전북", "전북"], ["전라남", "전남"], ["전남", "전남"],
  ["경상북", "경북"], ["경북", "경북"], ["경상남", "경남"], ["경남", "경남"], ["제주", "제주"],
];
const GWANGJU_GU = ["동구", "서구", "남구", "북구", "광산구"];
function sidoOf(address) {
  address = address || "";
  // 2026년 통합으로 두 데이터 모두 "전남광주통합특별시 북구 …" 식으로 옴 → 광주 5개 구는 "광주"로 분리
  if (address.startsWith("전남광주")) return GWANGJU_GU.includes(sigunguOf(address)) ? "광주" : "전남";
  for (const [p, name] of SIDO_MAP) if (address.startsWith(p)) return name;
  return "기타";
}
function sigunguOf(address) {
  return ((address || "").split(" ")[1] || "").replace(/\(.*$/, "");
}

// ── ① 식약처 공식 등록부 파싱 ─────────────────────────────
async function fetchMfds() {
  const res = await fetch(MFDS_URL, { headers: { "User-Agent": "Mozilla/5.0 PetTripHub" } });
  if (!res.ok) throw new Error(`식약처 페이지 HTTP ${res.status}`);
  const html = await res.text();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const out = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\s+/g, " ").trim()
    );
    if (cells.length < 5 || !/^\d+$/.test(cells[0])) continue;
    const [, name, biz, , address] = cells;
    if (!name || !address) continue;
    // 업종 → 우리 카테고리
    const category = biz.includes("제과") ? "베이커리" : biz.includes("휴게") ? "카페" : "식당";
    out.push({
      id: hashId("m", name + "|" + address),
      name,
      category,
      biz, // 원본 업종 (일반음식점/휴게음식점/제과점영업)
      sido: sidoOf(address),
      sigungu: sigunguOf(address),
      address,
      official: true, // 식약처 공식 등록 업소 (신뢰 배지)
      source: "mfds",
    });
  }
  if (out.length < 500) throw new Error(`식약처 파싱 결과가 너무 적음 (${out.length}건) — 페이지 구조가 바뀌었을 수 있음`);
  return out;
}

// ── VWorld 지오코딩 (주소 → 좌표) ─────────────────────────
async function geocode(address) {
  if (!VWORLD_KEY) return null;
  // 괄호 안 상세(층·호수)는 빼고 도로명 주소만 — 매칭률이 올라간다
  const clean = address.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  for (const type of ["road", "parcel"]) {
    try {
      const params = new URLSearchParams({
        service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326",
        address: clean, refine: "true", simple: "true", format: "json", type, key: VWORLD_KEY,
      });
      const res = await fetch(`https://api.vworld.kr/req/address?${params}`);
      const data = await res.json();
      const p = data?.response?.result?.point;
      if (data?.response?.status === "OK" && p) return { lat: Number(p.y), lng: Number(p.x) };
    } catch {}
  }
  return null;
}

// ── ② 관광공사 반려동물 API ───────────────────────────────
async function petApi(op, extra) {
  const params = new URLSearchParams({
    serviceKey: TOUR_KEY, MobileOS: "ETC", MobileApp: "PetTripHub", _type: "json",
    numOfRows: "100", pageNo: "1", ...extra,
  });
  const res = await fetch(`${PET_BASE}/${op}?${params}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error("XML 에러 응답 (키/한도 확인)");
  const data = JSON.parse(text);
  if (data?.response?.header?.resultCode !== "0000") throw new Error(`API 에러 ${data?.response?.header?.resultCode}`);
  const body = data.response.body;
  let items = body?.items?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return { items, total: Number(body?.totalCount ?? 0) };
}

async function fetchTourList() {
  const all = [];
  for (const [typeId, category] of TOUR_TYPES) {
    let page = 1, total = Infinity;
    while ((page - 1) * 100 < total && page <= 20) {
      const { items, total: t } = await petApi("areaBasedList2", { contentTypeId: String(typeId), pageNo: String(page), arrange: "A" });
      total = t;
      for (const it of items) {
        all.push({
          id: String(it.contentid),
          name: it.title,
          category,
          sido: sidoOf(it.addr1),
          sigungu: sigunguOf(it.addr1),
          address: it.addr1 || "",
          lat: it.mapy ? Number(it.mapy) : null,
          lng: it.mapx ? Number(it.mapx) : null,
          image: it.firstimage || "",
          tel: it.tel || "",
          official: false,
          source: "tour",
        });
      }
      page++;
      await sleep(100);
    }
  }
  return all;
}

// 동반 조건 (detailPetTour2) — 반려인이 진짜 궁금한 정보
async function fetchPetInfo(contentid) {
  try {
    const { items } = await petApi("detailPetTour2", { contentId: contentid });
    const d = items[0];
    if (!d) return {};
    return {
      petSize: d.acmpyPsblCpam || "",     // 동반 가능 반려동물 크기 (예: 소형견만)
      petType: d.acmpyTypeCd || "",       // 동반 유형 (실내/실외 등)
      petNeed: d.acmpyNeedMtr || "",      // 준비물 (목줄, 케이지 등)
      petEtc: d.etcAcmpyInfo || "",       // 기타 안내
      petFacility: d.relPosesFclty || "", // 반려동물 시설
      petRisk: d.relaAcdntRiskMtr || "",  // 사고 위험 안내
    };
  } catch {
    return null; // null = 실패 → 다음 실행에 재시도
  }
}

// 소개글 (detailCommon2)
async function fetchOverview(contentid) {
  try {
    const { items } = await petApi("detailCommon2", { contentId: contentid });
    const d = items[0];
    return d ? { overview: (d.overview || "").replace(/<[^>]+>/g, "").trim(), homepage: (d.homepage || "").match(/https?:\/\/[^"'\s<>]+/)?.[0] || "" } : { overview: "", homepage: "" };
  } catch {
    return null;
  }
}

// ── 식약처 업소 사진 빌려오기 ──────────────────────────────
// 식약처 등록부에는 사진이 없다. 같은 이름의 가게가 관광공사 DB(searchKeyword2)에 있으면
// 그 사진을 쓴다 (축제 사이트의 fetchTourMatch와 같은 방식). 이름+시도+시군구가 모두 맞아야 채택.
const normName = (s) => String(s || "")
  .replace(/\(.*?\)/g, "").replace(/\(주\)|㈜|주식회사/g, "")
  .replace(/\s|[()\[\]<>·,.'"&-]/g, "").toLowerCase();
async function fetchPhotoMatch(p) {
  const keyword = String(p.name).replace(/\(주\)|㈜|주식회사/g, "").replace(/\(.*?\)/g, "").trim();
  if (keyword.length < 2) return { image: "" };
  try {
    const params = new URLSearchParams({
      serviceKey: TOUR_KEY, MobileOS: "ETC", MobileApp: "PetTripHub", _type: "json",
      numOfRows: "10", pageNo: "1", arrange: "A", keyword,
    });
    const res = await fetch(`https://apis.data.go.kr/B551011/KorService2/searchKeyword2?${params}`);
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("XML");
    const data = JSON.parse(text);
    if (data?.response?.header?.resultCode !== "0000") throw new Error("API");
    let items = data?.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    const target = normName(p.name);
    const hit = items.find((it) => {
      const a = normName(it.title);
      if (!a || !target || !it.firstimage) return false;
      if (sidoOf(it.addr1) !== p.sido) return false;
      if (p.sigungu && !(it.addr1 || "").includes(p.sigungu)) return false;
      return a === target || (a.length >= 3 && target.length >= 3 && (a.includes(target) || target.includes(a)));
    });
    return { image: hit ? hit.firstimage : "", tourId: hit ? String(hit.contentid) : "" };
  } catch {
    return null; // 실패 → 다음 실행에 재시도
  }
}
function daysBetween(yyyymmdd) {
  if (!yyyymmdd) return Infinity;
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6) - 1, d = +yyyymmdd.slice(6, 8);
  return (kstNow() - Date.UTC(y, m, d)) / 86400000;
}

// ── 메인 ────────────────────────────────────────────────
async function main() {
  if (!TOUR_KEY) {
    console.error("❌ .env에 TOUR_API_KEY가 없습니다");
    process.exit(1);
  }

  // 캐시 (어제 결과)
  const cache = {};
  try {
    for (const p of JSON.parse(fs.readFileSync("pets.json", "utf-8"))) cache[p.id] = p;
    console.log(`♻️  캐시 ${Object.keys(cache).length}건 로드`);
  } catch {}

  // ① 식약처
  let mfds = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      mfds = await fetchMfds();
      break;
    } catch (err) {
      console.log(`⚠️ 식약처 수집 실패 (${attempt}/3): ${err.message}`);
      if (attempt < 3) await sleep(30000);
    }
  }
  if (!mfds.length) {
    mfds = Object.values(cache).filter((p) => p.source === "mfds");
    console.log(`   → 기존 데이터 ${mfds.length}건 유지`);
  } else {
    console.log(`🍽️ 식약처 공식 등록 업소 ${mfds.length}건`);
  }

  // 좌표 변환 (캐시에 있으면 재사용, 없으면 VWorld)
  let geoNew = 0, geoFail = 0;
  for (const p of mfds) {
    const c = cache[p.id];
    if (c && c.lat && c.lng) {
      p.lat = c.lat; p.lng = c.lng;
      continue;
    }
    const g = await geocode(p.address);
    if (g) { p.lat = g.lat; p.lng = g.lng; geoNew++; }
    else { p.lat = null; p.lng = null; geoFail++; }
    if (VWORLD_KEY) await sleep(60);
  }
  console.log(`📍 좌표 변환: 새로 ${geoNew}건 / 실패 ${geoFail}건 ${VWORLD_KEY ? "" : "(VWORLD_KEY 없음 — 건너뜀)"}`);

  // 사진 빌려오기 (캐시 우선, 아직 안 찾아본 업소만 하루 예산 내에서)
  let photoTried = 0, photoNew = 0;
  for (const p of mfds) {
    const c = cache[p.id] || {};
    p.image = c.image || "";
    p.tourId = c.tourId || "";
    p.photoTried = c.photoTried || "";
    if (p.image) continue;
    if (photoTried >= PHOTO_BUDGET || daysBetween(p.photoTried) < PHOTO_RETRY_DAYS) continue;
    const m = await fetchPhotoMatch(p);
    photoTried++;
    if (m) {
      p.photoTried = todayStr();
      if (m.image) { p.image = m.image; p.tourId = m.tourId; photoNew++; }
    }
    await sleep(120);
  }
  console.log(`📷 사진 찾기: 오늘 ${photoTried}곳 시도, 새로 ${photoNew}곳 (누적 ${mfds.filter((p) => p.image).length}/${mfds.length})`);

  // ② 관광공사
  let tour = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      tour = await fetchTourList();
      break;
    } catch (err) {
      console.log(`⚠️ 관광공사 목록 실패 (${attempt}/3): ${err.message}`);
      if (attempt < 3) await sleep(60000);
    }
  }
  if (!tour.length) {
    tour = Object.values(cache).filter((p) => p.source === "tour");
    console.log(`   → 기존 데이터 ${tour.length}건 유지`);
  } else {
    console.log(`🏞️ 관광공사 반려동물 장소 ${tour.length}건`);
  }

  // 상세정보(동반조건·소개)는 캐시 우선, 없는 것만 하루 예산 내에서 채움
  let filled = 0;
  for (const p of tour) {
    const c = cache[p.id] || {};
    const hasPet = c.petInfo && typeof c.petInfo === "object";
    const hasOv = typeof c.overview === "string";
    p.petInfo = hasPet ? c.petInfo : undefined;
    p.overview = hasOv ? c.overview : undefined;
    p.homepage = c.homepage || "";
    if ((!hasPet || !hasOv) && filled < DETAIL_BUDGET) {
      if (!hasPet) {
        const info = await fetchPetInfo(p.id);
        if (info) p.petInfo = info;
      }
      if (!hasOv) {
        const ov = await fetchOverview(p.id);
        if (ov) { p.overview = ov.overview; p.homepage = ov.homepage; }
      }
      filled++;
      await sleep(80);
    }
    if (p.petInfo === undefined) p.petInfo = null; // null = 아직 못 받음 (다음에 재시도)
    if (p.overview === undefined) p.overview = null;
  }
  console.log(`📖 상세정보 채움: 오늘 ${filled}건 (누적 ${tour.filter((p) => p.petInfo).length}/${tour.length})`);

  const pets = [...mfds, ...tour];
  // 처음 등장한 날짜 (RSS "새로 추가된 장소"용). 캐시에 있던 곳은 기존 날짜, 기록 없으면 사이트 오픈일
  let added = 0;
  for (const p of pets) {
    const c = cache[p.id];
    p.addedAt = c ? c.addedAt || "20260915" : todayStr();
    if (!c) added++;
  }
  if (Object.keys(cache).length) console.log(`🆕 새로 추가된 장소 ${added}곳`);
  fs.writeFileSync("pets.json", JSON.stringify(pets, null, 2), "utf-8");
  console.log(`✅ pets.json 저장 — 총 ${pets.length}곳 (식약처 ${mfds.length} + 관광공사 ${tour.length})`);
}

main().catch((err) => {
  console.error("❌ 실패:", err.message);
  process.exit(1);
});
