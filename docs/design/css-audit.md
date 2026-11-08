# D1 1단계 CSS 감사 기준선

이 파일은 `node scripts/css-audit.mjs`로 생성한다. 제품 CSS·토큰·패키지를 변경하지 않는 감사 도구이며 D1 2~5단계 또는 C1 완료를 의미하지 않는다. 독립 커밋은 아직 생성하지 않았다.

## 재현 방법

```text
node scripts/css-audit.mjs
node scripts/css-audit.mjs --check
node scripts/css-audit.mjs --self-test
```

`--check`는 현재 소스로 다시 계산한 보고서와 이 파일이 같은지 확인하며 파일을 쓰지 않는다. `--self-test`는 주석·문자열·URL 오인과 import 도달 판정의 고정 사례를 검사하며 파일을 쓰지 않는다. `--json`은 같은 감사 데이터의 전체 빈도표를 표준 출력으로 제공한다. 추가 패키지 설치나 환경 파일 읽기, 네트워크 접속은 필요하지 않다.

- CSS 원본 SHA-256: `d679f438fbf99b634bab1b73711eb2133f35040726ead8794d788fca79510f60`
- 참조 분석에 사용한 src CSS·TS/TSX·JS/JSX 원본 SHA-256: `24aa0ac266fc3979746486da977f8e56971a7362c5eb10a4076389c345874fd0`
- 파서: PostCSS 8.5.32, TypeScript 5.9.3, `next/dist/compiled/postcss-value-parser`
- 생성 시각을 출력에 넣지 않아 같은 원본·도구에서는 반복 실행 결과가 같다. 값 빈도가 같으면 문자 코드 순으로 정렬한다.

## 측정 범위와 한계

- 전체는 `src/**/*.css`다. 참조됨은 Next 앱의 page/layout 및 UI 진입점에서 정적 import/export, 문자열 dynamic import/require와 CSS @import를 따라 도달한 파일이다. 타입 전용 import는 제외한다. 이 구분은 브라우저에서 모든 규칙이 적용된다는 뜻이 아니다.
- CSS AST 선언값만 센다. 주석, 선택자, 문자열 안의 색/px, url() 내부 값, @media 조건의 크기는 토큰 집계에서 제외한다. custom property 선언값과 var() fallback은 포함한다. 짧은 hex는 6/8자리로 확장하고 대소문자를 통일한다.
- font-size·radius는 전체 선언값과 내부 px 토큰을 구분한다. 예를 들어 clamp(12px,2vw,20px)는 선언 1건과 px 토큰 2건이다. shadow는 box-shadow와 text-shadow를 합산하고 none도 선언값으로 센다. custom property 이름의 대소문자는 보존한다.
- 전체 값 종류는 주석과 연속 공백을 정리한 선언값 기준이다. CSS 의미론상 같은 모든 표기를 통합하지 않으며 shorthand를 개별 속성으로 풀거나 var()를 실제 값으로 계산하지 않는다. font shorthand의 글자 크기는 font-size 표에 들어가지 않는다.
- 의존 패키지 CSS, public 파일, JSX/SVG 인라인 스타일, CSS-in-JS, 원격 @import, 런타임에 조합되는 import는 제외한다. 정적 도달 분석은 조건부 코드의 실행 여부나 cascade·computed style·폰트 렌더링을 판정하지 않는다. 사용하지 않는 규칙이나 안전한 삭제 대상을 확정하는 도구가 아니다.
- 이 수치는 현재 작업 트리의 기준선이다. 원문 e85ce6d 및 이전 design-token-baseline.md와 커밋·파서 조건이 달라질 수 있으므로 차이를 이 작업의 시각 개선량으로 해석하지 않는다. 토큰 치환·대비 평가·전후 화면 비교는 이번 단계에서 하지 않았다.

## 전체와 코드에서 참조된 CSS

| 지표 | 전체 CSS | 참조됨 |
|---|---:|---:|
| 파일 | 38 | 37 |
| UTF-8 바이트 | 362,239 | 356,052 |
| 규칙 | 4,720 | 4,589 |
| 선언 | 14,203 | 13,984 |
| !important 선언 | 145 | 140 |
| hex 색 발생 / 종류 | 2,113 / 1,073 | 2,037 / 997 |
| font-size 전체 값 발생 / 종류 | 1,744 / 41 | 1,645 / 39 |
| font-size 내부 px 발생 / 종류 | 1,751 / 36 | 1,652 / 34 |
| radius 전체 값 발생 / 종류 | 485 / 35 | 483 / 35 |
| radius 내부 px 발생 / 종류 | 443 / 24 | 441 / 24 |
| box/text-shadow 발생 / 종류 | 33 / 25 | 33 / 25 |
| z-index 발생 / 종류 | 16 / 11 | 16 / 11 |
| line-height 발생 / 종류 | 538 / 18 | 538 / 18 |
| 선언값 내부 전체 px 발생 / 종류 | 7,091 / 186 | 6,964 / 186 |
| var() 참조 발생 / 종류 | 669 / 27 | 669 / 27 |
| 색 함수 발생 / 종류 | 5 / 5 | 5 / 5 |

### 상위 값 · 각 8개

| 지표 | 전체 CSS | 참조됨 |
|---|---|---|
| hex 색 | `#ffffff` × 163 · `#52637a` × 157 · `#1863dc` × 65 · `#707070` × 37 · `#dce4ee` × 33 · `#172b4d` × 28 · `#141414` × 25 · `#f1f5ff` × 22 | `#ffffff` × 163 · `#52637a` × 157 · `#1863dc` × 65 · `#707070` × 37 · `#dce4ee` × 33 · `#172b4d` × 28 · `#141414` × 25 · `#f1f5ff` × 22 |
| font-size 전체 값 | `14px` × 687 · `15px` × 592 · `13px` × 75 · `16px` × 65 · `12px` × 54 · `18px` × 35 · `17px` × 33 · `11px` × 29 | `14px` × 684 · `15px` × 591 · `13px` × 69 · `16px` × 63 · `18px` × 35 · `17px` × 33 · `12px` × 25 · `21px` × 15 |
| font-size 내부 px | `14px` × 687 · `15px` × 592 · `13px` × 75 · `16px` × 65 · `12px` × 54 · `18px` × 35 · `17px` × 33 · `11px` × 29 | `14px` × 684 · `15px` × 591 · `13px` × 69 · `16px` × 63 · `18px` × 35 · `17px` × 33 · `12px` × 25 · `21px` × 16 |
| radius 전체 값 | `12px` × 55 · `10px` × 44 · `14px` × 41 · `16px` × 39 · `9px` × 31 · `50%` × 30 · `13px` × 27 · `20px` × 25 | `12px` × 55 · `10px` × 43 · `14px` × 41 · `16px` × 38 · `9px` × 31 · `50%` × 30 · `13px` × 27 · `20px` × 25 |
| radius 내부 px | `12px` × 55 · `10px` × 44 · `14px` × 41 · `16px` × 41 · `9px` × 33 · `13px` × 27 · `20px` × 27 · `8px` × 25 | `12px` × 55 · `10px` × 43 · `14px` × 41 · `16px` × 40 · `9px` × 33 · `13px` × 27 · `20px` × 27 · `8px` × 25 |
| box/text-shadow | `none` × 8 · `0 10px 30px #172b4d14` × 2 · `0 0 0 100vmax #15243b80` × 1 · `0 0 0 1px #c64c3c` × 1 · `0 0 0 1px #dce9ff` × 1 · `0 0 0 2px #fff` × 1 · `0 0 0 3px #d9e9ff` × 1 · `0 0 0 3px #eaf1ff` × 1 | `none` × 8 · `0 10px 30px #172b4d14` × 2 · `0 0 0 100vmax #15243b80` × 1 · `0 0 0 1px #c64c3c` × 1 · `0 0 0 1px #dce9ff` × 1 · `0 0 0 2px #fff` × 1 · `0 0 0 3px #d9e9ff` × 1 · `0 0 0 3px #eaf1ff` × 1 |
| z-index | `1` × 4 · `32` × 3 · `100` × 1 · `130` × 1 · `170` × 1 · `180` × 1 · `30` × 1 · `31` × 1 | `1` × 4 · `32` × 3 · `100` × 1 · `130` × 1 · `170` × 1 · `180` × 1 · `30` × 1 · `31` × 1 |

## 참조 경로

앱 UI 진입점: `src/app/layout.tsx`, `src/app/page.tsx`

코드에서 도달하지 않은 CSS:

- `src/app/readability.css`

도달 코드가 참조하지만 src 집계 밖인 CSS:

- `src/components/procedure-builder.tsx → @xyflow/react/dist/style.css`

도달 코드의 해결하지 못한 로컬 CSS 참조:

- 없음

## 파일별 빈도

| 파일 | 참조됨 | 바이트 | hex 발생/종류 | font-size 발생/종류 | radius 발생/종류 | shadow 발생/종류 | z-index 발생/종류 |
|---|---|---:|---:|---:|---:|---:|---:|
| [src/app/color-theme.css](../../src/app/color-theme.css) | 예 | 16,642 | 118 / 64 | 43 / 12 | 18 / 9 | 7 / 7 | 0 / 0 |
| [src/app/globals.css](../../src/app/globals.css) | 예 | 35,538 | 110 / 46 | 182 / 25 | 55 / 17 | 3 / 3 | 10 / 9 |
| [src/app/readability.css](../../src/app/readability.css) | 아니요 | 6,187 | 76 / 76 | 99 / 9 | 2 / 2 | 0 / 0 | 0 / 0 |
| [src/components/accessible-tabs.css](../../src/components/accessible-tabs.css) | 예 | 385 | 2 / 1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| [src/components/admin-budget-catalog.css](../../src/components/admin-budget-catalog.css) | 예 | 3,289 | 25 / 21 | 16 / 7 | 4 / 1 | 0 / 0 | 0 / 0 |
| [src/components/admin-integrations.css](../../src/components/admin-integrations.css) | 예 | 4,489 | 42 / 36 | 27 / 9 | 7 / 6 | 0 / 0 | 0 / 0 |
| [src/components/ai-work-registration.css](../../src/components/ai-work-registration.css) | 예 | 2,524 | 0 / 0 | 9 / 3 | 5 / 4 | 0 / 0 | 0 / 0 |
| [src/components/allocation-review.css](../../src/components/allocation-review.css) | 예 | 5,747 | 41 / 13 | 18 / 7 | 9 / 5 | 2 / 2 | 0 / 0 |
| [src/components/common-registration-modal.css](../../src/components/common-registration-modal.css) | 예 | 1,258 | 1 / 1 | 3 / 2 | 3 / 3 | 0 / 0 | 0 / 0 |
| [src/components/common-work.css](../../src/components/common-work.css) | 예 | 26,629 | 126 / 75 | 147 / 13 | 33 / 15 | 0 / 0 | 1 / 1 |
| [src/components/delegation-work.css](../../src/components/delegation-work.css) | 예 | 7,690 | 62 / 48 | 32 / 7 | 11 / 5 | 0 / 0 | 0 / 0 |
| [src/components/department-budget.css](../../src/components/department-budget.css) | 예 | 7,387 | 55 / 39 | 40 / 11 | 10 / 5 | 0 / 0 | 0 / 0 |
| [src/components/department-work.css](../../src/components/department-work.css) | 예 | 22,464 | 150 / 54 | 97 / 11 | 24 / 15 | 0 / 0 | 0 / 0 |
| [src/components/directive-monthly.css](../../src/components/directive-monthly.css) | 예 | 4,303 | 24 / 24 | 23 / 3 | 8 / 4 | 0 / 0 | 0 / 0 |
| [src/components/directive-overview.css](../../src/components/directive-overview.css) | 예 | 2,693 | 20 / 18 | 13 / 5 | 4 / 4 | 0 / 0 | 0 / 0 |
| [src/components/grouped-sidebar.css](../../src/components/grouped-sidebar.css) | 예 | 2,106 | 0 / 0 | 4 / 3 | 3 / 2 | 0 / 0 | 0 / 0 |
| [src/components/help-callout.css](../../src/components/help-callout.css) | 예 | 2,211 | 9 / 6 | 5 / 2 | 2 / 2 | 0 / 0 | 0 / 0 |
| [src/components/law-reference-picker.css](../../src/components/law-reference-picker.css) | 예 | 4,868 | 38 / 35 | 21 / 5 | 9 / 6 | 0 / 0 | 0 / 0 |
| [src/components/lazy-screen.css](../../src/components/lazy-screen.css) | 예 | 1,434 | 7 / 7 | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 |
| [src/components/management.css](../../src/components/management.css) | 예 | 26,968 | 112 / 30 | 124 / 15 | 29 / 12 | 1 / 1 | 0 / 0 |
| [src/components/notification-focus.css](../../src/components/notification-focus.css) | 예 | 282 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| [src/components/organization-division.css](../../src/components/organization-division.css) | 예 | 4,897 | 35 / 16 | 18 / 6 | 6 / 5 | 1 / 1 | 0 / 0 |
| [src/components/organization-person-picker.css](../../src/components/organization-person-picker.css) | 예 | 2,697 | 28 / 21 | 9 / 2 | 5 / 3 | 0 / 0 | 0 / 0 |
| [src/components/personal-work.css](../../src/components/personal-work.css) | 예 | 53,921 | 344 / 171 | 238 / 15 | 74 / 20 | 5 / 3 | 0 / 0 |
| [src/components/personnel-handover.css](../../src/components/personnel-handover.css) | 예 | 17,321 | 83 / 73 | 71 / 8 | 18 / 10 | 2 / 2 | 1 / 1 |
| [src/components/procedure-builder.css](../../src/components/procedure-builder.css) | 예 | 16,811 | 128 / 106 | 69 / 5 | 23 / 11 | 5 / 5 | 1 / 1 |
| [src/components/procedure-editor.css](../../src/components/procedure-editor.css) | 예 | 5,066 | 33 / 30 | 27 / 6 | 9 / 7 | 0 / 0 | 0 / 0 |
| [src/components/read-field.css](../../src/components/read-field.css) | 예 | 507 | 4 / 3 | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 |
| [src/components/task-budget.css](../../src/components/task-budget.css) | 예 | 6,640 | 56 / 51 | 32 / 9 | 11 / 6 | 0 / 0 | 0 / 0 |
| [src/components/task-description-files.css](../../src/components/task-description-files.css) | 예 | 2,307 | 21 / 19 | 11 / 4 | 4 / 4 | 0 / 0 | 0 / 0 |
| [src/components/task-detail-actions.css](../../src/components/task-detail-actions.css) | 예 | 553 | 11 / 8 | 0 / 0 | 0 / 0 | 2 / 2 | 0 / 0 |
| [src/components/task-file-attachments.css](../../src/components/task-file-attachments.css) | 예 | 2,328 | 17 / 17 | 14 / 4 | 4 / 4 | 0 / 0 | 0 / 0 |
| [src/components/task-performance.css](../../src/components/task-performance.css) | 예 | 2,130 | 19 / 18 | 11 / 4 | 7 / 5 | 0 / 0 | 0 / 0 |
| [src/components/unit-evaluation.css](../../src/components/unit-evaluation.css) | 예 | 26,145 | 132 / 106 | 171 / 20 | 33 / 13 | 0 / 0 | 0 / 0 |
| [src/components/usage-guide.css](../../src/components/usage-guide.css) | 예 | 12,078 | 83 / 53 | 48 / 9 | 17 / 11 | 1 / 1 | 0 / 0 |
| [src/components/work-cycles.css](../../src/components/work-cycles.css) | 예 | 19,090 | 86 / 61 | 104 / 11 | 28 / 15 | 1 / 1 | 0 / 0 |
| [src/components/workspace-directory.css](../../src/components/workspace-directory.css) | 예 | 833 | 3 / 3 | 3 / 2 | 1 / 1 | 0 / 0 | 0 / 0 |
| [src/components/workspace-search.css](../../src/components/workspace-search.css) | 예 | 3,821 | 11 / 7 | 12 / 5 | 6 / 5 | 3 / 2 | 3 / 2 |

## 파일별 상위 값 · 각 8개

### src/app/color-theme.css

참조됨: 예 · 규칙 190 · 선언 376 · !important 2

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 118 | 64 | `#ffffff` × 15 · `#52637a` × 12 · `#205cd5` × 5 · `#405571` × 5 · `#415573` × 5 · `#dce4ee` × 5 · `#164ba8` × 3 · `#cbd6e4` × 3 |
| font-size 전체 값 | 43 | 12 | `14px` × 15 · `15px` × 14 · `13px` × 5 · `12px` × 1 · `16px` × 1 · `17px` × 1 · `22px` × 1 · `24px` × 1 |
| font-size 내부 px | 44 | 12 | `14px` × 15 · `15px` × 14 · `13px` × 5 · `32px` × 2 · `12px` × 1 · `16px` × 1 · `17px` × 1 · `22px` × 1 |
| radius 전체 값 | 18 | 9 | `16px` × 5 · `10px` × 4 · `12px` × 2 · `18px` × 2 · `11px` × 1 · `6px` × 1 · `7px` × 1 · `8px` × 1 |
| radius 내부 px | 18 | 9 | `16px` × 5 · `10px` × 4 · `12px` × 2 · `18px` × 2 · `11px` × 1 · `6px` × 1 · `7px` × 1 · `8px` × 1 |
| box/text-shadow | 7 | 7 | `0 16px 48px #173a6809` × 1 · `0 1px 4px #183c7014` × 1 · `0 24px 80px #0e284f29` × 1 · `0 2px 5px #1c396b03` × 1 · `inset 0 0 0 1px var(--brand-primary)` × 1 · `inset 0 0 0 2px var(--action-blue)` × 1 · `inset 3px 0 0 #205cd5` × 1 |
| z-index | 0 | 0 | 없음 |

### src/app/globals.css

참조됨: 예 · 규칙 548 · 선언 1,519 · !important 14

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 110 | 46 | `#ffffff` × 19 · `#141414` × 12 · `#f5f5f5` × 6 · `#dedede` × 5 · `#555555` × 4 · `#f3f3f3` × 4 · `#333333` × 3 · `#666666` × 3 |
| font-size 전체 값 | 182 | 25 | `14px` × 95 · `15px` × 49 · `16px` × 3 · `17px` × 3 · `18px` × 3 · `22px` × 3 · `13px` × 2 · `20px` × 2 |
| font-size 내부 px | 183 | 26 | `14px` × 95 · `15px` × 49 · `16px` × 3 · `17px` × 3 · `18px` × 3 · `22px` × 3 · `13px` × 2 · `20px` × 2 |
| radius 전체 값 | 55 | 17 | `50%` × 16 · `999px` × 9 · `30%` × 5 · `16px` × 4 · `24px` × 4 · `12px` × 2 · `20px` × 2 · `22px` × 2 |
| radius 내부 px | 34 | 11 | `999px` × 9 · `24px` × 6 · `16px` × 4 · `20px` × 4 · `12px` × 2 · `22px` × 2 · `4px` × 2 · `99px` × 2 |
| box/text-shadow | 3 | 3 | `0 0 0 1px #c64c3c` × 1 · `0 0 0 2px #fff` × 1 · `0 3px 12px #172b4d0a` × 1 |
| z-index | 10 | 9 | `1` × 2 · `100` × 1 · `130` × 1 · `180` × 1 · `30` × 1 · `31` × 1 · `32` × 1 · `39` × 1 |

### src/app/readability.css

참조됨: 아니요 · 규칙 131 · 선언 219 · !important 5

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 76 | 76 | `#384f31` × 1 · `#4f5a42` × 1 · `#525e40` × 1 · `#536542` × 1 · `#576c40` × 1 · `#607a48` × 1 · `#607d47` × 1 · `#667753` × 1 |
| font-size 전체 값 | 99 | 9 | `12px` × 29 · `11px` × 27 · `10px` × 21 · `9px` × 9 · `13px` × 6 · `14px` × 3 · `16px` × 2 · `15px` × 1 |
| font-size 내부 px | 99 | 9 | `12px` × 29 · `11px` × 27 · `10px` × 21 · `9px` × 9 · `13px` × 6 · `14px` × 3 · `16px` × 2 · `15px` × 1 |
| radius 전체 값 | 2 | 2 | `10px` × 1 · `16px` × 1 |
| radius 내부 px | 2 | 2 | `10px` × 1 · `16px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/accessible-tabs.css

참조됨: 예 · 규칙 5 · 선언 11 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 2 | 1 | `#205cd5` × 2 |
| font-size 전체 값 | 0 | 0 | 없음 |
| font-size 내부 px | 0 | 0 | 없음 |
| radius 전체 값 | 0 | 0 | 없음 |
| radius 내부 px | 0 | 0 | 없음 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/admin-budget-catalog.css

참조됨: 예 · 규칙 45 · 선언 151 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 25 | 21 | `#1c62ce` × 2 · `#253e5d` × 2 · `#52677f` × 2 · `#d8e2ee` × 2 · `#1d5294` × 1 · `#1e60b7` × 1 · `#2463b8` × 1 · `#263e5c` × 1 |
| font-size 전체 값 | 16 | 7 | `15px` × 7 · `14px` × 3 · `16px` × 2 · `13px` × 1 · `17px` × 1 · `21px` × 1 · `23px` × 1 |
| font-size 내부 px | 16 | 7 | `15px` × 7 · `14px` × 3 · `16px` × 2 · `13px` × 1 · `17px` × 1 · `21px` × 1 · `23px` × 1 |
| radius 전체 값 | 4 | 1 | `12px` × 4 |
| radius 내부 px | 4 | 1 | `12px` × 4 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/admin-integrations.css

참조됨: 예 · 규칙 61 · 선언 203 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 42 | 36 | `#dce4ef` × 3 · `#2a64b0` × 2 · `#607087` × 2 · `#64748b` × 2 · `#ffffff` × 2 · `#1e334d` × 1 · `#233b58` × 1 · `#237654` × 1 |
| font-size 전체 값 | 27 | 9 | `14px` × 8 · `12px` × 7 · `13px` × 5 · `15px` × 2 · `11px` × 1 · `17px` × 1 · `18px` × 1 · `21px` × 1 |
| font-size 내부 px | 27 | 9 | `14px` × 8 · `12px` × 7 · `13px` × 5 · `15px` × 2 · `11px` × 1 · `17px` × 1 · `18px` × 1 · `21px` × 1 |
| radius 전체 값 | 7 | 6 | `15px` × 2 · `10px` × 1 · `11px` × 1 · `13px` × 1 · `4px` × 1 · `7px` × 1 |
| radius 내부 px | 7 | 6 | `15px` × 2 · `10px` × 1 · `11px` × 1 · `13px` × 1 · `4px` × 1 · `7px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/ai-work-registration.css

참조됨: 예 · 규칙 38 · 선언 84 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 0 | 0 | 없음 |
| font-size 전체 값 | 9 | 3 | `14px` × 6 · `13px` × 2 · `16px` × 1 |
| font-size 내부 px | 9 | 3 | `14px` × 6 · `13px` × 2 · `16px` × 1 |
| radius 전체 값 | 5 | 4 | `12px` × 2 · `10px` × 1 · `14px` × 1 · `16px` × 1 |
| radius 내부 px | 5 | 4 | `12px` × 2 · `10px` × 1 · `14px` × 1 · `16px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/allocation-review.css

참조됨: 예 · 규칙 65 · 선언 217 · !important 6

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 41 | 13 | `#1863dc` × 9 · `#52637a` × 8 · `#dce4ee` × 7 · `#ffffff` × 5 · `#172b4d` × 3 · `#eff5ff` × 2 · `#1557bd` × 1 · `#825319` × 1 |
| font-size 전체 값 | 18 | 7 | `15px` × 8 · `16px` × 3 · `14px` × 2 · `17px` × 2 · `21px` × 1 · `25px` × 1 · `28px` × 1 |
| font-size 내부 px | 18 | 7 | `15px` × 8 · `16px` × 3 · `14px` × 2 · `17px` × 2 · `21px` × 1 · `25px` × 1 · `28px` × 1 |
| radius 전체 값 | 9 | 5 | `10px` × 3 · `12px` × 3 · `0` × 1 · `11px` × 1 · `16px` × 1 |
| radius 내부 px | 8 | 4 | `10px` × 3 · `12px` × 3 · `11px` × 1 · `16px` × 1 |
| box/text-shadow | 2 | 2 | `0 0 0 1px #dce9ff` × 1 · `none` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/common-registration-modal.css

참조됨: 예 · 규칙 16 · 선언 41 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 1 | 1 | `#fafbfc` × 1 |
| font-size 전체 값 | 3 | 2 | `16px` × 2 · `14px` × 1 |
| font-size 내부 px | 3 | 2 | `16px` × 2 · `14px` × 1 |
| radius 전체 값 | 3 | 3 | `12px` × 1 · `14px` × 1 · `16px` × 1 |
| radius 내부 px | 3 | 3 | `12px` × 1 · `14px` × 1 · `16px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/common-work.css

참조됨: 예 · 규칙 361 · 선언 1,067 · !important 24

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 126 | 75 | `#1863dc` × 17 · `#ffffff` × 11 · `#f1f5ff` × 7 · `#9d3d29` × 6 · `#d6e2fa` × 4 · `#e4eaf4` × 3 · `#edf0f5` × 3 · `#153a70` × 2 |
| font-size 전체 값 | 147 | 13 | `14px` × 92 · `15px` × 38 · `18px` × 3 · `16px` × 2 · `17px` × 2 · `27px` × 2 · `29px` × 2 · `19px` × 1 |
| font-size 내부 px | 147 | 13 | `14px` × 92 · `15px` × 38 · `18px` × 3 · `16px` × 2 · `17px` × 2 · `27px` × 2 · `29px` × 2 · `19px` × 1 |
| radius 전체 값 | 33 | 15 | `50%` × 5 · `14px` × 4 · `18px` × 4 · `13px` × 3 · `24px` × 3 · `15px` × 2 · `16px` × 2 · `20px` × 2 |
| radius 내부 px | 28 | 12 | `14px` × 4 · `16px` × 4 · `18px` × 4 · `13px` × 3 · `24px` × 3 · `15px` × 2 · `20px` × 2 · `22px` × 2 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 1 | 1 | `4` × 1 |

### src/components/delegation-work.css

참조됨: 예 · 규칙 95 · 선언 314 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 62 | 48 | `#52637a` × 10 · `#ffffff` × 3 · `#536980` × 2 · `#dce5ef` × 2 · `#e0e7f1` × 2 · `#1763d6` × 1 · `#193b62` × 1 · `#1b61c5` × 1 |
| font-size 전체 값 | 32 | 7 | `14px` × 16 · `15px` × 10 · `18px` × 2 · `13px` × 1 · `16px` × 1 · `17px` × 1 · `20px` × 1 |
| font-size 내부 px | 32 | 7 | `14px` × 16 · `15px` × 10 · `18px` × 2 · `13px` × 1 · `16px` × 1 · `17px` × 1 · `20px` × 1 |
| radius 전체 값 | 11 | 5 | `12px` × 3 · `8px` × 3 · `9px` × 3 · `10px` × 1 · `13px` × 1 |
| radius 내부 px | 11 | 5 | `12px` × 3 · `8px` × 3 · `9px` × 3 · `10px` × 1 · `13px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/department-budget.css

참조됨: 예 · 규칙 103 · 선언 308 · !important 1

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 55 | 39 | `#dce4ee` × 8 · `#ffffff` × 5 · `#52637a` × 3 · `#205cd5` × 2 · `#61748e` × 2 · `#ad3434` × 2 · `#172b4d` × 1 · `#2a63b4` × 1 |
| font-size 전체 값 | 40 | 11 | `14px` × 13 · `15px` × 8 · `12px` × 5 · `13px` × 5 · `16px` × 2 · `18px` × 2 · `20px` × 1 · `23px` × 1 |
| font-size 내부 px | 42 | 13 | `14px` × 13 · `15px` × 8 · `12px` × 5 · `13px` × 5 · `16px` × 2 · `18px` × 2 · `20px` × 1 · `21px` × 1 |
| radius 전체 값 | 10 | 5 | `14px` × 3 · `13px` × 2 · `16px` × 2 · `9px` × 2 · `0` × 1 |
| radius 내부 px | 9 | 4 | `14px` × 3 · `13px` × 2 · `16px` × 2 · `9px` × 2 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/department-work.css

참조됨: 예 · 규칙 285 · 선언 851 · !important 8

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 150 | 54 | `#52637a` × 41 · `#1863dc` × 18 · `#ffffff` × 11 · `#dce4ee` × 5 · `#4c6ee6` × 4 · `#edf0f4` × 4 · `#edf0f5` × 4 · `#fbfcff` × 4 |
| font-size 전체 값 | 97 | 11 | `14px` × 44 · `15px` × 38 · `16px` × 4 · `29px` × 3 · `18px` × 2 · `17px` × 1 · `19px` × 1 · `20px` × 1 |
| font-size 내부 px | 98 | 12 | `14px` × 44 · `15px` × 38 · `16px` × 4 · `29px` × 3 · `18px` × 2 · `17px` × 1 · `19px` × 1 · `20px` × 1 |
| radius 전체 값 | 24 | 15 | `14px` × 3 · `16px` × 3 · `999px` × 3 · `10px` × 2 · `20px` × 2 · `24px` × 2 · `0` × 1 · `11px` × 1 |
| radius 내부 px | 23 | 14 | `14px` × 3 · `16px` × 3 · `999px` × 3 · `10px` × 2 · `20px` × 2 · `24px` × 2 · `11px` × 1 · `12px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/directive-monthly.css

참조됨: 예 · 규칙 57 · 선언 191 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 24 | 24 | `#253a55` × 1 · `#263a53` × 1 · `#2b5c97` × 1 · `#2e7756` × 1 · `#34465e` × 1 · `#386ba7` × 1 · `#53657b` × 1 · `#5a6b80` × 1 |
| font-size 전체 값 | 23 | 3 | `15px` × 14 · `14px` × 8 · `17px` × 1 |
| font-size 내부 px | 23 | 3 | `15px` × 14 · `14px` × 8 · `17px` × 1 |
| radius 전체 값 | 8 | 4 | `14px` × 3 · `10px` × 2 · `9px` × 2 · `12px` × 1 |
| radius 내부 px | 8 | 4 | `14px` × 3 · `10px` × 2 · `9px` × 2 · `12px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/directive-overview.css

참조됨: 예 · 규칙 40 · 선언 111 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 20 | 18 | `#e3e8ef` × 3 · `#1e395c` × 1 · `#3868a2` × 1 · `#536d90` × 1 · `#54657b` × 1 · `#617287` × 1 · `#68778b` × 1 · `#708095` × 1 |
| font-size 전체 값 | 13 | 5 | `15px` × 7 · `14px` × 3 · `18px` × 1 · `21px` × 1 · `26px` × 1 |
| font-size 내부 px | 13 | 5 | `15px` × 7 · `14px` × 3 · `18px` × 1 · `21px` × 1 · `26px` × 1 |
| radius 전체 값 | 4 | 4 | `12px` × 1 · `13px` × 1 · `20px` × 1 · `9px` × 1 |
| radius 내부 px | 4 | 4 | `12px` × 1 · `13px` × 1 · `20px` × 1 · `9px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/grouped-sidebar.css

참조됨: 예 · 규칙 25 · 선언 70 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 0 | 0 | 없음 |
| font-size 전체 값 | 4 | 3 | `14px` × 2 · `13px` × 1 · `15px` × 1 |
| font-size 내부 px | 4 | 3 | `14px` × 2 · `13px` × 1 · `15px` × 1 |
| radius 전체 값 | 3 | 2 | `12px` × 2 · `8px` × 1 |
| radius 내부 px | 3 | 2 | `12px` × 2 · `8px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/help-callout.css

참조됨: 예 · 규칙 27 · 선언 88 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 9 | 6 | `#205cd5` × 3 · `#f1f5ff` × 2 · `#263850` × 1 · `#64748b` × 1 · `#d6e2fa` × 1 · `#e2e8f0` × 1 |
| font-size 전체 값 | 5 | 2 | `13px` × 3 · `14px` × 2 |
| font-size 내부 px | 5 | 2 | `13px` × 3 · `14px` × 2 |
| radius 전체 값 | 2 | 2 | `12px` × 1 · `8px` × 1 |
| radius 내부 px | 2 | 2 | `12px` × 1 · `8px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/law-reference-picker.css

참조됨: 예 · 규칙 59 · 선언 199 · !important 5

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 38 | 35 | `#ffffff` × 3 · `#5a6c84` × 2 · `#226447` × 1 · `#243f63` × 1 · `#245fa6` × 1 · `#2868b4` × 1 · `#2e4566` × 1 · `#315e96` × 1 |
| font-size 전체 값 | 21 | 5 | `14px` × 10 · `13px` × 8 · `15px` × 1 · `16px` × 1 · `17px` × 1 |
| font-size 내부 px | 21 | 5 | `14px` × 10 · `13px` × 8 · `15px` × 1 · `16px` × 1 · `17px` × 1 |
| radius 전체 값 | 9 | 6 | `10px` × 4 · `11px` × 1 · `12px` × 1 · `16px` × 1 · `8px` × 1 · `9px` × 1 |
| radius 내부 px | 9 | 6 | `10px` × 4 · `11px` × 1 · `12px` × 1 · `16px` × 1 · `8px` × 1 · `9px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/lazy-screen.css

참조됨: 예 · 규칙 22 · 선언 49 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 7 | 7 | `#172b4d` × 1 · `#205cd5` × 1 · `#52637a` × 1 · `#ae6420` × 1 · `#dbe3ee` × 1 · `#edf1f6` × 1 · `#ffffff` × 1 |
| font-size 전체 값 | 2 | 2 | `15px` × 1 · `17px` × 1 |
| font-size 내부 px | 2 | 2 | `15px` × 1 · `17px` × 1 |
| radius 전체 값 | 2 | 2 | `14px` × 1 · `6px` × 1 |
| radius 내부 px | 2 | 2 | `14px` × 1 · `6px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/management.css

참조됨: 예 · 규칙 333 · 선언 995 · !important 15

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 112 | 30 | `#707070` × 36 · `#141414` × 13 · `#f3f3f3` × 7 · `#efefef` × 5 · `#e2e5df` × 4 · `#ededed` × 4 · `#fafafa` × 4 · `#ffffff` × 4 |
| font-size 전체 값 | 124 | 15 | `15px` × 70 · `14px` × 26 · `16px` × 6 · `18px` × 3 · `19px` × 3 · `21px` × 3 · `17px` × 2 · `22px` × 2 |
| font-size 내부 px | 125 | 15 | `15px` × 70 · `14px` × 26 · `16px` × 6 · `18px` × 3 · `19px` × 3 · `21px` × 3 · `30px` × 3 · `17px` × 2 |
| radius 전체 값 | 29 | 12 | `20px` × 5 · `24px` × 5 · `999px` × 4 · `14px` × 3 · `16px` × 3 · `30%` × 2 · `50%` × 2 · `0` × 1 |
| radius 내부 px | 24 | 9 | `20px` × 5 · `24px` × 5 · `999px` × 4 · `14px` × 3 · `16px` × 3 · `12px` × 1 · `18px` × 1 · `22px` × 1 |
| box/text-shadow | 1 | 1 | `inset 0 0 0 1px #141414` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/notification-focus.css

참조됨: 예 · 규칙 3 · 선언 4 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 1 | 1 | `#205cd5` × 1 |
| font-size 전체 값 | 0 | 0 | 없음 |
| font-size 내부 px | 0 | 0 | 없음 |
| radius 전체 값 | 0 | 0 | 없음 |
| radius 내부 px | 0 | 0 | 없음 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/organization-division.css

참조됨: 예 · 규칙 65 · 선언 198 · !important 6

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 35 | 16 | `#52637a` × 7 · `#dce4ee` × 5 · `#1863dc` × 4 · `#ffffff` × 3 · `#172b4d` × 2 · `#344c6c` × 2 · `#e5ebf3` × 2 · `#edf4ff` × 2 |
| font-size 전체 값 | 18 | 6 | `14px` × 8 · `15px` × 4 · `16px` × 3 · `17px` × 1 · `19px` × 1 · `21px` × 1 |
| font-size 내부 px | 18 | 6 | `14px` × 8 · `15px` × 4 · `16px` × 3 · `17px` × 1 · `19px` × 1 · `21px` × 1 |
| radius 전체 값 | 6 | 5 | `16px` × 2 · `0` × 1 · `10px` × 1 · `12px` × 1 · `8px` × 1 |
| radius 내부 px | 5 | 4 | `16px` × 2 · `10px` × 1 · `12px` × 1 · `8px` × 1 |
| box/text-shadow | 1 | 1 | `none` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/organization-person-picker.css

참조됨: 예 · 규칙 32 · 선언 124 · !important 5

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 28 | 21 | `#ffffff` × 5 · `#52637a` × 3 · `#1763d6` × 2 · `#1d3b61` × 1 · `#23496f` × 1 · `#255c9d` × 1 · `#30445f` × 1 · `#315e91` × 1 |
| font-size 전체 값 | 9 | 2 | `14px` × 5 · `15px` × 4 |
| font-size 내부 px | 9 | 2 | `14px` × 5 · `15px` × 4 |
| radius 전체 값 | 5 | 3 | `10px` × 2 · `8px` × 2 · `7px` × 1 |
| radius 내부 px | 5 | 3 | `10px` × 2 · `8px` × 2 · `7px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/personal-work.css

참조됨: 예 · 규칙 704 · 선언 2,207 · !important 22

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 344 | 171 | `#52637a` × 68 · `#ffffff` × 23 · `#172b4d` × 15 · `#1863dc` × 8 · `#eeeeee` × 8 · `#f3f3f3` × 7 · `#627084` × 5 · `#e2e8f0` × 5 |
| font-size 전체 값 | 238 | 15 | `15px` × 128 · `14px` × 72 · `18px` × 9 · `16px` × 8 · `22px` × 4 · `17px` × 3 · `20px` × 3 · `24px` × 3 |
| font-size 내부 px | 238 | 15 | `15px` × 128 · `14px` × 72 · `18px` × 9 · `16px` × 8 · `22px` × 4 · `17px` × 3 · `20px` × 3 · `24px` × 3 |
| radius 전체 값 | 74 | 20 | `12px` × 9 · `9px` × 8 · `14px` × 7 · `16px` × 7 · `20px` × 7 · `10px` × 6 · `24px` × 5 · `50%` × 4 |
| radius 내부 px | 68 | 16 | `12px` × 9 · `9px` × 8 · `14px` × 7 · `16px` × 7 · `20px` × 7 · `10px` × 6 · `24px` × 5 · `8px` × 4 |
| box/text-shadow | 5 | 3 | `none` × 3 · `0 1px 3px #16385d14` × 1 · `inset 0 0 0 2px #172b4d` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/personnel-handover.css

참조됨: 예 · 규칙 212 · 선언 677 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 83 | 73 | `#ffffff` × 6 · `#e8edf4` × 3 · `#e9edf2` × 3 · `#f3f7ff` × 2 · `#223b60` × 1 · `#235fb3` × 1 · `#24466c` × 1 · `#24496e09` × 1 |
| font-size 전체 값 | 71 | 8 | `14px` × 40 · `15px` × 21 · `16px` × 3 · `18px` × 3 · `17px` × 1 · `20px` × 1 · `24px` × 1 · `27px` × 1 |
| font-size 내부 px | 71 | 8 | `14px` × 40 · `15px` × 21 · `16px` × 3 · `18px` × 3 · `17px` × 1 · `20px` × 1 · `24px` × 1 · `27px` × 1 |
| radius 전체 값 | 18 | 10 | `13px` × 4 · `14px` × 4 · `12px` × 2 · `17px` × 2 · `10px` × 1 · `11px` × 1 · `18px` × 1 · `20px` × 1 |
| radius 내부 px | 17 | 9 | `13px` × 4 · `14px` × 4 · `12px` × 2 · `17px` × 2 · `10px` × 1 · `11px` × 1 · `18px` × 1 · `20px` × 1 |
| box/text-shadow | 2 | 2 | `0 0 0 3px #eaf1ff` × 1 · `0 1px 4px #24496e09` × 1 |
| z-index | 1 | 1 | `1` × 1 |

### src/components/procedure-builder.css

참조됨: 예 · 규칙 175 · 선언 654 · !important 7

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 128 | 106 | `#ffffff` × 10 · `#dce5f1` × 5 · `#6e9eed` × 3 · `#2563c5` × 2 · `#4d617b` × 2 · `#53729b` × 2 · `#596b82` × 2 · `#6b788b` × 2 |
| font-size 전체 값 | 69 | 5 | `14px` × 40 · `15px` × 21 · `13px` × 4 · `16px` × 3 · `18px` × 1 |
| font-size 내부 px | 69 | 5 | `14px` × 40 · `15px` × 21 · `13px` × 4 · `16px` × 3 · `18px` × 1 |
| radius 전체 값 | 23 | 11 | `9px` × 6 · `10px` × 3 · `12px` × 3 · `8px` × 3 · `13px` × 2 · `14px` × 1 · `18px` × 1 · `20px` × 1 |
| radius 내부 px | 23 | 11 | `9px` × 6 · `10px` × 3 · `12px` × 3 · `8px` × 3 · `13px` × 2 · `14px` × 1 · `18px` × 1 · `20px` × 1 |
| box/text-shadow | 5 | 5 | `0 0 0 100vmax #15243b80` × 1 · `0 0 0 3px #d9e9ff` × 1 · `0 2px 10px #34517118` × 1 · `0 2px 4px #1737610a` × 1 · `none` × 1 |
| z-index | 1 | 1 | `170` × 1 |

### src/components/procedure-editor.css

참조됨: 예 · 규칙 67 · 선언 209 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 33 | 30 | `#334962` × 2 · `#536880` × 2 · `#6b7a8d` × 2 · `#2b6b48` × 1 · `#315a94` × 1 · `#376cb8` × 1 · `#405774` × 1 · `#62758d` × 1 |
| font-size 전체 값 | 27 | 6 | `14px` × 10 · `13px` × 7 · `15px` × 5 · `12px` × 3 · `16px` × 1 · `19px` × 1 |
| font-size 내부 px | 27 | 6 | `14px` × 10 · `13px` × 7 · `15px` × 5 · `12px` × 3 · `16px` × 1 · `19px` × 1 |
| radius 전체 값 | 9 | 7 | `13px` × 3 · `10px` × 1 · `12px` × 1 · `16px` × 1 · `4px` × 1 · `8px` × 1 · `9px` × 1 |
| radius 내부 px | 9 | 7 | `13px` × 3 · `10px` × 1 · `12px` × 1 · `16px` × 1 · `4px` × 1 · `8px` × 1 · `9px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/read-field.css

참조됨: 예 · 규칙 4 · 선언 17 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 4 | 3 | `#205cd5` × 2 · `#172b4d` × 1 · `#52637a` × 1 |
| font-size 전체 값 | 1 | 1 | `15px` × 1 |
| font-size 내부 px | 1 | 1 | `15px` × 1 |
| radius 전체 값 | 1 | 1 | `2px` × 1 |
| radius 내부 px | 1 | 1 | `2px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/task-budget.css

참조됨: 예 · 규칙 80 · 선언 272 · !important 4

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 56 | 51 | `#ffffff` × 3 · `#f7f9fc` × 2 · `#fafcff` × 2 · `#fff4ef` × 2 · `#1b5eb8` × 1 · `#203e60` × 1 · `#203f61` × 1 · `#2063d2` × 1 |
| font-size 전체 값 | 32 | 9 | `15px` × 13 · `14px` × 7 · `16px` × 3 · `17px` × 3 · `18px` × 2 · `13px` × 1 · `19px` × 1 · `22px` × 1 |
| font-size 내부 px | 32 | 9 | `15px` × 13 · `14px` × 7 · `16px` × 3 · `17px` × 3 · `18px` × 2 · `13px` × 1 · `19px` × 1 · `22px` × 1 |
| radius 전체 값 | 11 | 6 | `10px` × 3 · `9px` × 3 · `11px` × 2 · `0 9px 9px 0` × 1 · `12px` × 1 · `8px` × 1 |
| radius 내부 px | 12 | 5 | `9px` × 5 · `10px` × 3 · `11px` × 2 · `12px` × 1 · `8px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/task-description-files.css

참조됨: 예 · 규칙 27 · 선언 98 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 21 | 19 | `#ffffff` × 3 · `#22364d` × 1 · `#245ec1` × 1 · `#253c58` × 1 · `#28384a` × 1 · `#315f9c` × 1 · `#345a88` × 1 · `#4b6077` × 1 |
| font-size 전체 값 | 11 | 4 | `14px` × 8 · `13px` × 1 · `15px` × 1 · `16px` × 1 |
| font-size 내부 px | 11 | 4 | `14px` × 8 · `13px` × 1 · `15px` × 1 · `16px` × 1 |
| radius 전체 값 | 4 | 4 | `10px` × 1 · `12px` × 1 · `14px` × 1 · `8px` × 1 |
| radius 내부 px | 4 | 4 | `10px` × 1 · `12px` × 1 · `14px` × 1 · `8px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/task-detail-actions.css

참조됨: 예 · 규칙 4 · 선언 16 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 11 | 8 | `#aa4510` × 2 · `#c65516` × 2 · `#ffffff` × 2 · `#8a6650` × 1 · `#9d3e1114` × 1 · `#ead3c1` × 1 · `#f5e7dd` × 1 · `#f6b58d` × 1 |
| font-size 전체 값 | 0 | 0 | 없음 |
| font-size 내부 px | 0 | 0 | 없음 |
| radius 전체 값 | 0 | 0 | 없음 |
| radius 내부 px | 0 | 0 | 없음 |
| box/text-shadow | 2 | 2 | `0 2px 5px #9d3e1114` × 1 · `none` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/task-file-attachments.css

참조됨: 예 · 규칙 29 · 선언 111 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 17 | 17 | `#344b65` × 1 · `#3d5068` × 1 · `#406fa9` × 1 · `#587497` × 1 · `#5c83bc` × 1 · `#61738b` × 1 · `#6e85a0` × 1 · `#738095` × 1 |
| font-size 전체 값 | 14 | 4 | `13px` × 7 · `12px` × 4 · `14px` × 2 · `15px` × 1 |
| font-size 내부 px | 14 | 4 | `13px` × 7 · `12px` × 4 · `14px` × 2 · `15px` × 1 |
| radius 전체 값 | 4 | 4 | `14px` × 1 · `3px` × 1 · `8px` × 1 · `9px` × 1 |
| radius 내부 px | 4 | 4 | `14px` × 1 · `3px` × 1 · `8px` × 1 · `9px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/task-performance.css

참조됨: 예 · 규칙 33 · 선언 98 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 19 | 18 | `#526074` × 2 · `#244e81` × 1 · `#2458a0` × 1 · `#27384e` × 1 · `#28734f` × 1 · `#5d6d82` × 1 · `#657388` × 1 · `#718097` × 1 |
| font-size 전체 값 | 11 | 4 | `15px` × 7 · `13px` × 2 · `14px` × 1 · `16px` × 1 |
| font-size 내부 px | 11 | 4 | `15px` × 7 · `13px` × 2 · `14px` × 1 · `16px` × 1 |
| radius 전체 값 | 7 | 5 | `10px` × 2 · `14px` × 2 · `0` × 1 · `12px` × 1 · `8px` × 1 |
| radius 내부 px | 6 | 4 | `10px` × 2 · `14px` × 2 · `12px` × 1 · `8px` × 1 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/unit-evaluation.css

참조됨: 예 · 규칙 350 · 선언 1,084 · !important 21

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 132 | 106 | `#ffffff` × 12 · `#edf0f5` × 7 · `#397a70` × 2 · `#5b83e4` × 2 · `#b42318` × 2 · `#e4eaf3` × 2 · `#e5ebf3` × 2 · `#e7ebf2` × 2 |
| font-size 전체 값 | 171 | 20 | `14px` × 84 · `15px` × 50 · `13px` × 5 · `16px` × 4 · `17px` × 4 · `22px` × 3 · `26px` × 3 · `29px` × 3 |
| font-size 내부 px | 172 | 20 | `14px` × 84 · `15px` × 50 · `13px` × 5 · `16px` × 4 · `17px` × 4 · `29px` × 4 · `22px` × 3 · `26px` × 3 |
| radius 전체 값 | 33 | 13 | `12px` × 7 · `22px` × 6 · `10px` × 3 · `13px` × 3 · `11px` × 2 · `14px` × 2 · `18px` × 2 · `19px` × 2 |
| radius 내부 px | 32 | 12 | `12px` × 7 · `22px` × 6 · `10px` × 3 · `13px` × 3 · `11px` × 2 · `14px` × 2 · `18px` × 2 · `19px` × 2 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/usage-guide.css

참조됨: 예 · 규칙 132 · 선언 410 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 83 | 53 | `#1863dc` × 6 · `#5b6574` × 6 · `#526278` × 5 · `#203c60` × 4 · `#dfe6ef` × 4 · `#edf4ff` × 3 · `#ffffff` × 3 · `#153a70` × 2 |
| font-size 전체 값 | 48 | 9 | `15px` × 36 · `14px` × 3 · `16px` × 2 · `23px` × 2 · `17px` × 1 · `18px` × 1 · `19px` × 1 · `21px` × 1 |
| font-size 내부 px | 48 | 9 | `15px` × 36 · `14px` × 3 · `16px` × 2 · `23px` × 2 · `17px` × 1 · `18px` × 1 · `19px` × 1 · `21px` × 1 |
| radius 전체 값 | 17 | 11 | `11px` × 3 · `15px` × 3 · `13px` × 2 · `999px` × 2 · `0 11px 11px 0` × 1 · `14px` × 1 · `17px` × 1 · `18px` × 1 |
| radius 내부 px | 17 | 9 | `11px` × 5 · `15px` × 3 · `13px` × 2 · `999px` × 2 · `14px` × 1 · `17px` × 1 · `18px` × 1 · `22px` × 1 |
| box/text-shadow | 1 | 1 | `0 1px 5px #1b3d6b0d` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/work-cycles.css

참조됨: 예 · 규칙 247 · 선언 776 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 86 | 61 | `#1764dd` × 7 · `#ffffff` × 7 · `#f7f9fc` × 4 · `#e5ebf4` × 3 · `#365b8a` × 2 · `#526278` × 2 · `#5d7495` × 2 · `#64758d` × 2 |
| font-size 전체 값 | 104 | 11 | `14px` × 52 · `15px` × 31 · `13px` × 6 · `16px` × 5 · `17px` × 3 · `20px` × 2 · `18px` × 1 · `19px` × 1 |
| font-size 내부 px | 104 | 11 | `14px` × 52 · `15px` × 31 · `13px` × 6 · `16px` × 5 · `17px` × 3 · `20px` × 2 · `18px` × 1 · `19px` × 1 |
| radius 전체 값 | 28 | 15 | `12px` × 4 · `11px` × 3 · `13px` × 3 · `16px` × 3 · `14px` × 2 · `17px` × 2 · `20px` × 2 · `5px` × 2 |
| radius 내부 px | 31 | 14 | `11px` × 5 · `12px` × 4 · `13px` × 3 · `16px` × 3 · `3px` × 3 · `14px` × 2 · `17px` × 2 · `20px` × 2 |
| box/text-shadow | 1 | 1 | `0 7px 22px #1b53a208` × 1 |
| z-index | 0 | 0 | 없음 |

### src/components/workspace-directory.css

참조됨: 예 · 규칙 11 · 선언 30 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 3 | 3 | `#185ec8` × 1 · `#53647a` × 1 · `#b2d1ff` × 1 |
| font-size 전체 값 | 3 | 2 | `13px` × 2 · `14px` × 1 |
| font-size 내부 px | 3 | 2 | `13px` × 2 · `14px` × 1 |
| radius 전체 값 | 1 | 1 | `0` × 1 |
| radius 내부 px | 0 | 0 | 없음 |
| box/text-shadow | 0 | 0 | 없음 |
| z-index | 0 | 0 | 없음 |

### src/components/workspace-search.css

참조됨: 예 · 규칙 39 · 선언 154 · !important 0

| 지표 | 발생 | 종류 | 상위 값 |
|---|---:|---:|---|
| hex 색 | 11 | 7 | `#ffffff` × 3 · `#172b4d14` × 2 · `#425775` × 2 · `#205cd5` × 1 · `#243b5a` × 1 · `#52637a` × 1 · `#eaf2ff` × 1 |
| font-size 전체 값 | 12 | 5 | `14px` × 5 · `12px` × 4 · `11px` × 1 · `13px` × 1 · `16px` × 1 |
| font-size 내부 px | 12 | 5 | `14px` × 5 · `12px` × 4 · `11px` × 1 · `13px` × 1 · `16px` × 1 |
| radius 전체 값 | 6 | 5 | `4px` × 2 · `0` × 1 · `14px` × 1 · `16px` × 1 · `8px` × 1 |
| radius 내부 px | 5 | 4 | `4px` × 2 · `14px` × 1 · `16px` × 1 · `8px` × 1 |
| box/text-shadow | 3 | 2 | `0 10px 30px #172b4d14` × 2 · `none` × 1 |
| z-index | 3 | 2 | `32` × 2 · `1` × 1 |
