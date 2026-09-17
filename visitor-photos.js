// visitor-photos.js — 방문자 사진 제보 공통 모듈 (FestivalHub · CampingHub · PetTripHub 세 사이트가 같은 파일을 복사해 씀)
//
// 사용 흐름:
//   1) 방문자가 "사진 제보" 버튼 → report.js 안내창 → 이메일로 사진을 보냄
//   2) 받은 사진을 photos/ 폴더에 저장 (가로 1200px 이하), photos.json에 추가:
//        { "<페이지ID>": [ { "image": "photos/<ID>-1.jpg", "credit": "닉네임", "caption": "한 줄 설명(선택)" } ] }
//      (예전 형식 { "<ID>": { image, credit } } 도 읽음)
//   3) node build-pages.js → 상세 페이지 "📸 방문자 사진" 갤러리에 표시. 공식 사진이 없는 곳은 첫 제보 사진이 대표 사진.

const fs = require("fs");

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// photos.json → { id: [ { image(절대주소), credit, caption } ] }
function loadVisitorPhotos(siteUrl, file = "photos.json") {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    const list = (Array.isArray(v) ? v : [v])
      .filter((x) => x && x.image)
      .map((x) => ({
        image: /^https?:/.test(x.image) ? x.image : `${siteUrl}/${x.image}`,
        credit: x.credit || "",
        caption: x.caption || "",
      }));
    if (list.length) out[id] = list;
  }
  return out;
}

// 제목·본문이 채워진 mailto 링크 (report.js가 클릭을 가로채 안내창을 띄움. GA: .report-link = click_report)
function reportMailto({ email, siteName, name = "", where = "", pageUrl = "" }) {
  const subject = name ? `[사진 제보] ${name}` : `[사진 제보] ${siteName}`;
  const body = [
    name ? `장소: ${name}${where ? ` (${where})` : ""}` : "장소(행사) 이름: \n지역: ",
    pageUrl ? `페이지: ${pageUrl}` : "",
    "방문일: ",
    "표기할 닉네임: ",
    "사진 한 줄 설명(선택): ",
    "",
    `※ 직접 촬영한 사진 1~5장을 첨부해 주세요. 보내주신 사진은 ${siteName}에 닉네임과 함께 게시되는 데 동의한 것으로 봅니다.`,
    "※ 사진 속 인물 모두가 게시에 동의한 사진만 보내주세요. 요청하시면 바로 내려드립니다.",
  ].filter((l) => l !== "").join("\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// 주황색 안내 띠
function photoCallHtml({ title, text, href, button = "사진 보내기 →" }) {
  return `
      <div class="photo-call">
        <span class="photo-call-icon">📷</span>
        <div class="photo-call-text">
          <span class="photo-call-title">${esc(title)}</span>
          ${text}
        </div>
        <a class="photo-call-btn report-link" href="${esc(href)}">${esc(button)}</a>
      </div>`;
}

// 상세 페이지 "방문자 사진" 갤러리 (사진이 없으면 빈 문자열)
function galleryHtml(photos, { name, href }) {
  if (!photos || !photos.length) return "";
  const items = photos.map((ph) => `
        <figure class="visitor-photo">
          <a href="${esc(ph.image)}" target="_blank" rel="noopener"><img src="${esc(ph.image)}" alt="${esc(name)} 방문자 사진${ph.credit ? ` — ${esc(ph.credit)} 님` : ""}" loading="lazy" /></a>
          <figcaption>${ph.credit ? `📷 ${esc(ph.credit)} 님` : "📷 방문자 제보"}${ph.caption ? ` · ${esc(ph.caption)}` : ""}</figcaption>
        </figure>`).join("");
  return `
      <section class="overview visitor-gallery">
        <h2>📸 방문자 사진 <span class="visitor-count">${photos.length}</span></h2>
        <div class="visitor-grid">${items}</div>
        <p class="photo-credit">방문자분들이 직접 찍어 보내주신 사진이에요. <a class="report-link" href="${esc(href)}">나도 사진 자랑하기 →</a></p>
      </section>`;
}

module.exports = { loadVisitorPhotos, reportMailto, photoCallHtml, galleryHtml };
