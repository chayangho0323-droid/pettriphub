// serve.js — 로컬 미리보기용 초소형 정적 파일 서버
// 실행: node serve.js  → 브라우저에서 http://localhost:8090 접속
// (index.html을 더블클릭으로 열면 브라우저 보안 정책 때문에 campings.json을 못 읽어서 필요)

const http = require("http");
const fs = require("fs");
const path = require("path");

// 환경변수 PORT가 있으면 그걸 쓰고, 없으면 8090
// (8080은 이 컴퓨터에서 다른 프로그램이 쓰고 있어서 CampingHub는 8090 사용)
const PORT = process.env.PORT || 8090;

// 파일 확장자별로 브라우저에게 알려줄 타입
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    // "/" 로 접속하면 index.html을 보여준다
    let urlPath = req.url.split("?")[0];
    if (urlPath === "/") urlPath = "/index.html";

    const filePath = path.join(__dirname, urlPath);

    // 프로젝트 폴더 밖의 파일은 요청 못 하게 차단 (보안)
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not Found: " + urlPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
    console.log("   종료하려면 Ctrl+C");
  });
