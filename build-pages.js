// build-pages.js — pets.json을 읽어 장소별 HTML 페이지 + 카테고리/지역 페이지 + sitemap을 만든다.
// 실행: node build-pages.js  (fetch-pet.js 실행 뒤에)
// FestivalHub/CampingHub와 같은 구조 (정적 페이지 → GitHub Pages → 검색엔진)

const fs = require("fs");
const path = require("path");

const SITE_URL = "https://pettriphub.kr";
const SITE_NAME = "PetTripHub";

// 구글 애널리틱스 측정 ID — 발급받으면 여기에 넣는다 (비어 있으면 통계 코드 생략)
const GA_ID = "G-X518CVXSC1";
const GA_SNIPPET = GA_ID
  ? `
  <!-- Google Analytics (방문자 통계) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>`
  : "";
// Google AdSense (같은 게시자 계정 — 사이트 추가 후 광고 게재)
const ADS_SNIPPET = `
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5951913667078413" crossorigin="anonymous"></script>`;
// 제보 안내 제목용 둥근 글씨체 (구글 폰트 Jua, 무료) — index/about.html에도 같은 링크 있음
const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap" />`;
const HEAD_COMMON = FONT_LINK + GA_SNIPPET + ADS_SNIPPET;
// 정적 파일 캐시 무력화 — 매일 빌드 날짜가 붙어 style.css 변경이 방문자에게 바로 반영됨
const BUILD_VER = (() => { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; })();

// 쿠팡 파트너스 (반려용품) — 링크가 생기면 채운다. 비어 있으면 섹션 자체가 안 나옴
const COUPANG_ITEMS = [];

const pets = JSON.parse(fs.readFileSync("pets.json", "utf-8"));

// ─── 방문자 사진 제보 (공통 모듈 visitor-photos.js — 세 사이트 동일) ───
// 받은 사진: photos/ 폴더 + photos.json → 상세 "📸 방문자 사진" 갤러리. 공식 사진 없는 곳은 첫 제보 사진이 대표 사진.
const VP = require("./visitor-photos");
const REPORT_EMAIL = "chayangho0323@gmail.com";
const visitorPhotos = VP.loadVisitorPhotos(SITE_URL);
let manualCount = 0;
for (const p of pets) {
  const list = visitorPhotos[p.id];
  if (!list) continue;
  p.visitorPhotos = list;
  if (!p.image) { p.image = list[0].image; p.photoCredit = list[0].credit; }
  manualCount++;
}
if (manualCount) console.log(`📷 방문자 사진 ${manualCount}곳 적용`);

function reportMailto(p) {
  return VP.reportMailto(p
    ? { email: REPORT_EMAIL, siteName: SITE_NAME, name: p.name, where: `${p.sido} ${p.sigungu}`.trim(), pageUrl: `${SITE_URL}/place/${p.id}.html` }
    : { email: REPORT_EMAIL, siteName: SITE_NAME });
}
// 사진 제보 안내 띠 — p가 있으면 상세 페이지용, null이면 목록 페이지용 (index.html에도 같은 문구가 있음)
function photoCallHtml(p) {
  const text = !p
    ? "우리 댕댕이·냥이와 다녀온 사진을 자랑해 주세요! 식약처 등록 카페·식당은 공식 사진이 없어서 더 반가워요. <strong>닉네임과 함께</strong> 올려드려요."
    : `이곳에 다녀오셨나요? 반려동물과 함께 찍은 사진, 예쁜 사진을 자랑해 주세요 — <strong>닉네임과 함께</strong> 이 페이지에 올려드려요.`;
  return VP.photoCallHtml({ title: "사진 제보 받아요!", text, href: reportMailto(p) });
}

// ─── 카테고리 / 지역 정의 (app.js와 같은 표. 수정 시 양쪽 다!) ───
const CATS = [
  { key: "카페", slug: "cafe", icon: "☕", desc: "반려동물과 함께 들어갈 수 있는 카페" },
  { key: "식당", slug: "restaurant", icon: "🍽️", desc: "반려동물 동반 출입이 가능한 식당" },
  { key: "베이커리", slug: "bakery", icon: "🥐", desc: "반려동물 동반 가능 빵집·디저트" },
  { key: "관광지", slug: "spot", icon: "🏞️", desc: "반려동물과 산책·구경할 수 있는 관광지" },
  { key: "숙박", slug: "stay", icon: "🏨", desc: "반려동물 동반 투숙 가능 숙소" },
  { key: "레포츠", slug: "leisure", icon: "🎾", desc: "반려동물과 즐기는 레포츠 시설" },
  { key: "문화시설", slug: "culture", icon: "🎨", desc: "반려동물 동반 가능 문화시설" },
];
const catOf = (key) => CATS.find((c) => c.key === key) || { key, slug: "etc", icon: "📍", desc: "" };

// 검색어에 맞춘 유형 표현 ("반려동물 동반 카페"보다 "애견동반 카페"로 검색함)
const PET_CAT_WORDS = {
  카페: "애견동반 카페", 식당: "애견동반 식당", 베이커리: "애견동반 베이커리",
  관광지: "반려견 동반 여행지", 숙박: "애견동반 숙소", 레포츠: "반려견 동반 레포츠", 문화시설: "반려견 동반 문화시설",
};
const petCatWord = (category) => PET_CAT_WORDS[category] || `반려견 동반 ${category}`;

// 받침 유무에 맞는 조사 (한글이 아니면 "은(는)"처럼 병기)
function josa(word, withFinal, withoutFinal) {
  const ch = String(word || "").replace(/[\s)\]」』"']+$/g, "").slice(-1);
  const code = ch.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${withFinal}(${withoutFinal})`;
  return (code - 0xac00) % 28 ? withFinal : withoutFinal;
}

const REGION_SLUGS = {
  서울: "seoul", 부산: "busan", 대구: "daegu", 인천: "incheon", 광주: "gwangju",
  대전: "daejeon", 울산: "ulsan", 세종: "sejong", 경기: "gyeonggi", 강원: "gangwon",
  충북: "chungbuk", 충남: "chungnam", 전북: "jeonbuk", 전남: "jeonnam",
  경북: "gyeongbuk", 경남: "gyeongnam", 제주: "jeju",
};

// ─── 도우미 ───
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function infoRow(icon, label, value) {
  if (!value) return "";
  return `<div class="info-item"><span class="info-label">${icon} ${label}</span><div class="info-value">${value}</div></div>`;
}
function distKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// 네이버 지도 후기 딥링크 (캠핑허브에서 검증된 방식 — 리뷰 탭 바로 열림)
const reviewButton = (p) =>
  `<button class="review-link" data-query="${esc(`${p.sigungu || p.sido} ${p.name}`.trim())}"
     onclick="event.preventDefault();window.open('https://map.naver.com/p/search/'+encodeURIComponent(this.dataset.query)+'?placePath=%2Freview','_blank','noopener');">📝 네이버 후기 보기</button>`;

// 공통 푸터 (출처 표기는 공공데이터 이용 의무)
function footerHtml(prefix = "") {
  return `
  <footer class="site-footer">
    <p>정보 출처: 식품의약품안전처 반려동물 동반출입 음식점 등록 현황 · 한국관광공사 반려동물 동반여행 (공공데이터) · 매일 자동 갱신</p>
    <p><a href="${prefix}about.html">사이트 소개</a> · <a href="${prefix}privacy.html">개인정보처리방침</a> · <a href="${prefix}index.html">전체 보기</a> · ${CATS.slice(0, 4).map((c) => `<a href="${prefix}cat-${c.slug}.html">${c.icon} ${c.key}</a>`).join(" · ")}</p>
    <p><a class="cross-link" href="https://campinghub.kr/theme-pet.html" target="_blank" rel="noopener">🏕️ 반려동물 동반 캠핑장 1,100곳 — 캠핑허브</a> · <a class="cross-link" href="https://festivalhub.kr" target="_blank" rel="noopener">🎪 전국 축제 — 페스티벌허브</a></p>
  </footer>`;
}

// 반려동물 캠핑장 (캠핑허브 공개 데이터) — 상세 페이지 "근처 캠핑장"용
const { execSync } = require("child_process");
let petCampings = [];
try {
  petCampings = JSON.parse(
    execSync("curl -s -m 30 https://campinghub.kr/campings-list.json", { maxBuffer: 20 * 1024 * 1024 }).toString("utf8")
  ).filter((c) => c.lat && c.lng && (c.pet || "").startsWith("가능"));
  console.log(`🏕️ 캠핑허브 반려동물 캠핑장 ${petCampings.length}곳 로드`);
} catch {
  console.log("⚠️ 캠핑허브 데이터를 가져오지 못해 근처 캠핑장 섹션 생략");
}

// 사진 없는 곳(식약처 등록부엔 사진이 없음)을 위한 카테고리 색상 타일 (app.js와 같은 모양)
function placeholder(category, cls = "no-image") {
  const cat = catOf(category);
  return `<div class="${cls} ph-${cat.slug}"><span class="ph-icon">${cat.icon}</span><span class="ph-label">${esc(cat.key)}</span></div>`;
}

// 사진 있는 곳을 전부 앞으로, 사진 없는 곳(색상 타일)은 뒤로 (각 그룹 안에서는 셔플 순서 유지) — app.js와 동일
function mixPhotos(list) {
  return [...list.filter((p) => p.image), ...list.filter((p) => !p.image)];
}

// ─── 목록 카드 (app.js와 같은 모양) ───
function listCard(p) {
  const cat = catOf(p.category);
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" />`
    : placeholder(p.category);
  const badges = [
    `<span class="badge upcoming">${cat.icon} ${esc(p.category)}</span>`,
    p.official ? `<span class="badge official">✅ 식약처 등록</span>` : "",
    p.petInfo && p.petInfo.petSize ? `<span class="badge long">🐕 ${esc(p.petInfo.petSize.slice(0, 12))}</span>` : "",
  ].join(" ");
  return `
    <a class="card-link" href="place/${p.id}.html">
      <article class="card">
        ${img}
        <div class="card-body">
          ${badges}
          <h2>${esc(p.name)}</h2>
          <p class="period">📍 ${esc(p.sido)} ${esc(p.sigungu)}</p>
          ${reviewButton(p)}
        </div>
      </article>
    </a>`;
}

// ─── 장소 한 곳 → 상세 페이지 ───
function buildPage(p, all) {
  const cat = catOf(p.category);
  // 제목·설명은 사람들이 실제로 검색하는 말에 맞춘다 (2026-09-21 네이버 검색어 분석:
  // 가게 이름만 검색하면 클릭률 0%, "OO 강아지출입"처럼 동반 의도가 붙은 검색은 50%).
  // "반려동물 동반"보다 "강아지 동반·애견동반"이 실제 검색어라 제목에 넣는다.
  const where = p.sigungu || p.sido;
  const title = `${p.name} 강아지 동반 가능 — ${where} ${petCatWord(p.category)}`;
  const size = p.petInfo && p.petInfo.petSize ? ` 동반 가능 범위: ${p.petInfo.petSize}.` : "";
  const lead = p.official
    ? `${p.name}${josa(p.name, "은", "는")} 식약처에 「반려동물 동반출입 음식점」으로 정식 등록된 ${p.sido} ${p.sigungu}의 ${petCatWord(p.category)}입니다. 강아지·반려견과 함께 입장할 수 있어요.`
    : `${p.name}${josa(p.name, "은", "는")} ${p.sido} ${p.sigungu}에 있는 ${petCatWord(p.category)}로, 강아지·반려견과 함께 갈 수 있습니다.${size}`;
  const description = `${lead} ${p.overview ? p.overview : "주소, 지도, 네이버 후기, 주변 동반 장소를 확인하세요."}`.replace(/\s+/g, " ").slice(0, 150);

  const hero = p.image
    ? `<img class="hero" src="${esc(p.image)}" alt="${esc(p.name)}" />${p.photoCredit ? `<p class="photo-credit">📷 사진 제보: ${esc(p.photoCredit)} 님 · <a class="report-link" href="${esc(reportMailto(p))}">나도 제보하기</a></p>` : ""}`
    : `<div class="ph-hero ph-${cat.slug}">
        <span class="ph-icon">${cat.icon}</span>
        <span class="ph-label">반려동물 동반 ${esc(cat.key)}</span>
        <a class="ph-report report-link" href="${esc(reportMailto(p))}">📷 이곳 사진 제보하기</a>
      </div>`;
  const badges = [
    `<span class="badge upcoming">${cat.icon} ${esc(p.category)}</span>`,
    p.official ? `<span class="badge official">✅ 식약처 등록</span>` : "",
  ].join(" ");
  // 식약처 등록 업소 강조 박스 (핵심 차별점 — 제목 바로 아래)
  const officialBanner = p.official
    ? `<div class="official-banner"><span class="ob-icon">✅</span><div><strong>식약처 공식 등록 반려동물 동반출입 음식점</strong><br />영업자가 지자체에 정식 등록하고 식품의약품안전처 현황에 올라 있는 업소예요. <a href="../about.html#official">등록 제도 안내 →</a></div></div>`
    : "";

  const homepage = p.homepage ? `<a href="${esc(p.homepage)}" target="_blank" rel="noopener">${esc(p.homepage)}</a>` : "";

  // 동반 조건 (관광공사 데이터에만 있음)
  const pi = p.petInfo || {};
  const petRows = [
    infoRow("🐕", "동반 가능 크기", esc(pi.petSize)),
    infoRow("🏠", "동반 유형", esc(pi.petType)),
    infoRow("🦮", "준비물", esc(pi.petNeed)),
    infoRow("🎾", "반려동물 시설", esc(pi.petFacility)),
    infoRow("ℹ️", "기타 안내", esc(pi.petEtc)),
    infoRow("⚠️", "주의사항", esc(pi.petRisk)),
  ].join("");
  const petSection = petRows
    ? `<section class="overview"><h2>🐾 반려동물 동반 조건</h2><div class="info-grid">${petRows}</div></section>`
    : p.official
      ? `<section class="overview"><h2>🐾 반려동물 동반 안내</h2><p>이 업소는 식품의약품안전처 <strong>「반려동물 동반출입 음식점」</strong>으로 정식 등록된 곳입니다. 등록 업소는 반려동물 동반 출입에 필요한 시설 기준과 준수사항을 갖추고 있어요. 다만 크기 제한·목줄 규정 등 세부 조건은 업소마다 달라 <strong>방문 전 전화 확인</strong>을 권장합니다.</p></section>`
      : "";

  const overview = p.overview ? `<section class="overview"><h2>소개</h2><p>${esc(p.overview)}</p></section>` : "";

  const hasCoords = p.lat && p.lng;
  const mapBlock = hasCoords ? `<section class="overview"><h2>오시는 길</h2><div id="map" class="map"></div></section>` : "";
  const directions = `
    <div class="dir-buttons">
      ${hasCoords ? `<a class="dir-btn kakao" target="_blank" rel="noopener" href="https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}">🚗 카카오맵 길찾기</a>` : ""}
      <a class="dir-btn naver" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${encodeURIComponent(p.address || p.name)}">🧭 네이버지도에서 보기</a>
      <a class="dir-btn hotel" target="_blank" rel="noopener" href="https://map.naver.com/p/search/${encodeURIComponent(`${p.sigungu || p.sido} ${p.name}`)}?placePath=%2Freview">📝 네이버 후기 보기</a>
    </div>`;

  // 같은 동네 다른 장소 (같은 시군구 우선, 가까운 순)
  const nearby = all
    .filter((o) => o.id !== p.id && o.sido === p.sido)
    .map((o) => ({ ...o, dist: hasCoords && o.lat && o.lng ? distKm(p.lat, p.lng, o.lat, o.lng) : o.sigungu === p.sigungu ? 5 : 999 }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);
  const nearbyCards = nearby.map((o) => {
    const oc = catOf(o.category);
    return `
      <a class="nearby-card nearby-link" href="${o.id}.html">
        ${o.image ? `<img src="${esc(o.image)}" alt="${esc(o.name)}" loading="lazy" />` : placeholder(o.category, "nearby-noimg")}
        <div class="nearby-name">${esc(o.name)}</div>
        <div class="nearby-dist">${oc.icon} ${esc(o.category)}${o.dist < 999 && hasCoords && o.lat ? ` · ${o.dist < 10 ? o.dist.toFixed(1) : Math.round(o.dist)}km` : ""}</div>
      </a>`;
  }).join("");
  const nearbySection = nearby.length
    ? `<section class="nearby-section"><h2>🐾 근처 다른 반려동물 동반 장소</h2><div class="nearby-row">${nearbyCards}</div></section>`
    : "";

  // 근처 반려동물 캠핑장 (캠핑허브 연결)
  const camps = hasCoords
    ? petCampings.map((c) => ({ ...c, dist: distKm(p.lat, p.lng, c.lat, c.lng) })).filter((c) => c.dist <= 30).sort((a, b) => a.dist - b.dist).slice(0, 4)
    : [];
  const campSection = camps.length
    ? `<section class="nearby-section"><h2>🏕️ 근처 반려동물 동반 캠핑장</h2><div class="nearby-row">${camps.map((c) => `
      <a class="nearby-card nearby-link cross-link" target="_blank" rel="noopener" href="https://campinghub.kr/camping/${c.contentId}.html" title="캠핑허브에서 보기">
        ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" />` : `<div class="nearby-noimg">🏕️</div>`}
        <div class="nearby-name">${esc(c.name)}</div>
        <div class="nearby-dist">📍 ${c.dist < 10 ? c.dist.toFixed(1) : Math.round(c.dist)}km · 캠핑허브 ↗</div>
      </a>`).join("")}</div></section>`
    : "";

  const coupang = COUPANG_ITEMS.length
    ? `<section class="nearby-section coupang-section"><h2>🎒 반려동물 외출 준비물</h2><div class="dir-buttons">${COUPANG_ITEMS.map((i) => `<a class="dir-btn coupang" target="_blank" rel="noopener sponsored" href="${esc(i.url)}">${esc(i.name)}</a>`).join("")}</div><p class="coupang-notice">이 섹션은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p></section>`
    : "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["카페", "식당", "베이커리"].includes(p.category) ? "Restaurant" : p.category === "숙박" ? "LodgingBusiness" : "TouristAttraction",
    name: p.name,
    description,
    url: `${SITE_URL}/place/${p.id}.html`,
    address: { "@type": "PostalAddress", streetAddress: p.address, addressCountry: "KR" },
    ...(hasCoords ? { geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng } } : {}),
    ...(p.image ? { image: p.image } : {}),
    ...(p.tel ? { telephone: p.tel } : {}),
    amenityFeature: [{ "@type": "LocationFeatureSpecification", name: "반려동물 동반 가능", value: true }],
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | ${SITE_NAME}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${SITE_URL}/place/${p.id}.html" />
  <meta property="og:type" content="place" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${p.image ? esc(p.image) : `${SITE_URL}/og-image.png`}" />
  <meta property="og:url" content="${SITE_URL}/place/${p.id}.html" />
  <link rel="stylesheet" href="../style.css?v=${BUILD_VER}" />
  ${hasCoords ? `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>` : ""}
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${HEAD_COMMON}
</head>
<body>
  <main class="detail-container">
    <a class="back-link" href="../index.html">← 전국 반려동물 동반 장소 목록으로</a>
    <div class="detail-body">
      <div class="badges">${badges}</div>
      <h1>${esc(p.name)}</h1>
      ${officialBanner}
      <div class="detail-actions">
        <button id="fav-btn" class="action-btn">🤍 찜하기</button>
        <button id="share-btn" class="action-btn">🔗 링크 복사</button>
      </div>
      ${hero}
      <div class="info-grid">
        ${infoRow("📍", "주소", esc(p.address))}
        ${infoRow("🏷️", "업종", esc(p.biz || p.category))}
        ${infoRow("📞", "문의", esc(p.tel))}
        ${infoRow("🔗", "홈페이지", homepage)}
      </div>
      ${VP.galleryHtml(p.visitorPhotos, { name: p.name, href: reportMailto(p) })}
      ${photoCallHtml(p)}
      ${petSection}
      ${overview}
      ${mapBlock}
      ${directions}
      ${nearbySection}
      ${campSection}
      ${coupang}
      ${p.official ? `<p class="coupang-notice">※ 식약처 등록 현황은 영업자가 자율 신청한 업소 기준이며, 등록 이후 운영 상태가 바뀔 수 있습니다. 방문 전 확인을 권장합니다.</p>` : ""}
    </div>
  </main>
  ${footerHtml("../")}
  <script>
    window.PET = ${JSON.stringify({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })};
  </script>
  <script src="../pet-page.js"></script>
  <script src="../track-clicks.js"></script>
  <script src="../report.js?v=${BUILD_VER}"></script>
</body>
</html>`;
}

// ─── 목록 페이지 (카테고리/지역) ───
// region/cat = 이 페이지가 어떤 지역·유형으로 좁혀져 있는지 (칩 링크가 그 안에서 더 좁혀지도록)
function buildListPage({ filename, title, heading, subtitle, description, items, region = "", cat = "" }) {
  const cards = items.map(listCard).join("");
  const rslug = REGION_SLUGS[region];
  // 유형 칩: 지역 페이지 안에서는 "그 지역의 유형" 페이지로
  const catChips = [
    `<a class="chip${!cat ? " chip-active" : ""}" href="${rslug ? `region-${rslug}.html` : "index.html"}">전체 유형</a>`,
    ...CATS.map((c) => `<a class="chip${cat === c.key ? " chip-active" : ""}" href="${rslug ? `region-${rslug}-${c.slug}.html` : `cat-${c.slug}.html`}">${c.icon} ${c.key}</a>`),
  ].join("");
  // 지역 칩: 유형 페이지 안에서는 "그 유형의 지역" 페이지로
  const catSlug = cat ? catOf(cat).slug : "";
  const regionChips = [
    `<a class="chip${!region ? " chip-active" : ""}" href="${catSlug ? `cat-${catSlug}.html` : "index.html"}">전체 지역</a>`,
    ...Object.entries(REGION_SLUGS).map(([r, s]) => `<a class="chip${region === r ? " chip-active" : ""}" href="${catSlug ? `region-${s}-${catSlug}.html` : `region-${s}.html`}">${r}</a>`),
  ].join("");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${SITE_URL}/${filename}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${SITE_URL}/og-image.png" />
  <link rel="stylesheet" href="style.css?v=${BUILD_VER}" />${HEAD_COMMON}
</head>
<body>
  <header class="site-header">
    <h1>${heading}</h1>
    <p class="subtitle">${esc(subtitle)}</p>
    <p class="home-link"><a href="index.html">← 전체 보기</a></p>
  </header>
  <nav class="quick-links">${catChips}</nav>
  <nav class="quick-links quick-links-regions">${regionChips}</nav>
  ${photoCallHtml(null)}
  <p class="result-count">${items.length}곳</p>
  <main class="festival-grid">${cards || `<p style="grid-column:1/-1;text-align:center;color:#888;">해당하는 장소가 없습니다.</p>`}</main>
  <a class="to-top" href="#" aria-label="맨 위로">↑</a>
  ${footerHtml("")}
  <script src="track-clicks.js"></script>
  <script src="report.js?v=${BUILD_VER}"></script>
</body>
</html>`;
}

// ═══ 실행부 ═══
const outDir = path.join(__dirname, "place");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
for (const old of fs.readdirSync(outDir)) if (old.endsWith(".html")) fs.unlinkSync(path.join(outDir, old));
for (const p of pets) fs.writeFileSync(path.join(outDir, `${p.id}.html`), buildPage(p, pets), "utf-8");
console.log(`✅ place/*.html ${pets.length}개 생성`);

for (const old of fs.readdirSync(__dirname)) {
  if (/^(cat-[a-z]+|region-[a-z-]+)\.html$/.test(old)) fs.unlinkSync(path.join(__dirname, old));
}

// 매일 셔플 (같은 날엔 같은 순서) — 캠핑허브와 같은 방식
const d = kstNow();
const daySeed = `${d.getUTCFullYear()}${d.getUTCMonth() + 1}${d.getUTCDate()}`;
const rank = (id) => { let h = 5381; const s = daySeed + id; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
const shuffled = (list) => mixPhotos([...list].sort((a, b) => rank(a.id) - rank(b.id)));

const catFiles = [];
for (const c of CATS) {
  const items = shuffled(pets.filter((p) => p.category === c.key));
  if (!items.length) continue;
  const filename = `cat-${c.slug}.html`;
  fs.writeFileSync(filename, buildListPage({
    filename,
    title: `전국 ${petCatWord(c.key)} ${items.length}곳 총정리 — 강아지 동반 가능한 곳 | ${SITE_NAME}`,
    heading: `${c.icon} 반려동물 동반 ${c.key}`,
    subtitle: `${c.desc} ${items.length}곳`,
    description: `강아지·반려견과 함께 갈 수 있는 전국 ${petCatWord(c.key)} ${items.length}곳. 식약처 등록 업소와 관광공사 동반여행지를 지역별로, 위치·동반 조건·네이버 후기까지 한눈에.`,
    items,
    cat: c.key,
  }), "utf-8");
  catFiles.push(filename);
}
console.log(`✅ 카테고리 페이지 ${catFiles.length}개`);

const regionFiles = [];
for (const [region, slug] of Object.entries(REGION_SLUGS)) {
  const items = shuffled(pets.filter((p) => p.sido === region));
  if (!items.length) continue;
  const filename = `region-${slug}.html`;
  fs.writeFileSync(filename, buildListPage({
    filename,
    title: `${region} 애견동반 카페·식당·여행지 ${items.length}곳 — 강아지 동반 가능한 곳 | ${SITE_NAME}`,
    heading: `📍 ${region} 반려동물 동반 장소`,
    subtitle: `${region}에서 반려동물과 함께 갈 수 있는 곳 ${items.length}곳`,
    description: `${region}에서 강아지·반려견과 함께 갈 수 있는 애견동반 카페, 식당, 여행지, 숙소 ${items.length}곳. 식약처 등록 업소와 관광공사 동반여행지 정보.`,
    items,
    region,
  }), "utf-8");
  regionFiles.push(filename);

  // 지역 × 유형 페이지 (예: region-jeju-cafe.html = 제주 카페) — 지역 안에서 유형 칩을 눌렀을 때
  for (const c of CATS) {
    const sub = shuffled(pets.filter((p) => p.sido === region && p.category === c.key));
    if (!sub.length) continue;
    const subFile = `region-${slug}-${c.slug}.html`;
    fs.writeFileSync(subFile, buildListPage({
      filename: subFile,
      title: `${region} ${petCatWord(c.key)} ${sub.length}곳 — 강아지 동반 가능한 곳 | ${SITE_NAME}`,
      heading: `${c.icon} ${region} 반려동물 동반 ${c.key}`,
      subtitle: `${region}에서 반려동물과 함께 갈 수 있는 ${c.key} ${sub.length}곳`,
      description: `${region}에서 강아지·반려견과 함께 갈 수 있는 ${petCatWord(c.key)} ${sub.length}곳. 위치, 연락처, 동반 조건과 네이버 후기까지 한눈에.`,
      items: sub,
      region,
      cat: c.key,
    }), "utf-8");
    regionFiles.push(subFile);
  }
}
console.log(`✅ 지역 페이지 ${regionFiles.length}개 (지역×유형 포함)`);

// sitemap + robots
const today = new Date().toISOString().slice(0, 10);
const urls = [
  `${SITE_URL}/`, `${SITE_URL}/about.html`, `${SITE_URL}/privacy.html`,
  ...catFiles.map((f) => `${SITE_URL}/${f}`),
  ...regionFiles.map((f) => `${SITE_URL}/${f}`),
  ...pets.map((p) => `${SITE_URL}/place/${p.id}.html`),
];
fs.writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`, "utf-8");
fs.writeFileSync("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, "utf-8");
console.log(`✅ sitemap.xml (${urls.length}개 주소) + robots.txt`);

// RSS — 네이버 서치어드바이저 "RSS 제출"용. 최근 추가된 장소 50곳 (같은 날이면 오늘의 셔플 순)
const rssItems = [...pets]
  .sort((a, b) => (b.addedAt || "20260915").localeCompare(a.addedAt || "20260915") || rank(a.id) - rank(b.id))
  .slice(0, 50);
const rfc822 = (yyyymmdd) => {
  const s = yyyymmdd || "20260915";
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), -3)).toUTCString(); // 06:00 KST
};
const rssBody = rssItems.map((p) => {
  const cat = catOf(p.category);
  const desc = `${p.sido} ${p.sigungu}에 있는 반려동물 동반 ${p.category}${p.official ? " (식약처 반려동물 동반출입 음식점 등록 업소)" : ""}. ${p.address}`;
  return `    <item>
      <title>${esc(`${p.name} — ${p.sido} ${p.sigungu} ${petCatWord(p.category)}`)}</title>
      <link>${SITE_URL}/place/${p.id}.html</link>
      <guid isPermaLink="true">${SITE_URL}/place/${p.id}.html</guid>
      <pubDate>${rfc822(p.addedAt)}</pubDate>
      <category>${esc(cat.key)}</category>
      <description>${esc(desc)}</description>${p.image ? `\n      <enclosure url="${esc(p.image)}" type="image/jpeg" length="0" />` : ""}
    </item>`;
}).join("\n");
fs.writeFileSync("rss.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>PetTripHub — 반려동물 동반 카페·식당·여행지</title>
    <link>${SITE_URL}/</link>
    <description>강아지·고양이와 함께 갈 수 있는 전국 카페, 식당, 관광지, 숙소. 식약처 등록 업소 + 한국관광공사 동반여행지, 매일 자동 갱신</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssBody}
  </channel>
</rss>
`, "utf-8");
console.log(`✅ rss.xml (${rssItems.length}건)`);

// 홈 목록용 경량 데이터 (app.js가 읽음)
const slim = pets.map((p) => ({
  id: p.id, name: p.name, category: p.category, sido: p.sido, sigungu: p.sigungu,
  image: p.image || "", official: !!p.official, lat: p.lat, lng: p.lng,
  petSize: p.petInfo && p.petInfo.petSize ? p.petInfo.petSize.slice(0, 12) : "",
}));
fs.writeFileSync("pets-list.json", JSON.stringify(slim), "utf-8");
console.log(`✅ pets-list.json (${Math.round(JSON.stringify(slim).length / 1024)}KB)`);
