// visitor-photos.js — 방문자 사진 제보 공통 모듈 (FestivalHub · CampingHub · PetTripHub 세 사이트가 같은 파일을 복사해 씀)
//
// 사용 흐름:
//   1) 방문자가 "사진 제보" 버튼 → report.js 안내창 → 이메일로 사진을 보냄
//   2) 받은 사진을 photos/ 폴더에 저장 (가로 1200px 이하), photos.json에 추가:
//        { "<페이지ID>": [ { "image": "photos/<ID>-1.jpg", "credit": "닉네임", "caption": "한 줄 설명(선택)", "date": "20261006" } ] }
//      영상은 { "video": "photos/<ID>-fireworks.mp4", "poster": "photos/<ID>-fireworks.jpg", ... } (720p·H.264·10MB 이하 권장)
//      date = 사이트에 올린 날(YYYYMMDD). 이 날짜 기준 PIN_DAYS 동안 랜딩 맨 위에 "📸 방문자 사진" 고정 (끝난 축제도 보이게)
//      (예전 형식 { "<ID>": { image, credit } } 도 읽음)
//   3) node build-pages.js → 상세 페이지 "📸 방문자 사진" 갤러리에 표시. 공식 사진이 없는 곳은 첫 제보 사진이 대표 사진.

const fs = require("fs");

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 제보 사진을 랜딩 맨 위에 고정하는 기간(일). 사용자가 2026-10-06 "3~5일" 제안 → 5일 → 2026-10-06 일주일로 변경
const PIN_DAYS = 7;

// photos.json → { id: [ { image(절대주소), video, poster, credit, caption, date } ] }
function loadVisitorPhotos(siteUrl, file = "photos.json") {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  const abs = (u) => (!u ? "" : /^https?:/.test(u) ? u : `${siteUrl}/${u}`);
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    const list = (Array.isArray(v) ? v : [v])
      .filter((x) => x && (x.image || x.video))
      .map((x) => ({
        image: abs(x.image || x.poster),   // 영상만 있으면 포스터를 대표 이미지로
        video: abs(x.video),
        poster: abs(x.poster),
        credit: x.credit || "",
        caption: x.caption || "",
        date: x.date || "",
        review: x.review || "",  // 제보자 후기 (한 제보자에 한 번만 쓰면 됨)
      }));
    if (list.length) out[id] = list;
  }
  return out;
}

// 첫 "사진" 항목 (대표 사진용 — 영상보다 사진을 우선)
function firstImage(list) {
  if (!list || !list.length) return "";
  const ph = list.find((x) => x.image && !x.video) || list.find((x) => x.image);
  return ph ? ph.image : "";
}

// 최근 PIN_DAYS 안에 제보가 등록된 ID → { id: { date, until, image, hasVideo } }
function pinnedMap(visitorPhotos, todayYmd, days = PIN_DAYS) {
  const toDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  const today = toDate(todayYmd);
  const out = {};
  for (const [id, list] of Object.entries(visitorPhotos)) {
    const dated = list.filter((x) => /^\d{8}$/.test(x.date));
    if (!dated.length) continue;
    const latest = dated.map((x) => x.date).sort().pop();
    const age = (today - toDate(latest)) / 86400000;
    if (age < 0 || age >= days) continue;
    const until = new Date(toDate(latest).getTime() + days * 86400000);
    const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    out[id] = { date: latest, until: ymd(until), image: firstImage(list), hasVideo: list.some((x) => x.video), count: list.length };
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
    `※ 직접 촬영한 사진 1~5장(짧은 영상도 환영)을 첨부해 주세요. 보내주신 사진은 ${siteName}에 닉네임과 함께 게시되는 데 동의한 것으로 봅니다.`,
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

// 상세 페이지 "방문자 사진" 갤러리 (사진이 없으면 빈 문자열).
// 제보자(credit)별로 묶어서 "OO 님의 제보 사진" + 사진 아래 "💬 OO 님의 후기"(review 필드). 영상은 <video>로.
// 사진 클릭은 report.js의 라이트박스가 가로채 페이지 안에서 크게 보여준다 (새 탭 X).
function galleryHtml(photos, { name, href }) {
  if (!photos || !photos.length) return "";
  const groups = [];
  for (const ph of photos) {
    const key = ph.credit || "방문자";
    let g = groups.find((x) => x.credit === key);
    if (!g) { g = { credit: key, items: [], review: "" }; groups.push(g); }
    g.items.push(ph);
    if (ph.review && !g.review) g.review = ph.review;
  }
  const total = photos.length;
  const hasVideo = photos.some((x) => x.video);
  const groupHtml = groups.map((g) => {
    const items = g.items.map((ph, i) => ph.video
      ? `
          <figure class="visitor-photo is-video">
            <video controls preload="metadata" playsinline${ph.poster ? ` poster="${esc(ph.poster)}"` : ""} aria-label="${esc(name)} ${esc(g.credit)} 님 영상">
              <source src="${esc(ph.video)}" type="video/mp4" />
            </video>
            ${ph.caption ? `<figcaption>🎬 ${esc(ph.caption)}</figcaption>` : ""}
          </figure>`
      : `
          <figure class="visitor-photo">
            <a class="visitor-open" href="${esc(ph.image)}" data-caption="${esc(ph.caption)}" data-credit="${esc(g.credit)}"><img src="${esc(ph.image)}" alt="${esc(name)} — ${esc(g.credit)} 님 제보 사진${ph.caption ? ` (${esc(ph.caption)})` : ""}" loading="lazy" /></a>
            ${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ""}
          </figure>`).join("");
    const vids = g.items.filter((x) => x.video).length, pics = g.items.length - vids;
    const label = [pics ? `사진 ${pics}장` : "", vids ? `영상 ${vids}개` : ""].filter(Boolean).join(" · ");
    return `
        <div class="visitor-group">
          <h3 class="visitor-group-title">📷 ${esc(g.credit)} 님의 제보 사진 <span class="visitor-meta">${label}</span></h3>
          <div class="visitor-grid">${items}</div>
          ${g.review ? `<blockquote class="visitor-review"><strong>💬 ${esc(g.credit)} 님의 후기</strong><p>${esc(g.review)}</p></blockquote>` : ""}
        </div>`;
  }).join("");
  return `
      <section class="overview visitor-gallery">
        <h2>📸 방문자 사진${hasVideo ? "·영상" : ""} <span class="visitor-count">${total}</span></h2>
        ${groupHtml}
        <p class="photo-credit">방문자분들이 직접 찍어 보내주신 ${hasVideo ? "사진과 영상" : "사진"}이에요. <a class="report-link" href="${esc(href)}">나도 사진 자랑하기 →</a></p>
      </section>`;
}

module.exports = { loadVisitorPhotos, firstImage, pinnedMap, PIN_DAYS, reportMailto, photoCallHtml, galleryHtml };
