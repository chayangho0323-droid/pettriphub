// fetch-reviews.js — 네이버 블로그 검색(NAVER API HUB)으로 장소마다 "다녀온 사람 글" 3개를 모아 reviews.json에 캐시
//
// 왜: "네이버 후기 보기" 버튼은 눌러야 네이버로 넘어가서 다시 골라 봐야 한다. 페이지 안에서 바로 제목·한 줄 요약이
//     보이면 머무는 이유가 생긴다 (식약처 업소 페이지 체류 11초 대책). 본문은 가져오지 않고 제목·요약·링크만(검색 결과 수준).
//
// API: NAVER API HUB 검색-블로그 (2026-07-31부터 개발자센터 → 네이버클라우드 API HUB로 이관, 하루 25,000회 무료)
//   GET https://naverapihub.apigw.ntruss.com/search/v1/blog?query=…&display=10&sort=sim
//   헤더 X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY  (.env NAVER_CLIENT_ID / NAVER_CLIENT_SECRET, GitHub Secrets 같은 이름)
//
// 방식: "시군구 장소명"으로 정확도순 10개를 받아 제목·요약에 장소명이 실제로 들어간 글만 남기고 최신순 3개.
//   광고성(협찬·원고료·체험단) 문구가 보이는 글은 뺀다. 결과가 0개여도 기록해 14일 동안 다시 묻지 않는다.
//   한 번 실행에 REVIEW_BUDGET(기본 400)곳만 — 캐시 없는 곳 → 오래된 곳 순. 3,800곳 기준 처음엔 열흘, 이후엔 하루 270곳꼴.
// 실행 순서: fetch-pet.js → fetch-reviews.js → build-pages.js   (실패해도 build는 전날 reviews.json으로 계속)

require("dotenv").config({ quiet: true });
const fs = require("fs");

const ID = process.env.NAVER_CLIENT_ID;
const SECRET = process.env.NAVER_CLIENT_SECRET;
const OUT = "reviews.json";
const BUDGET = Number(process.env.REVIEW_BUDGET || 400);
const TTL_DAYS = 14; // 이 날짜가 지나면 다시 검색
const PER_PLACE = 3;
const kst = () => new Date(Date.now() + 9 * 3600 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const TODAY = ymd(kst());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!ID || !SECRET) { console.log("⚠️ NAVER_CLIENT_ID/SECRET 없음 — 블로그 후기 수집 건너뜀"); process.exit(0); }

const pets = JSON.parse(fs.readFileSync("pets.json", "utf-8"));
let cache = { updated: "", places: {} };
try { cache = JSON.parse(fs.readFileSync(OUT, "utf-8")); } catch {}
if (!cache.places) cache.places = {};

// ── 장소명 정리: 법인 표기·괄호 설명을 떼고 검색어와 매칭 기준을 만든다 ──
const stripName = (n) => String(n || "")
  .replace(/\((주|유|합|사|재)\)|주식회사|유한회사|㈜/g, " ")
  .replace(/\[[^\]]*\]/g, " ")
  .replace(/\([^)]*\)/g, " ")
  .replace(/\s+/g, " ").trim();
const norm = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/[\s·:,\-'"“”‘’!?.~()\[\]]/g, "").toLowerCase();
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const AD_RE = /협찬|원고료|체험단|소정의|제공받|광고입니다|업체로부터/;
const LIST_RE = /리스트|현황|목록|명단/; // "애견동반 식당 현황 리스트" 같은 긁어모은 목록 글 — 모든 장소에 걸려서 뺀다
const CONTEXT_RE = /카페|맛집|식당|베이커리|빵집|브런치|디저트|커피|술집|맥주|애견|반려|강아지|댕댕|멍멍|펫|숙소|펜션|호텔|캠핑|공원|관광|여행|나들이|산책|체험|전시|박물관|미술관|해변|해수욕장|계곡|수목원|휴양림/;

// 글이 이 장소 얘기인지 (2026-10-15 40곳 시험 뒤 조임):
//  1) 정리한 이름(공백 제거)이 제목+요약에 통째로 들어가거나, 2글자 이상 토큰이 모두 들어가야 함
//  2) 이름이 짧고 흔한 단어(4글자 이하 한 토큰: 공책·고램지)는 제목에 꼭 있어야 함 (요약에만 있으면 "공책에 적고…" 같은 딴 글)
//  3) 같은 글에 시군구·동네(주소의 ○○동) 이름이나 장소 성격 단어(카페·맛집·애견…)가 함께 있어야 함 (법률사무소·영어 강의 글 제외)
function matches(name, item, ctx) {
  const title = norm(item.title);
  const text = title + norm(item.description);
  const core = norm(name);
  const tokens = name.split(" ").map(norm).filter((t) => t.length >= 3); // "on"·"the" 같은 짧은 조각은 매칭 근거로 안 씀
  const inText = (core.length >= 2 && text.includes(core)) || (tokens.length >= 2 && tokens.every((t) => text.includes(t)));
  if (!inText) return false;
  if (core.length <= 4 && tokens.length <= 1 && !title.includes(core)) return false;
  if (LIST_RE.test(stripTags(item.title))) return false;
  return ctx.some((c) => c && text.includes(c)) || CONTEXT_RE.test(stripTags(item.title + " " + item.description));
}
// 주소에서 동네 이름 뽑기: "서울특별시 동작구 사당로 304(1층 사당동)" → ["사당동", "사당로"]
const localityOf = (addr) => (String(addr || "").match(/[가-힣]{1,6}(동|읍|면|리|로|길)(?=\b|[^가-힣])/g) || []).map(norm).filter((t) => t.length >= 3);

async function searchBlog(query) {
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/blog?query=${encodeURIComponent(query)}&display=10&sort=sim`;
  const res = await fetch(url, { headers: { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }, signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("인증 실패 " + res.status), { fatal: true });
  if (res.status === 429) throw Object.assign(new Error("하루 호출 한도 초과(429)"), { fatal: true });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return data.items || [];
}

function pick(name, items, p) {
  const ctx = [norm(p.sigungu), ...localityOf(p.address)];
  return items
    .filter((it) => matches(name, it, ctx) && !AD_RE.test(it.description || ""))
    .map((it) => ({ t: stripTags(it.title).slice(0, 80), l: it.link, d: stripTags(it.description).slice(0, 110), b: stripTags(it.bloggername).slice(0, 30), dt: it.postdate || "" }))
    .filter((it, i, arr) => arr.findIndex((x) => x.l === it.l) === i) // 같은 글 중복 제거
    .sort((a, b) => (b.dt || "").localeCompare(a.dt || ""))
    .slice(0, PER_PLACE);
}

(async () => {
  const stale = (e) => !e || !e.at || (Date.parse(`${e.at.slice(0, 4)}-${e.at.slice(4, 6)}-${e.at.slice(6, 8)}`) < Date.now() - TTL_DAYS * 86400000);
  // 캐시 없는 곳 먼저, 그다음 오래된 순. 이름이 너무 짧은 곳(1글자)은 검색 의미가 없어 뺀다
  const todo = pets
    .map((p) => ({ p, name: stripName(p.name), e: cache.places[p.id] }))
    .filter((x) => norm(x.name).length >= 2 && stale(x.e))
    .filter((x) => !process.env.REVIEW_FILTER || (process.env.REVIEW_FILTER === "tour" ? !x.p.official : x.p.official)) // 시험용: official|tour
    .sort((a, b) => (a.e ? 1 : 0) - (b.e ? 1 : 0) || String(a.e?.at || "").localeCompare(String(b.e?.at || "")))
    .slice(0, BUDGET);
  console.log(`📝 블로그 후기 수집: 대상 ${todo.length}곳 (전체 ${pets.length}, 캐시 ${Object.keys(cache.places).length}, 예산 ${BUDGET})`);

  let done = 0, hit = 0, calls = 0;
  for (const { p, name } of todo) {
    const query = `${p.sigungu || p.sido || ""} ${name}`.trim();
    try {
      calls++;
      const items = pick(name, await searchBlog(query), p);
      cache.places[p.id] = { at: TODAY, q: query, items };
      done++; if (items.length) hit++;
      if (done % 50 === 0) { console.log(`  … ${done}/${todo.length} (후기 있는 곳 ${hit})`); fs.writeFileSync(OUT, JSON.stringify(cache), "utf-8"); }
      await sleep(120);
    } catch (e) {
      if (e.fatal) { console.log("⛔ 중단:", e.message); break; }
      console.log(`  ! ${p.name}: ${e.message}`);
      await sleep(1000);
    }
  }
  cache.updated = TODAY;
  fs.writeFileSync(OUT, JSON.stringify(cache), "utf-8");
  const withItems = Object.values(cache.places).filter((e) => e.items && e.items.length).length;
  console.log(`✅ ${OUT}: 이번 ${done}곳 처리(후기 있음 ${hit}, 호출 ${calls}) · 누적 ${Object.keys(cache.places).length}곳 중 후기 있는 곳 ${withItems}`);
})();
