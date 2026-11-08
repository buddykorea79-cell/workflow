# 문서 수정 및 AI 업무등록 결과 · 2026-11-08

## 적용 범위

입력 문서의 항목별 처리와 검증 기록은 [전체 점검표](REVISION-CHECKLIST-2026-11-07.md)에 정리했다. 사용자가 결정한 업무 마감 고정·회차 일정 분리, 새 마감일 공란, 안내 접기와 역할별 네 메뉴 그룹, 기존 시연 설명 유지를 반영했다.

## 보류·조건부 항목

| 항목 | 현재 처리 | 남은 조건 |
| --- | --- | --- |
| H5c 감사·요청 이력 보관 | 사용자 지시에 따라 구현 보류. 기존 기록 유지 | 보관 기간·위치 정책 결정 |
| C1 포맷·린트 | 기존 미커밋 작업이 있어 원문의 선행 조건에 따라 보류 | 작업 정리 후 포맷 전용·도구 설정 커밋을 분리 |
| D1 디자인 토큰 | 1단계 감사 도구·기준선 완료 | 2~5단계는 독립 커밋·전후 화면 비교 조건과 글자 크기 통합 범위 확정 |
| H5b 쓰기 연결 풀 재사용 | 조회 잠금 제거와 읽기 분리는 구현 | 운영 Fluid 설정과 연결 수명 관리 확인 후 쓰기 풀 재사용 적용 |
| H5d 저장 정규화·D6 전용 상세 화면 | 문서에서 요청한 설계 작성 완료 | 실제 이관·새 화면 구현은 별도 단계 |
| M14·M13 운영 설정/관찰 | 접근 보호와 보안 헤더 구현·로컬 검증. CSP는 Report-Only이며 수집 endpoint 없음 | 운영 접근 코드 설정, 실제 HTTPS·저장소·CSP 관찰과 개발 HMR 확인 |

위 항목은 기술적으로 영구히 불가능한 항목이 아니다. 정책·환경·작업 순서 조건 때문에 현재 단계에서 적용하지 않은 항목을 구분했다. 현재 문서의 커밋·푸시 제한에 따라 수정본은 작업 디렉터리에 남긴다.

## AI 업무등록

개인업무의 추가 버튼 앞에 주황색 **AI 업무등록**을 배치한다. 설명 또는 인수인계·참고 파일을 입력하고, Kordoc으로 읽은 본문과 설명을 BizRouter에 보내 단위업무·세부업무·주요내용을 구성한다. 사용자가 미리보기에서 직접 편집하고 마감일을 선택한 뒤 등록한다.

최대 단위업무 10개·세부업무 30개를 한 번에 검증하고 저장한다. 오류가 있으면 일부만 저장하지 않으며, 응답이 유실된 재시도는 같은 등록 ID로 확인해 중복 생성하지 않는다. 현재 계정의 소속 부서·본인 담당·활성 부서장 검토와 기본 4단계 절차를 적용한다. 문서에서 사람·날짜·법령·예산을 임의로 만들어 넣지 않도록 요청하고 구조를 검증한다. AI 내용의 사실성은 사용자가 원문과 대조해야 한다.

분석 파일은 본인이 올린 비공개 임시 첨부만 사용하며 생성된 모든 업무에 자동 복사하지 않는다. 파일당 10MB·10개, 분석 본문 합계 6만 자를 지원한다. 스캔 이미지·암호화·손상 문서는 본문을 읽을 수 없을 수 있으며, OCR 처리본 또는 직접 입력한 설명이 필요하다. 취소된 임시 첨부의 자동 삭제 정책은 추가하지 않았다.

## 최종 검증

전체 **763개 테스트**, TypeScript 검사(`tsc --noEmit --incremental false`), 배포용 빌드(`npm run build`)가 모두 통과했다. 최종 빌드 ID는 `tYjNup-58SpxAAVNsrE2C`다. CSS 감사의 현재 소스 일치·자체 검증과 변경 내용의 공백 오류 검사도 통과했다.

격리된 로컬 데이터로 역할별 화면, 입력 보존·미저장 확인, 충돌 복구, 검색·알림 이동, 메뉴·키보드 조작, 1440/820/375px 화면을 확인했다. AI 등록은 실제 파일 업로드·Kordoc 추출·편집 미리보기·추가 입력 보존·결과 교체 확인창을 브라우저에서 확인했다. 실제 HTTP 저장 시험에서는 2개 단위업무·3개 세부업무의 일괄 저장, 마지막 항목 오류 시 전체 미반영, 저장 응답 유실 뒤 재시도 시 중복 없음, 수정한 주요내용과 날짜 보존을 확인했다.

AI 화면의 네이티브 날짜 선택은 브라우저 자동화 도구로 완료하지 못했다. 따라서 달력 선택부터 최종 등록 버튼까지의 전체 수동 검증은 미완료이며, 날짜 전송과 저장은 자동 테스트·실제 로컬 HTTP로 검증했다. 실제 BizRouter 모델은 호출하지 않고 모의 응답을 사용했으므로 운영 모델의 생성 품질은 아직 확인하지 않았다. NVDA 음성 출력과 배포 환경의 HTTPS·CSP 관찰도 미실행이다. [AI 검증 상세](notes/ai-work-registration-validation.md)에 검증 방법과 한계를 구분했다.

AI 기능 추가 후 첫 화면 page JS는 **244,687 bytes**로 250KB 목표를 충족한다. 초기 JS 합계는 **710,383 bytes**로 분할 전 1,323,603 bytes보다 **46.3% 감소**했다. 이 수치는 생성된 파일 크기이며 실제 이용자의 로딩 시간 측정값은 아니다. [번들 측정 기록](notes/client-bundle-review.md)을 참고한다.

운영 DB·실제 AI 과금 호출·배포를 실행하지 않았으며 커밋·푸시도 만들지 않았다. `.env.local`은 변경하지 않았다. 수정본은 현재 작업 디렉터리에 있다.

## 주요 변경 파일

| 범위 | 주요 파일과 변경 내용 |
| --- | --- |
| 업무 규칙·저장 | `src/lib/domain.ts`, `command-targets.ts`, `command-revisions.ts`, `task-deadline.ts`, `store.ts`, `neon-store.ts`: 대상별 충돌 검사, 마감·회차 분리, 입력 검증, 조회 분리 |
| 화면·입력 보존 | `src/components/workspace.tsx`, `personal-work.tsx`, `unsaved-changes.tsx`, `common-registration-modal.tsx`: 명령 큐, 미저장 보호, 단위업무 없는 공통업무 등록 |
| 메뉴·검색·접근성 | `grouped-sidebar.tsx`, `workspace-search.tsx`, `accessible-tabs.tsx`, 관련 CSS와 `src/lib` 모듈: 역할별 그룹, 검색 범위·이동, 키보드 조작 |
| 읽기 화면·성능 | `src/components/ui.tsx`, `read-field.css`, `lazy-screen.tsx`, `usage-guide-dialog.tsx`: 읽기 전용 표시, 화면 분할 로딩과 실패 복구 |
| QA·보안 | `scripts/qa-serve.mjs`, `src/lib/store-mode.ts`, `auth.ts`, `security-headers.ts`, `next.config.ts`: QA 저장소 격리, 원격 접근 보호, 보안 헤더 |
| AI 입력·미리보기 | `src/components/ai-work-registration-dialog.tsx`, `ai-work-registration.tsx`, 관련 CSS, `src/lib/work-registration-draft.ts`: 주황색 진입 버튼, 파일 분석, 편집·등록·복구 |
| AI 분석·일괄 저장 | `src/app/api/work-registration/route.ts`, `src/lib/work-registration-generation.ts`, `work-import.ts`, `bizrouter.ts`, `command-response.ts`, `request-json.ts`: 소유권·크기 제한, 구조화 생성, 일괄 검증, 중복 방지 |
| 검증·사용 안내 | 항목별 `tests/*.test.ts`, `docs/USER-GUIDE.md`, `docs/QA.md`, `docs/notes/`, `docs/design/`: 회귀 검사, 사용 방법, 실제 확인 결과·설계안 |

개별 요구사항의 처리 상태와 당시 검증 결과는 [33개 항목 점검표](REVISION-CHECKLIST-2026-11-07.md)에 기록했다. 후속 순서는 보관 정책 결정, 정리 전용 커밋 조건 확보, 운영 환경 확인, 실제 모델 품질·최종 날짜 입력 수동 확인이다.
