# 제보 사진 폴더

방문자가 이메일로 보낸 사진을 여기에 넣는다.

1. 파일 이름은 장소 ID로: `photos/mhdg8jv.jpg` (ID는 장소 페이지 주소 `place/<ID>.html`)
2. 가로 1200px 이하로 줄여서 저장 (용량 300KB 안팎)
3. `photos.json`에 한 줄 추가:
   ```json
   { "mhdg8jv": { "image": "photos/mhdg8jv.jpg", "credit": "멍멍맘" } }
   ```
4. `node build-pages.js` → 커밋 → 푸시하면 카드·상세·RSS에 반영됨
