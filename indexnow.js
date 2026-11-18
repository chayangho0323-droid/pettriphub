// indexnow.js — 새로 생기거나 바뀐 페이지 주소를 IndexNow(api.indexnow.org)에 알린다. (2026-11-18)
//
// 왜: 빙·네이버는 IndexNow를 받는다(구글은 안 받음). 사이트맵만 두면 검색엔진이 다시 읽으러 올 때까지 기다려야 하지만,
//     IndexNow로 보내면 "이 주소가 새로 생겼다/바뀌었다"를 바로 알 수 있다. 네이버가 방문자의 95%라 효과가 크다.
//
// 보내는 주소 (하루 최대 MAX개):
//   1) 이번 빌드에서 새로 생긴 HTML 파일 (git에 아직 없는 파일 = 새 페이지)
//   2) sitemap-core.xml의 핵심 페이지 (메인·허브·가이드·이야기 있는 상세)
//   ※ 날씨처럼 매일 바뀌는 칸 때문에 모든 페이지가 매일 "바뀐 파일"로 잡히므로, 전체 변경분은 보내지 않는다(스팸 취급 위험).
//
// 열쇠: 저장소 루트의 <32자리 16진수>.txt 파일이 열쇠이자 소유 증명(https://사이트/열쇠.txt 로 공개되어야 함).
// 실행: node indexnow.js            (워크플로에서 build-pages.js 다음, git add 전에)
//       node indexnow.js --dry      (보내지 않고 목록만 출력)
//       node indexnow.js --urls a.html b.html  (지정한 경로만 보냄)

const fs = require("fs");
const { execSync } = require("child_process");

const SITE_URL = "https://pettriphub.kr";
const MAX = 500;
const DRY = process.argv.includes("--dry");

const keyFile = fs.readdirSync(".").find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) { console.error("❌ IndexNow 열쇠 파일(<32자리 hex>.txt)이 없습니다"); process.exit(0); }
const KEY = fs.readFileSync(keyFile, "utf-8").trim();

function listUrls() {
  const manual = process.argv.indexOf("--urls");
  if (manual >= 0) return process.argv.slice(manual + 1).map((p) => `${SITE_URL}/${p.replace(/^\.?\//, "")}`);

  const urls = [];
  // 1) 새로 생긴 HTML (아직 git에 없는 파일)
  try {
    const out = execSync("git ls-files --others --exclude-standard", { encoding: "utf-8" });
    for (const f of out.split("\n")) if (/\.html$/.test(f)) urls.push(`${SITE_URL}/${f.replace(/^\.?\//, "")}`);
  } catch {}
  // 2) 핵심 사이트맵
  try {
    const core = fs.readFileSync("sitemap-core.xml", "utf-8");
    for (const m of core.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  } catch {}
  return [...new Set(urls)];
}

async function main() {
  const all = listUrls();
  const urlList = all.slice(0, MAX);
  console.log(`📣 IndexNow 대상 ${all.length}개 (보냄 ${urlList.length}개) — 열쇠 ${keyFile}`);
  if (!urlList.length) return;
  if (DRY) { console.log(urlList.slice(0, 20).join("\n") + (urlList.length > 20 ? `\n… 외 ${urlList.length - 20}개` : "")); return; }
  const host = SITE_URL.replace(/^https?:\/\//, "");
  const body = { host, key: KEY, keyLocation: `${SITE_URL}/${keyFile}`, urlList };
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  // 200 OK / 202 Accepted(열쇠 확인 대기) 가 정상. 403은 열쇠 파일이 아직 안 올라간 경우(배포 전) → 다음 날 다시 시도되므로 실패로 두지 않음
  console.log(`${res.status >= 200 && res.status < 300 ? "✅" : "⚠️"} IndexNow 응답 ${res.status} ${text.slice(0, 120)}`);
}
main().catch((e) => { console.error("⚠️ IndexNow 실패(무시):", e.message); });
