# M13 보안 헤더 검토

## 적용 정책

`next.config.ts`의 `/:path*`에 `securityHeaders`가 만든 헤더를 적용한다. HTML, 정적 파일, API, 오류 응답에 적용하며, 뒤에 선언한 `/api/attachments/:path*` 규칙은 첨부파일 경로의 Referrer-Policy만 더 엄격하게 유지한다.

| 헤더 | 값·범위 |
|---|---|
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | 기본 `strict-origin-when-cross-origin`, `/api/attachments/:path*`는 `no-referrer` |
| X-Frame-Options | `DENY` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()` |
| Content-Security-Policy-Report-Only | 아래 정책. 아직 강제 차단으로 전환하지 않음 |
| Strict-Transport-Security | `NODE_ENV=production`, `VERCEL=1`을 모두 만족할 때만 `max-age=31536000` |

운영 CSP는 다음과 같다. 저장소 연결 주소가 없거나 유효하지 않으면 해당 origin을 제외한다.

```text
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' <검증된 저장소 origin>;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

`NODE_ENV=development`일 때만 `script-src`에 `'unsafe-eval'`, `connect-src`에 `ws:`와 `wss:`를 추가해 React 개발 정보와 HMR을 허용한다. 테스트·운영에는 이 예외가 없다. 로컬 `next start`도 production 모드이지만 Vercel 조건을 충족하지 않으므로 HSTS를 붙이지 않는다. 하위 도메인 전체의 HTTPS 운영 정책을 가정하지 않도록 `includeSubDomains`와 `preload`는 추가하지 않는다. 이번 Report-Only 단계에는 `upgrade-insecure-requests`도 넣지 않는다.

## 자원과 연결 범위

- 브라우저 폰트는 `/fonts/PretendardVariable.woff2`이므로 `font-src 'self'`로 충분하다.
- Next의 정적 셸 인라인 스크립트와 React/XYFlow의 스타일을 유지한다. 절차도의 노드 크기·위치·연결선, 진행률 너비 등은 인라인 스타일을 사용한다.
- `upload-attachment.ts`의 서명 PUT과 관리자 파일 진단의 서명 PUT/GET은 저장소로 직접 연결한다. `AWS_ENDPOINT_URL_S3`에서 HTTPS origin만 계산한다. 인증정보, 비어 있지 않은 경로, query, fragment, 제어문자가 있는 주소는 정책에 넣지 않는다. 저장소 클라이언트의 `forcePathStyle: true`와 일치하며 버킷별 호스트 와일드카드는 필요하지 않다. 환경값 변경 후에는 다시 빌드·배포해야 한다.
- BizRouter·법령 API·Neon 인증·DB는 서버가 호출한다. 이 서버 전용 주소나 키를 `connect-src`에 넣지 않는다. 실제 환경 파일·비밀값을 열람하거나 테스트에 사용하지 않았다.
- 관리자 진단, CSV, 업무분장표 다운로드는 `blob:` URL을 사용한다. `worker-src 'self' blob:`는 문서가 요구한 워커 범위를 명시하지만 현재 브라우저의 PDF 워커 사용을 의미하지는 않는다.
- 현재 `src`에는 PDF.js 브라우저 import, PDF iframe/object/embed 미리보기 화면이 없다. Kordoc은 서버에서 문서를 추출하며 PDFKit은 서버에서 업무분장표를 만든다. PDF.js는 내보내기 테스트에 사용된다. 따라서 존재하지 않는 PDF 미리보기 대신 PDF 첨부 다운로드, 본문·페이지 추출 결과, 업무분장표 PDF 내보내기를 확인한다. `object-src 'none'`을 완화하거나 새 미리보기 기능을 추가하지 않는다.

## nonce 비교와 선택 이유

설치된 Next 16.4.3의 `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`와 `01-app/03-api-reference/05-config/01-next-config-js/headers.md`를 읽고 적용했다.

nonce는 요청마다 예측 불가능한 값을 만들고 Proxy에서 요청 CSP에 전달해야 Next가 런타임·페이지·인라인 스크립트에 붙일 수 있다. 이를 위해 페이지를 동적 렌더링해야 하며 정적 생성·기본 CDN 캐시·PPR과의 제약이 생긴다. 현재 `/`는 정적 셸이며 해시 이동은 클라이언트에서 처리한다. nonce 전환은 그 렌더링 방식과 배포 비용까지 바꾸는 작업이다. 또한 nonce만으로 React의 `style` 속성을 해결하지 못하므로 XYFlow의 인라인 스타일은 별도 검토가 필요하다.

이번에는 기존 동작을 유지하는 Report-Only 정책을 먼저 적용한다. `unsafe-inline`은 인라인 스크립트 주입 방어가 제한되는 선택이며, Report-Only도 차단 정책이 아니다. 완전한 XSS 방어를 구현했다고 표현하지 않는다. 주요 동작과 운영 위반을 관찰한 뒤 강제 적용 범위를 결정하고, 엄격한 스크립트 nonce 정책은 동적 렌더링 영향과 함께 별도 단계로 검토한다.

## 기존 응답과의 관계

`src/lib/api.ts`의 JSON 응답에는 이미 `nosniff`와 `Cache-Control: no-store, private`가 있다. 전역 `nosniff`는 같은 값이며 이번 정책은 캐시, MIME, Content-Disposition을 설정하지 않는다. 첨부파일과 업무분장표 내보내기의 다운로드·캐시 헤더도 유지한다.

`/api/attachments/[id]`의 Neon 302 응답은 더 강한 `Referrer-Policy: no-referrer`를 이미 설정한다. 독립 검토에서 설치된 Next의 `server/send-response.js`는 전역 응답에 같은 키가 있으면 라우트 값을 추가하지 않는다는 점을 확인했다. 따라서 전역 기본값만 추가하면 기존 `no-referrer`가 약화된다.

이를 막기 위해 `next.config.ts`의 마지막 경로 규칙에 `/api/attachments/:path*`와 `Referrer-Policy: no-referrer`를 선언했다. 먼저 적용되는 일반 규칙을 첨부 경로에서만 덮어쓰므로 로컬 파일 응답과 Neon 302 모두 더 엄격한 값을 유지한다. API 소스와 다운로드·캐시 헤더는 변경하지 않았다. 환경값을 인자로 받는 `securityHeaderRoutes`로 설정 규칙을 구성해 테스트에서 실제 환경을 읽지 않는다.

## 검증과 남은 관찰

순수 함수 테스트는 예제 값을 직접 주입해 운영/개발 구분, Vercel/로컬 HSTS, 정상·악성 저장소 주소, 서버 전용 주소·키 미포함, 헤더 중복 없음과 입력 불변성을 검증한다. 첨부 경로 보완 후 정책 테스트 9개와 기존 모의 첨부 저장소·PDF/Excel 내보내기를 합친 관련 테스트 15개가 모두 통과했다. 테스트 기대값을 완화하지 않았으며 임시 경로는 저장소 내부 `.data/h5a-test-temp`를 사용했다. 실제 환경 파일·DB·저장소·AI에는 접근하지 않았다.

추가 회귀 테스트는 설치된 Next의 `getPathMatch`와 `sendResponse`를 직접 호출한다. 전역 헤더가 존재할 때 라우트의 `no-referrer`가 무시되는 동작을 먼저 재현하고, 첨부 경로의 마지막 설정 규칙을 적용하면 200·302 응답에서 `no-referrer`와 기존 캐시·MIME·다운로드 헤더가 함께 유지됨을 확인한다. 일반 경로와 `/api/attachments-other/...`에는 예외가 적용되지 않는 것도 검증한다. 네트워크 요청 없이 메모리 응답 객체만 사용한다. `tsc --noEmit --incremental false`와 변경 파일의 `git diff --check`도 통과했다.

통합 담당자가 현재 QA를 마친 뒤 새 빌드를 만들어 다음을 확인한다.

1. HTML, 404, 정적 폰트, JSON 성공/오류, 첨부 다운로드·302, 업무분장 PDF의 실제 응답 헤더. 로컬 HTTP에는 HSTS가 없어야 한다.
2. 로그인, 업무 홈, 세부업무 상세, 절차도 확대·축소, 파일 첨부·다운로드, PDF 본문 확인과 분장표 PDF 내보내기의 CSP 콘솔 위반.
3. 개발 서버의 HMR 반영과 개발 전용 예외가 운영 정책에 남지 않는지 확인.
4. 배포 HTTPS 응답의 HSTS와 실제 저장소 origin 허용. 실제 저장소 업로드는 승인된 배포 검증 단계에서만 실행한다.

Report-Only만으로 운영 위반이 서버에 자동 수집되지는 않는다. 이번에는 `report-uri`/`report-to` 수집 API를 새로 만들지 않았으며 수동 브라우저 콘솔 확인이 관찰 범위다. 장기 수집이 필요하면 보고서에 포함될 URL·개인정보와 로그 보관 범위를 먼저 정해야 한다.

### 통합 확인 (2026-11-08)

- 첨부 예외를 포함한 전체 652개 테스트·타입 검사·배포용 빌드가 통과했다.
- 로컬 HTML 200, 404, 폰트 200, 세션 200, 미인증 API 401에서 정책 헤더를 확인했다. 모든 로컬 응답에는 HSTS가 없었다.
- 최종 빌드에서 `/api/attachments`, 첨부 ID, `/api/attachments/upload`의 401/405 응답에도 `no-referrer`가 유지되고, 일반 `/api/workspace`는 기본 정책을 유지했다. Neon 302는 실제 저장소에 접속하지 않고 위 Next 직렬화 테스트로 확인했다.
- 격리 QA의 개인·공통·인수인계·성과·업무분장 화면, 상세 절차도 펼침·확대·축소와 업무분장 PDF 다운로드를 확인했다. 해당 브라우저 기록의 경고·오류는 0건이었다. PDF 브라우저 다운로드도 완료됐다.
- 실제 저장소의 업로드/302, 운영 HTTPS의 HSTS, 개발 HMR 실측은 미실행이다. 개발/운영 정책 분기와 PDF 본문·첨부 저장소 계약은 자동 테스트로 검증했으며, 이를 실제 운영 검증으로 표현하지 않는다.
