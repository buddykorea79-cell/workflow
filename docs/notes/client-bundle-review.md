# C3 · 화면별 코드 분할 측정

기준 빌드: D5 검증 완료 빌드 `glCl5xJ9KEuNGElak-Brx` (2026-11-08). 최종 비교 빌드: C3 검증 완료 빌드 `C9_kl-XW_G1X5eejdTZgL` (같은 날). 두 결과 모두 같은 명령과 기준으로 측정했다.

```powershell
node scripts/measure-client-bundle.mjs --out .data/c3-before.json
# 코드 분할 후 production build를 마친 다음:
node scripts/measure-client-bundle.mjs --out .data/c3-after.json
```

| 구분 | 변경 전 원본 bytes | 변경 전 gzip bytes | 변경 후 원본 bytes | 변경 후 gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| 첫 화면 page 청크 1개 | 685,412 | 180,525 | 240,227 | 70,835 |
| 초기 공유 청크 (2개 → 1개) | 188,019 | 60,127 | 13,018 | 3,975 |
| Next/React runtime 청크 4개 | 450,172 | 133,112 | 452,618 | 134,382 |
| 실제 초기 script 합계 (7개 → 6개) | 1,323,603 | 373,764 | 705,863 | 209,192 |

page 청크는 원본 기준 **65.0%**, gzip 기준 **60.8%** 감소했다. 전체 초기 script 합계도 원본 **46.7%**, gzip **44.0%** 감소했다. 250KB를 250,000 bytes로 잡아도 최종 page 240,227 bytes로 목표를 충족한다. 비교 원본은 `.data/c3-before.json`과 `.data/c3-after.json`에 보관한다.

`index.html`의 실제 script 태그를 기준으로 현대 브라우저 초기 파일을 중복 제거한다. `nomodule` polyfill은 별도 집계한다. gzip은 각 파일을 수준 9로 압축한 크기의 합계로, HTTP 헤더나 서버의 실제 압축 설정은 포함하지 않는다. `client-reference-manifest` 전체 파일 합계나 모든 static chunk 합계를 첫 로딩 크기로 사용하지 않는다. 초기 파일 밖의 청크는 다른 route와 비동기 코드가 섞여 있으므로 별도 집계한다.

기준·최종 빌드의 전체 클라이언트 JS에서 pdfkit, exceljs, kordoc, pdfjs-dist, AWS SDK 관련 문자열 지표는 발견되지 않았다. 문자열 검사는 최소화 과정에서 이름이 사라질 수 있으므로 부재의 증명으로 보지 않는다. 최종 소스도 TypeScript AST로 `workspace.tsx`부터 재귀 추적했다. 타입 전용 import/export를 제외한 정적 경로 62개 모듈의 외부 의존성은 React·React DOM·Lucide뿐이며, 문자열 리터럴 동적 import까지 포함한 92개 모듈에는 `@xyflow/react`와 그 CSS만 추가된다. 위 서버 패키지나 `node:` 의존성은 클라이언트 경로에 없다. 이 추적은 별도 읽기 전용 소스 검사이며, 저장된 자동 테스트와 구분한다.

서버 패키지의 실제 소유 경로도 확인했다. `organization-division-export.ts`의 PDFKit·ExcelJS는 조직 업무분장표 내보내기 API에서, `document-extraction.ts`의 Kordoc은 문서 추출 API에서, `attachment-storage.ts`의 AWS SDK는 첨부·관리 연동 API에서만 실행된다. `task-description-files.tsx`가 가져오는 `ExtractedDocument`는 타입 전용이다. PDF.js는 내보낸 PDF를 검사하는 테스트에서만 사용한다. 측정 도구와 소스 검사는 환경 파일·API·운영 저장소에 접근하지 않았다.

코드 분할 후 전체 716개 테스트·타입 검사·production build가 통과했다. 느린 연결·로딩 실패·각 화면 첫 진입의 실제 브라우저 검증 결과는 아래에 별도 기록한다.

## 로딩·오류·초안 보호 계약

공유 `createLazyScreen(loader, { label, kind })`는 모듈 상단에서 한 번 만들고 `{ Component, preload }`를 반환한다. `kind`는 `page` 또는 모달 안 콘텐츠 등에 쓰는 `section`이다. loader는 컴포넌트 자체 또는 `{ default: 컴포넌트 }`를 반환할 수 있으며 `React.lazy`와 `Suspense`를 사용한다. 네트워크 요청 중에는 이름이 있는 `role=status` 골격을 보여주고, 오류 시 해당 위치에서 다시 불러오기를 제공한다.

코드 요청의 Promise와 성공한 모듈만 캐시하며 사용자·workspace·입력값은 캐시에 넣지 않는다. hover/focus의 `preload`는 동시 요청을 합치고 실패를 소비한다. 실패한 미리 불러오기는 이후 실제 진입에서 다시 요청할 수 있다. React.lazy는 실패 결과도 기억하므로 명시적으로 다시 불러올 때만 새 lazy 인스턴스와 오류 경계를 만든다. 성공한 화면에서 props나 workspace가 갱신될 때에는 컴포넌트 타입·key를 바꾸지 않아 입력 상태를 유지한다.

페이지 새로고침은 `requestWorkspaceNavigation`을 거친다. 모달 아래에 보존된 초안까지 확인해야 하므로 현재 모달 범위의 가드를 사용하지 않는다. 메뉴·탭 선택 자체는 기존 탐색 가드를 유지한다. 모달은 바깥 껍질을 즉시 표시하고 내용만 지연 로딩해 포커스 트랩과 닫기 동작을 유지한다.

## 공통 검증

`lazy-resource`, `lazy-screen`, `client-bundle-measurement` 신규 테스트 11개 통과: 요청 중복 제거, 성공 캐시, 실패 재시도, 재시도 성공 뒤 화면 재진입, 실패한 미리 불러오기 후 진입, 요청 중 reset의 안전성, 명명된 skeleton, streaming SSR의 실제 콘텐츠, props 갱신 시 타입 유지, 모달 뒤 초안까지 포함하는 새로고침 가드, 측정 파일 중복·polyfill·비동기 분류를 확인했다.

기존 콘텐츠 검증은 fallback을 정답으로 바꾸지 않는다. 필요할 때 `tests/helpers/render-component.ts`의 `renderComponent`로 `onAllReady`를 기다려 실제 콘텐츠를 검사한다. 최초 동적 import의 스트림에는 실제 콘텐츠와 함께 React의 fallback·치환 스크립트가 남을 수 있으므로 fallback 부재를 일반적인 성공 조건으로 삼지 않는다. SSR 스트림은 로딩 오류를 reject하며, 실제 브라우저의 오류 경계·재시도·느린 연결 동작은 별도 수동 검증 대상이다.

## 실제 첫 진입·지연·실패 검증

- 격리 QA 앞에 127.0.0.1:3002→3001 루프백 프록시만 두었다. 운영 서비스·DB·외부 AI를 호출하지 않았다. 초기 HTML script 목록 이외 JS 청크에만 합성503 또는3초 지연을 적용했다.
- 부서 예산 청크503에서 화면별 오류와 ‘다시 불러오기/페이지 새로고침’이 표시됐다. 통신 복구 후 재시도에 성공하고 개인업무로 나갔다 재진입해도 성공 화면이 유지됐다. 처음 실패가 React.lazy에 남는 문제는 공통 factory 수정·회귀 테스트와 이 실제 재진입으로 확인했다.
- 인수인계3초 지연에서 명명된 로딩 골격이 보이고 메뉴 버튼이 사용 가능했다. 응답 후 정상 목록으로 바뀌었다.
- 사용 안내3초 지연에서 Modal 하나가 즉시 열리고 초점이 dialog에 유지됐다. 본문이 도착해도 같은 dialog/초점이 유지되며 닫은 뒤 도움말 버튼으로 돌아왔다.
- 공통업무·배정·대행·성과·조직·관리자·업무분장표·부서예산·인수인계 첫 진입, 관리자 연결화면과 예산 관리 본문을 확인했다. 연결 테스트·예산 수정·승인 등 데이터 변경은 실행하지 않았다.
- 세부업무 기본 개요가 즉시 표시되고 절차/일정·수행/성과/관련 근거/예산 탭의 실제 본문이 나타났다. 절차도 최초 펼침 및 확대·축소도 정상이다. 월별 실적 경계는 실제 콘텐츠 SSR 회귀로 검증했다.
- 업무 개요에 합성 초안을 작성한 채 절차 청크 실패를 재현했다. 오류의 ‘페이지 새로고침’은 전역 미저장 확인을 표시했다. 취소 후 개요로 돌아가 초안이 유지됐고, 시험 종료 때 명시 폐기했다. 서버 저장은 하지 않았다.
- 정상 탐색 중 새 콘솔 오류는 없었으며, 의도한503의 ChunkLoadError만 기록됐다. 일반 네트워크 중단 전체를 재현한 것은 아니고 청크 실패·지연을 통제한 시험이다.
- 증빙: `.data/review-screenshots/c3-chunk-error.jpg`, `c3-delayed-loading.jpg`, `c3-procedure-loaded.jpg`.
- 통합 타입 검사·전체716개 테스트·C3 배포용 빌드 통과. 메뉴/AI 기능까지 포함한 전체 작업의 최종 크기는 아래와 같다.

## 메뉴·AI 업무등록 포함 최종 측정

2026-11-08 전체 763개 테스트·타입 검사·빌드 통과 후 `scripts/measure-client-bundle.mjs`로 재측정했다. 빌드 ID는 `tYjNup-58SpxAAVNsrE2C`, 원본은 `.data/final-bundle.json`이다.

| 구분 | 최종 bytes | 최종 gzip bytes |
| --- | ---: | ---: |
| 첫 화면 page 청크 1개 | 244,687 | 72,149 |
| 초기 공유 청크 1개 | 13,018 | 3,975 |
| Next/React runtime 청크 4개 | 452,678 | 134,420 |
| 실제 초기 script 합계 6개 | 710,383 | 210,544 |

AI 업무등록은 모달 껍질을 즉시 표시하고 본문을 별도로 불러온다. 기능 추가 후에도 page 250,000 bytes 목표를 충족한다. 분할 전 초기 script 1,323,603 bytes 대비 46.3% 감소했다. 서버 전용 패키지 문자열 지표는 0건이며, 이 지표의 한계는 앞의 설명과 같다.
