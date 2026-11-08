# D1 디자인 토큰 / C1 포맷 작업 기준선

측정 시점: 2026-11-07T16:59:44.466Z (한국시간 2026-11-08). 기준 HEAD: `b8a31dd`, 브랜치: `main`. 작업 중인 워킹트리의 측정이며 커밋 e85ce6d의 재측정이 아니다. 측정 직전 `git status --porcelain=v1`은 151개 항목이었다. 진행 중인 M10 변경 때문에 이 수치는 이후 달라질 수 있다.

이번 작업은 원문 조건 조사와 기준 측정만 수행했다. 생성 파일은 이 보고서 하나다. `src`, 설정, 패키지, 감사 실행 파일, 커밋, 배포는 변경하지 않았다. D1 전체 완료 또는 C1 완료로 표시하지 않는다.

## 1. 원문의 조건과 현재 판단

원문: 사용자 첨부 `붙여넣은 텍스트.txt`의 C1(782~809행), D1(810~839행). 프로젝트의 일반 지침(56행)은 요청 범위 밖 일괄 재포맷을 별도 C1 작업으로 둔다.

### C1: 현재 일괄 포맷 보류

> “선행 조건(반드시 확인): 커밋되지 않은 변경이나 병합 대기 브랜치가 있으면 작업하지 말고 나에게 알려라.”

현재 미커밋 기능 변경이 있으므로 이 명시적 금지 조건에 해당한다. 병합 대기 브랜치나 원격 PR의 유무는 조사하지 않았으며, 이미 미커밋 조건만으로 보류 판단이 충분하다. “모든 작업은 반드시 사용자 승인을 다시 받아야 한다”는 별도 규칙으로 확대하지 않는다.

원문은 포맷만 적용한 단일 커밋, 해당 해시를 `.git-blame-ignore-revs`에 넣는 후속 커밋, 포맷 커밋과 도구 설정 커밋의 분리를 요구한다. CSS를 Prettier로 함께 포맷할지는 “묻고 결정에 따른다”는 명시적 선택 항목이다. 이미 받은 세션상의 결정이 있다면 그것을 적용하고, 없으면 그 선택만 확인해야 한다.

현재 `prettier`, `eslint`, `eslint-config-next`, `stylelint`는 설치되어 있지 않으며 lint/format 스크립트와 설정 파일도 없다. 설치된 Next 문서 `node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`는 Next 16에서 `next lint`가 제거되었고 ESLint CLI와 flat config를 사용하도록 설명한다. 이번 작업에서 도구를 설치하지 않았다.

현재 `src/components`·`src/lib`의 TS/TSX/JS/JSX 줄 길이: 300자 초과 603줄, 1,000자 초과 61줄. `domain.ts` 최장 줄은 1,545자다. 전체 최장 줄은 src/components/common-work.tsx:203의 4,597자다. 이는 기능 변경 중인 현재 소스를 기준으로 하며 원문 855/97줄과 같은 커밋의 비교가 아니다.

### D1: 측정 가능, 구현은 단계별 조건부 가능

D1 자체에는 C1과 같은 “미커밋 변경이 있으면 작업하지 말라”는 문구가 없다. 대신 “각 단계를 별도 커밋으로”, 3단계는 “컴포넌트 CSS 파일 단위로 커밋”, 1~3단계는 “시각 변화 없음” 및 페이지별 전후 스크린샷 비교를 요구한다. 따라서 현재 기준 측정은 가능하다. 구현을 한 커밋에 섞거나 전후 비교 없이 무변화라고 선언하는 것은 원문 조건을 만족하지 못한다.

| D1 단계 | 현재 상태 | 안전한 다음 작업 / 완료 조건 |
| --- | --- | --- |
| 1 감사 스크립트 | 이번 보고서로 기준 측정만 완료 | 원문 지정 scripts/css-audit.mjs + docs/design/css-audit.md는 아직 생성하지 않음. 후속 단계에서 아래 측정 코드를 파일화하고 첫 독립 커밋으로 관리. |
| 2 tokens.css | 미구현; 기존 색 변수 일부만 있음 | 기존 정확한 값을 유지하는 토큰·별칭 추가는 가능. font/spacing/radius를 제한된 단계로 합치는 부분은 실제 화면 비교와 예외 목록 필요. |
| 3 치환 | 미구현 | 먼저 완전히 동일한 색·수치만 치환(초기 ΔE=0). 가까운 값으로 합치는 작업은 차이와 대비를 보고하고 승인된 미세 조정 범위에서 파일별 진행. |
| 4 덮어쓰기 해소 | 미구현 | cascade·선택자 우선순위·media 조건을 유지한 채 한 컴포넌트씩 병합. 미참조 readability.css를 현재 적용 중인 override로 취급하면 안 됨. |
| 5 stylelint | 미구현 | 새 규칙이 기존 2,002개 hex를 즉시 전부 실패시키지 않도록 3~4단계 이후 적용 범위 확정. 마지막에는 tokens.css 밖 hex 0과 타입 크기 목표를 재검증. |

“시각 변화 없음”과 “font-size 8종 이하 / radius 4단계 / 모든 간격 4px 배수”는 현재 선언값을 단순 통합하는 것만으로 동시에 보장되지 않는다. 실제 활성 선언에는 px 글자 크기 34종, radius px 23종이 있다. 일부는 cascade로 덮일 수 있으므로 모두 화면에 나타난다고 단정하지 않는다. 먼저 계산된 스타일과 1440/375 스크린샷으로 사용 여부를 확인해야 한다. 억지로 목표 수치를 맞추거나 수백 개의 임시 토큰을 만들어 팔레트 정리가 끝났다고 보고하지 않는다.

## 2. 측정 방법과 범위

- 파서: 설치된 PostCSS 8.5.32로 규칙·선언을 파싱하고, 설치된 Next의 `next/dist/compiled/postcss-value-parser`로 선언값을 파싱했다. 새 의존성은 설치하지 않았다.
- 전체 범위는 `src/**/*.css` 30개다. 주석, 선택자, 문자열, URL 내부 조각을 hex/px로 오인하지 않는다. custom property 선언값과 `var()`의 fallback도 선언값이므로 포함한다.
- hex는 3/4자리 표기를 6/8자리로 확장해 고유 색을 센다. 색 함수는 rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color/color-mix를 별도로 세었다. 명명 색상은 관찰된 `white`, `transparent`, `currentColor`만 있으며 hex 횟수에 합치지 않았다.
- font-size·line-height·radius는 선언 전체 값의 종류와 px 토큰 종류를 구분한다. 예를 들어 `clamp(28px,3vw,40px)`은 font-size 선언 1건, px 토큰 2건이다. 숫자·공백을 정규화했다.
- px 합계는 선언값 내 숫자+px 토큰만 센다. @media 조건의 px, inline style, SVG/TSX 색상, 폰트 바이너리, 빌드 산출물은 제외한다. 따라서 앱의 모든 색/크기를 전수 측정한 값은 아니다.
- 활성 범위는 TypeScript AST로 `src/app/**/layout`·`page`에서 정적 import/export 및 문자열 dynamic import를 따라 도달한 CSS다. 실제 브라우저에서 모든 규칙이 적용되었다는 뜻이 아니며, DOM별 computed style·cascade·폰트 로딩 결과는 측정하지 않았다.
- 동일 context·selector·property의 반복은 @media 등 at-rule 문맥까지 같을 때 센다. 의도적 후속 override도 포함하므로 자동 삭제 근거로 쓰지 않는다. 같은 선택자 목록을 표현만 달리한 경우와 specificity로 간접 덮어쓰는 경우는 이 중복 수치에 포함하지 않는다.
- CSS 원본 결합 SHA-256(경로+원본 바이트 순): `290df116b8e97f8b5ef8bb0c1ce150118507c68ba8f97e96c05d8c2a8d61e9b6`. 기준이 달라졌는지 후속 측정에서 확인할 수 있다.

## 3. 전체 및 활성 CSS 기준선

| 지표 | 전체 CSS | 앱 진입점 도달 CSS |
| --- | --- | --- |
| CSS 파일 수 | 30 | 29 |
| UTF-8 원본 바이트 | 347,193 | 341,006 |
| 규칙 수 | 4,539 | 4,408 |
| 선언 수 | 13,672 | 13,453 |
| hex 토큰 발생 / 고유 색 | 2,078 / 1,068 | 2,002 / 992 |
| 색 함수 발생 / 고유 값 | 5 / 5 | 5 / 5 |
| var() 호출 / 참조 변수명 | 602 / 24 | 602 / 24 |
| font-size 선언 / 전체 값 종류 | 1,708 / 41 | 1,609 / 39 |
| font-size 내부 px 토큰 / px 값 종류 | 1,715 / 36 | 1,616 / 34 |
| line-height 선언 / 값 종류 | 521 / 18 | 521 / 18 |
| radius 선언 / 전체 값 종류 | 466 / 34 | 464 / 34 |
| radius 내부 px 토큰 / px 값 종류 | 425 / 23 | 423 / 23 |
| box/text-shadow 선언 / 값 종류 | 29 / 23 | 29 / 23 |
| z-index 선언 / 값 종류 | 12 / 11 | 12 / 11 |
| 전체 선언값 내부 px 토큰 / px 값 종류 | 6,841 / 185 | 6,714 / 185 |
| !important 선언 | 145 | 140 |
| body 선택자를 포함하는 규칙 | 116 | 116 |
| 동일 context·selector·property 반복 그룹 | 92 | 77 |
| 그중 서로 다른 값 그룹 | 84 | 69 |

활성 CSS는 333.014 KiB(반올림 전 바이트는 표 참조)이고, 전체 CSS는 339.056 KiB다. 원문의 “31개/약398KB, hex2173/고유1266/var757/important37”은 이전 커밋과 측정 방식의 값이다. 현재 표와 숫자 차이를 이번 단일 작업의 개선량으로 해석하면 안 된다.

현재 `layout.tsx`의 직접 import 순서는 `globals.css → color-theme.css`다. `readability.css`는 코드 import와 앱 진입점 경로에서 참조되지 않는다(6,187바이트, hex76, font-size99선언, important5). 원문의 “readability.css가 마지막에 덮어쓴다”는 현재 코드에는 맞지 않는다. 이 파일을 삭제하거나 다시 import하지 않았다.

## 4. 파일별 측정

hex·var·font-size·line-height·px·important는 발생 건수, “font px 종류”는 값 종류다. 본문 링크는 저장소 상대 경로다.

| 파일 | 활성 | 바이트 | hex | var() | font-size | font px 종류 | line-height | px | !important |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [src/app/color-theme.css](../../src/app/color-theme.css) | 예 | 16,610 | 118 | 106 | 43 | 12 | 4 | 148 | 2 |
| [src/app/globals.css](../../src/app/globals.css) | 예 | 34,831 | 109 | 92 | 181 | 26 | 16 | 859 | 14 |
| [src/app/readability.css](../../src/app/readability.css) | 아니오 | 6,187 | 76 | 0 | 99 | 9 | 0 | 127 | 5 |
| [src/components/admin-budget-catalog.css](../../src/components/admin-budget-catalog.css) | 예 | 3,289 | 25 | 0 | 16 | 7 | 6 | 68 | 0 |
| [src/components/admin-integrations.css](../../src/components/admin-integrations.css) | 예 | 4,489 | 42 | 0 | 27 | 9 | 13 | 88 | 0 |
| [src/components/allocation-review.css](../../src/components/allocation-review.css) | 예 | 5,747 | 41 | 27 | 18 | 7 | 10 | 105 | 6 |
| [src/components/common-registration-modal.css](../../src/components/common-registration-modal.css) | 예 | 1,258 | 1 | 5 | 3 | 2 | 1 | 16 | 0 |
| [src/components/common-work.css](../../src/components/common-work.css) | 예 | 26,554 | 126 | 74 | 147 | 13 | 43 | 585 | 24 |
| [src/components/delegation-work.css](../../src/components/delegation-work.css) | 예 | 7,690 | 62 | 0 | 32 | 7 | 21 | 134 | 0 |
| [src/components/department-budget.css](../../src/components/department-budget.css) | 예 | 7,387 | 55 | 8 | 40 | 13 | 12 | 155 | 1 |
| [src/components/department-work.css](../../src/components/department-work.css) | 예 | 22,464 | 150 | 81 | 97 | 12 | 34 | 393 | 8 |
| [src/components/directive-monthly.css](../../src/components/directive-monthly.css) | 예 | 4,303 | 24 | 8 | 23 | 3 | 7 | 86 | 0 |
| [src/components/directive-overview.css](../../src/components/directive-overview.css) | 예 | 2,693 | 20 | 1 | 13 | 5 | 5 | 50 | 0 |
| [src/components/law-reference-picker.css](../../src/components/law-reference-picker.css) | 예 | 4,868 | 38 | 0 | 21 | 5 | 11 | 106 | 5 |
| [src/components/management.css](../../src/components/management.css) | 예 | 26,887 | 112 | 24 | 124 | 15 | 26 | 485 | 15 |
| [src/components/organization-division.css](../../src/components/organization-division.css) | 예 | 4,897 | 35 | 18 | 18 | 6 | 6 | 90 | 6 |
| [src/components/organization-person-picker.css](../../src/components/organization-person-picker.css) | 예 | 2,697 | 28 | 0 | 9 | 2 | 5 | 60 | 5 |
| [src/components/personal-work.css](../../src/components/personal-work.css) | 예 | 53,921 | 344 | 21 | 238 | 15 | 94 | 1135 | 22 |
| [src/components/personnel-handover.css](../../src/components/personnel-handover.css) | 예 | 17,152 | 83 | 33 | 71 | 8 | 28 | 310 | 0 |
| [src/components/procedure-builder.css](../../src/components/procedure-builder.css) | 예 | 16,811 | 128 | 1 | 69 | 5 | 31 | 316 | 7 |
| [src/components/procedure-editor.css](../../src/components/procedure-editor.css) | 예 | 5,066 | 33 | 0 | 27 | 6 | 10 | 94 | 0 |
| [src/components/task-budget.css](../../src/components/task-budget.css) | 예 | 6,640 | 56 | 0 | 32 | 9 | 15 | 138 | 4 |
| [src/components/task-description-files.css](../../src/components/task-description-files.css) | 예 | 2,307 | 21 | 0 | 11 | 4 | 6 | 47 | 0 |
| [src/components/task-detail-actions.css](../../src/components/task-detail-actions.css) | 예 | 553 | 11 | 0 | 0 | 0 | 0 | 4 | 0 |
| [src/components/task-file-attachments.css](../../src/components/task-file-attachments.css) | 예 | 2,328 | 17 | 0 | 14 | 4 | 8 | 46 | 0 |
| [src/components/task-performance.css](../../src/components/task-performance.css) | 예 | 2,130 | 19 | 0 | 11 | 4 | 4 | 58 | 0 |
| [src/components/unit-evaluation.css](../../src/components/unit-evaluation.css) | 예 | 25,625 | 132 | 53 | 169 | 20 | 40 | 530 | 21 |
| [src/components/usage-guide.css](../../src/components/usage-guide.css) | 예 | 12,078 | 83 | 10 | 48 | 9 | 28 | 216 | 0 |
| [src/components/work-cycles.css](../../src/components/work-cycles.css) | 예 | 19,014 | 86 | 40 | 104 | 11 | 37 | 379 | 0 |
| [src/components/workspace-directory.css](../../src/components/workspace-directory.css) | 예 | 717 | 3 | 0 | 3 | 2 | 0 | 13 | 0 |

## 5. 토큰 적용 현황과 중복

활성 CSS에 정의된 custom property 이름은 27개다. 참조된 이름은 24개이며, 이 중 `--surface-soft`, `--brand`는 선언이 없지만 `management.css:12,21`에서 각각 fallback(`#f8f9f6`, `#52633f`)이 있으므로 미정의 변수 때문에 스타일이 사라지는 오류는 아니다. 표준 토큰으로 정리할 후보이며 현재 값은 보존해야 한다.

색 토큰은 `globals.css`의 ink/muted/canvas/line 등과 `color-theme.css`의 brand/success/coral 계열에 부분적으로만 있다. 전용 `tokens.css`, neutral 단계, 상태별 fg/bg/border 세트, 글자 크기·행간·간격·그림자·z-index 토큰 체계는 없다. `--radius:16px`는 한 번만 참조한다. font-size와 line-height는 현재 모두 직접 값이며, var() 602회가 곧 색 토큰 적용률을 뜻하지는 않는다(--sidebar 등의 레이아웃 변수 포함).

기존 별칭은 같은 값을 중복 정의한다: `--ink/--text=#172b4d`, `--muted/--text-muted=#52637a`, `--line/--border=#dce4ee`, `--blue/--brand-primary=#205cd5`. 새 토큰의 별칭으로 연결할 수 있으나 `--canvas`·`--sidebar`처럼 선택자/반응형 범위에서 재정의되는 변수는 scope를 유지해야 한다.

body 선택자를 포함한 활성 규칙은 116개(이 중 color-theme.css 115개)다. 예: globals의 `.btn/.badge`와 color-theme의 `body .btn/body .badge`. 이름이 서로 달라 정확한 selector 중복 통계에는 잡히지 않지만 실제 cascade 병합의 핵심 대상이다.

정확히 같은 context·selector·선언목록의 중복 규칙은 전체 기준 1개다. 동일 context·selector·property 반복은 전체 92그룹/활성 77그룹이며, 그중 값이 다른 것은 전체 84그룹/활성 69그룹이다. 대표적으로 `globals.css`의 toast 위치 재정의와 `common-work.css`의 `.cw-view gap:23px→13px`가 있다. 이들은 의도된 최종 동작일 수 있으므로 보이는 규칙을 무조건 지우면 안 된다.

주요 변수 참조 빈도:

| 선언값 | 빈도 |
| --- | --- |
| `--muted` | 282 |
| `--brand-primary` | 102 |
| `--line` | 43 |
| `--pale-blue` | 28 |
| `--ink` | 26 |
| `--coral-ink` | 21 |
| `--action-blue` | 15 |
| `--pale-coral` | 13 |
| `--brand-line` | 12 |
| `--soft` | 11 |
| `--success-green` | 11 |
| `--brand-deep` | 7 |
| `--coral` | 7 |
| `--focus-blue` | 7 |
| `--border` | 4 |
| `--pale-green` | 3 |
| `--canvas` | 2 |
| `--sidebar` | 2 |
| `--brand` | 1 |
| `--brand-primary-hover` | 1 |
| `--field` | 1 |
| `--radius` | 1 |
| `--soft-stone` | 1 |
| `--surface-soft` | 1 |

## 6. 값 빈도와 단계 선택 근거

아래 값 빈도는 모두 활성 CSS 기준이다.

### 색상 상위 18개

| 선언값 | 빈도 |
| --- | --- |
| `#ffffff` | 159 |
| `#52637a` | 154 |
| `#1863dc` | 65 |
| `#707070` | 37 |
| `#dce4ee` | 33 |
| `#172b4d` | 26 |
| `#141414` | 25 |
| `#f1f5ff` | 20 |
| `#edf0f5` | 18 |
| `#f3f3f3` | 18 |
| `#f7f9fc` | 13 |
| `#edf4ff` | 12 |
| `#9d3d29` | 11 |
| `#eeeeee` | 11 |
| `#d6e2fa` | 10 |
| `#e9e9e9` | 10 |
| `#f5f5f5` | 10 |
| `#fbfcff` | 10 |

약한 회색·파랑 값이 많이 분산되어 있다. 먼저 기존 값과 정확히 일치하는 토큰 참조로 바꾸고, ΔE 임계값을 늘리는 것은 별도 시각 검증 뒤에 진행한다. alpha를 가진 8자리 hex와 그림자의 투명도는 opaque 색과 구분한다.

### 글자 크기

| 선언값 | 빈도 |
| --- | --- |
| `14px` | 668 |
| `15px` | 588 |
| `16px` | 61 |
| `13px` | 60 |
| `18px` | 35 |
| `17px` | 32 |
| `12px` | 21 |
| `21px` | 15 |
| `22px` | 15 |
| `20px` | 14 |
| `19px` | 13 |
| `27px` | 10 |
| `29px` | 10 |
| `23px` | 8 |
| `26px` | 8 |
| `24px` | 7 |
| `25px` | 7 |
| `28px` | 7 |
| `30px` | 4 |
| `33px` | 3 |
| `34px` | 3 |
| `32px` | 2 |
| `36px` | 2 |
| `11px` | 1 |
| `31px` | 1 |
| `35px` | 1 |
| `38px` | 1 |
| `39px` | 1 |
| `40px` | 1 |
| `44px` | 1 |
| `51px` | 1 |
| `53px` | 1 |
| `clamp(21px,2vw,29px)` | 1 |
| `clamp(26px, 2.5vw, 32px)` | 1 |
| `clamp(28px,3vw,38px)` | 1 |
| `clamp(28px,3vw,40px)` | 1 |
| `clamp(29px,3vw,42px)` | 1 |
| `clamp(30px,3vw,44px)` | 1 |
| `clamp(42px,4.6vw,65px)` | 1 |

14px와 15px가 1,256회로 font-size 선언 1,609회의 78.1%다. 원문 후보 중 12/13/14/15/16/18/20/24px의 8단계를 업무 UI의 검토 초안으로 삼을 수 있다. 다만 랜딩 제목·대시보드 숫자에는 28~65px도 있어 예외가 실제로 필요한지 먼저 확인해야 한다. 이 보고서는 새 크기를 적용하거나 최종 8단계를 확정하지 않는다.

### 행간 및 명시적 글자·행간 조합

| 선언값 | 빈도 |
| --- | --- |
| `1` | 4 |
| `1.7` | 151 |
| `1.8` | 146 |
| `1.6` | 69 |
| `1.5` | 43 |
| `1.65` | 27 |
| `1.9` | 18 |
| `1.85` | 17 |
| `1.75` | 16 |
| `1.45` | 9 |
| `1.4` | 5 |
| `1.55` | 5 |
| `1.2` | 3 |
| `1.3` | 3 |
| `1.1` | 2 |
| `1.22` | 1 |
| `1.35` | 1 |
| `inherit` | 1 |

같은 규칙 안에 font-size와 line-height가 함께 명시된 조합 상위값이다. 상속이나 cascade까지 합성한 최종 조합이 아니다.

| 선언값 | 빈도 |
| --- | --- |
| `15px / 1.8` | 78 |
| `15px / 1.7` | 62 |
| `14px / 1.7` | 59 |
| `14px / 1.8` | 52 |
| `14px / 1.6` | 26 |
| `15px / 1.6` | 22 |
| `15px / 1.65` | 16 |
| `15px / 1.85` | 14 |
| `13px / 1.7` | 12 |
| `15px / 1.75` | 11 |
| `15px / 1.9` | 11 |
| `15px / 1.5` | 10 |

본문 14/15px에는 1.7/1.8 빈도가 높다. 한 행간으로 무조건 통합하면 줄바꿈·모달 높이·모바일 정보량이 달라지므로 기존 조합을 먼저 보존한다.

### 둥글기, z-index, px 전체

| 선언값 | 빈도 |
| --- | --- |
| `0` | 11 |
| `12px` | 50 |
| `10px` | 42 |
| `14px` | 38 |
| `16px` | 36 |
| `9px` | 31 |
| `50%` | 30 |
| `13px` | 27 |
| `20px` | 25 |
| `999px` | 22 |
| `8px` | 20 |
| `24px` | 19 |
| `11px` | 16 |
| `18px` | 16 |
| `22px` | 14 |
| `15px` | 10 |
| `30%` | 8 |
| `7px` | 8 |
| `6px` | 7 |
| `5px` | 6 |
| `17px` | 5 |
| `4px` | 5 |
| `19px` | 4 |
| `3px` | 3 |
| `99px` | 2 |
| `0 0 16px 16px` | 1 |
| `0 0 8px 8px` | 1 |
| `0 11px 11px 0` | 1 |
| `0 9px 9px 0` | 1 |
| `20px 20px 0 0` | 1 |
| `21px` | 1 |
| `24px 24px 0 0` | 1 |
| `3px 11px 11px 3px` | 1 |
| `var(--radius)` | 1 |

radius 목표 6/10/14/999px를 12/16/20/24px 등에 자동 적용하면 모양이 바뀐다. 50% 원형, 30%, 개별 모서리 조합은 별도로 유지하거나 확인해야 한다.

| 선언값 | 빈도 |
| --- | --- |
| `1` | 2 |
| `4` | 1 |
| `30` | 1 |
| `31` | 1 |
| `32` | 1 |
| `39` | 1 |
| `40` | 1 |
| `100` | 1 |
| `130` | 1 |
| `170` | 1 |
| `180` | 1 |

기존 레이어 값은 base/내부 컨트롤(1·4), topbar(30), popover 닫기 영역(31), 검색·알림 popover(32), scrim(39), sidebar(40), modal-backdrop(100), 저장 표시(130), 펼친 절차도(170), toast(180)다. 이 의미와 중첩 문맥을 유지한 채 같은 수치로 토큰화해야 한다.

전체 px 토큰 상위값(폰트·간격·크기·테두리 포함):

| 선언값 | 빈도 |
| --- | --- |
| `14px` | 885 |
| `15px` | 756 |
| `1px` | 425 |
| `12px` | 362 |
| `16px` | 317 |
| `10px` | 285 |
| `20px` | 266 |
| `18px` | 262 |
| `13px` | 235 |
| `8px` | 232 |
| `9px` | 200 |
| `5px` | 175 |
| `6px` | 161 |
| `7px` | 161 |
| `17px` | 156 |
| `22px` | 139 |
| `24px` | 131 |
| `4px` | 124 |

그림자 선언은 29건/23종이며 `none` 7건도 포함한다. 1px outline·focus ring·100vmax overlay 효과까지 단순히 그림자 3단계로 합치지 않는다. 고도 표현용 box-shadow와 포커스/마스크 용도를 먼저 구분한다.

## 7. 기존 색 조합의 정적 대비 점검

원문 본문 기준 4.5:1에 대해 기존 sRGB 색상만 계산했다. 채널을 선형화하고 상대 휘도 `0.2126R+0.7152G+0.0722B`, 비율 `(밝은 휘도+0.05)/(어두운 휘도+0.05)`를 사용했다. alpha 합성, 사진·그라디언트, opacity, disabled 상태, 실제 글자 크기는 검증하지 않았으므로 전체 UI 접근성 합격 선언이 아니다.

| 조합 | 전경 | 배경 | 대비 | 본문 4.5 기준 |
| --- | --- | --- | --- | --- |
| 기본 본문 / 화면 | `#172b4d` | `#f5f7fb` | 13.15:1 | 충족 |
| 보조 본문 / 흰색 | `#52637a` | `#ffffff` | 6.13:1 | 충족 |
| 브랜드 버튼 / 흰 글자 | `#ffffff` | `#205cd5` | 5.91:1 | 충족 |
| 강조 파랑 / 옅은 파랑 | `#1863dc` | `#f1f5ff` | 4.99:1 | 충족 |
| 완료 문구 / 완료 배경 | `#003c33` | `#edfce9` | 11.63:1 | 충족 |
| 주의 문구 / 주의 배경 | `#9d3d29` | `#fff0eb` | 6.04:1 | 충족 |
| 장식 coral / 흰색 (본문 사용 금지 후보) | `#ff7759` | `#ffffff` | 2.61:1 | 미충족 |

coral 장식색의 낮은 비율은 해당 값이 실제 본문 글자로 쓰인다는 증거가 아니다. 주의 본문은 이미 더 진한 coral-ink를 사용하므로 상태의 장식색과 텍스트색을 분리하는 근거로 활용한다. 기존 텍스트 색을 더 밝은 팔레트로 근사 치환하면 현재 충족하던 대비를 잃을 수 있다.

## 8. 후속 D1 실행 순서와 검증 범위

1. 현재 기능 변경 통합을 완료한 기준 커밋을 확보하고 이 측정을 다시 실행한다. 본 보고서와 같은 CSS SHA면 동일 기준선이다.
2. 독립 감사 도구·출력 문서부터 커밋한다. 파서 집계를 테스트할 때 주석, URL, hex alpha, var fallback, clamp, media 중복을 포함한다.
3. 정확한 기존 값의 tokens.css와 별칭을 만들고 import 순서를 명시한다. 기존 scope와 CSS 우선순위를 보존한다.
4. 한 컴포넌트씩 정확한 값 치환→검증→별도 커밋한다. 근사 치환과 override 병합은 같은 diff에 섞지 않는다.
5. 1440px/375px에서 랜딩·로그인, 업무 홈 3역할, 개인업무, 상세 각 탭, 공통업무, 배정·승인, 일정, 인수인계, 성과·평가, 조직·구성원, 관리자를 전후 비교한다. 원문 “상세 6개 탭” 외 지시사항에만 있는 월별 실적 탭도 실제 대상이면 함께 포함한다.
6. 타입·테스트·빌드, CSS 집계, 대비표를 함께 비교한 뒤 stylelint를 적용한다. C1 포맷은 현재와 섞지 않고 별도 조건 충족 후 진행한다.

이 보고서 작성 중 스크린샷 비교, 실제 브라우저 computed style 측정, 전체 대비 검증, 새 토큰 적용, CSS 자동 치환은 하지 않았다.

## 부록: 이번 측정의 재현 코드

아래 코드를 저장소 루트에서 Node로 실행하면 JSON 집계를 출력한다. 원문이 요구하는 정식 `scripts/css-audit.mjs`는 아직 아니며, 보고서 내 재현용 코드다. 설치된 postcss/Next value parser/TypeScript만 사용한다. 전체 빈도 맵의 상위 값만 출력하는 항목이 있으나 `counts`의 총수와 고유 수는 잘라내기 전 전체 맵으로 계산한다.

```javascript
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),postcss=require('postcss'),vp=require('next/dist/compiled/postcss-value-parser'),ts=require('typescript');
const base=process.cwd(),walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk(path.join(base,'src')),css=files.filter(f=>f.endsWith('.css')).sort(),sources=files.filter(f=>/\.(tsx?|jsx?)$/.test(f));
const rel=f=>path.relative(base,f).replaceAll('\\','/'),norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase(),edges=new Map();
for(const file of sources){const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),refs=[];
function visit(n){let spec;if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))spec=n.moduleSpecifier.text;
if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))spec=n.arguments[0].text;
if(spec&&(spec.startsWith('.')||spec.startsWith('@/'))){const stem=spec.startsWith('@/')?path.join(base,'src',spec.slice(2)):path.resolve(path.dirname(file),spec);const p=[stem,...['.ts','.tsx','.js','.jsx'].map(e=>stem+e),...['.ts','.tsx','.js','.jsx'].map(e=>path.join(stem,'index'+e))].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());if(p)refs.push(p);}ts.forEachChild(n,visit);}visit(ast);edges.set(file,refs);}
for(const f of css){const refs=[];postcss.parse(fs.readFileSync(f,'utf8'),{from:f}).walkAtRules('import',a=>{const m=a.params.match(/^['"]([^'"]+)['"]/);if(m&&m[1].startsWith('.')){const p=path.resolve(path.dirname(f),m[1]);if(fs.existsSync(p))refs.push(p);}});edges.set(f,refs);}
const entries=sources.filter(f=>/[/\\]app[/\\]/.test(f)&&/(?:^|[/\\])(?:page|layout)\.(?:tsx?|jsx?)$/.test(f)),reachable=new Set();
function follow(f){if(reachable.has(f))return;reachable.add(f);(edges.get(f)||[]).forEach(follow);}entries.forEach(follow);
const mapKeys=['hex','hexSpelling','colorFunctions','namedColors','varRefs','fontSize','fontPx','lineHeight','radius','radiusPx','shadow','zIndex','px','fontPairs'];
const make=()=>({files:0,bytes:0,rules:0,declarations:0,customDeclarations:0,important:0,bodyRules:0,duplicateRules:0,...Object.fromEntries(mapKeys.map(k=>[k,{}]))});
const total=make(),active=make(),rows=[],custom=[],overrideMap=new Map(),ruleSeen=new Set();
const add=(o,k)=>o[k]=(o[k]||0)+1,sum=o=>Object.values(o).reduce((a,b)=>a+b,0),canonical=h=>{h=h.toLowerCase();return h.length===4||h.length===5?'#'+h.slice(1).split('').map(c=>c+c).join(''):h};
for(const f of css){const source=fs.readFileSync(f,'utf8'),root=postcss.parse(source,{from:f}),m=make();m.files=1;m.bytes=Buffer.byteLength(source);
root.walkRules(r=>{m.rules++;if(r.selectors.some(s=>/(^|[\s>+~,])body(?=[\s.#:[>+~,]|$)/.test(s)))m.bodyRules++;const context=[];let p=r.parent;while(p&&p.type!=='root'){if(p.type==='atrule')context.unshift('@'+p.name+' '+p.params);p=p.parent;}const ds=r.nodes.filter(n=>n.type==='decl'),signature=JSON.stringify([context,r.selector,ds.map(d=>[d.prop,d.value,!!d.important])]);if(ruleSeen.has(signature))m.duplicateRules++;else ruleSeen.add(signature);
for(const d of ds){const k=JSON.stringify([context,r.selector,d.prop]),list=overrideMap.get(k)||[];list.push({file:rel(f),line:d.source.start.line,value:d.value,important:!!d.important});overrideMap.set(k,list);}
const font=ds.findLast(d=>d.prop==='font-size'),height=ds.findLast(d=>d.prop==='line-height');if(font&&height)add(m.fontPairs,norm(font.value)+' / '+norm(height.value));});
root.walkDecls(d=>{m.declarations++;if(d.important)m.important++;const prop=d.prop.toLowerCase(),value=norm(d.value);
if(prop.startsWith('--')){m.customDeclarations++;custom.push({file:rel(f),line:d.source.start.line,name:d.prop,value:d.value});}
if(prop==='font-size')add(m.fontSize,value);if(prop==='line-height')add(m.lineHeight,value);if(/^border.*radius$/.test(prop))add(m.radius,value);if(prop==='box-shadow'||prop==='text-shadow')add(m.shadow,value);if(prop==='z-index')add(m.zIndex,value);
vp(d.value).walk(n=>{if(n.type==='function'){const name=n.value.toLowerCase();if(name==='url')return false;if(name==='var'){const word=n.nodes.find(n=>n.type==='word');if(word)add(m.varRefs,word.value);}if(['rgb','rgba','hsl','hsla','hwb','lab','lch','oklab','oklch','color','color-mix'].includes(name))add(m.colorFunctions,norm(vp.stringify(n)));}
if(n.type!=='word')return;const word=n.value;if(/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(word)){add(m.hexSpelling,word.toLowerCase());add(m.hex,canonical(word));}if(['transparent','currentcolor','white','black','red','blue','green','gray','grey','yellow','orange','purple'].includes(word.toLowerCase()))add(m.namedColors,word.toLowerCase());const u=vp.unit(word);if(u&&u.unit.toLowerCase()==='px'){const v=Number(u.number)+'px';add(m.px,v);if(prop==='font-size')add(m.fontPx,v);if(/^border.*radius$/.test(prop))add(m.radiusPx,v);}});});
for(const summary of [total,...(reachable.has(f)?[active]:[])])for(const[k,v]of Object.entries(m)){if(typeof v==='number')summary[k]+=v;else for(const[n,c]of Object.entries(v))summary[k][n]=(summary[k][n]||0)+c;}
rows.push({file:rel(f),active:reachable.has(f),bytes:m.bytes,rules:m.rules,declarations:m.declarations,hex:sum(m.hex),uniqueHex:Object.keys(m.hex).length,vars:sum(m.varRefs),fontSizes:Object.keys(m.fontPx).length,fontDeclarations:sum(m.fontSize),lineHeights:sum(m.lineHeight),px:sum(m.px),important:m.important,bodyRules:m.bodyRules});}
const duplicateProperties=[...overrideMap.entries()].filter(([,v])=>v.length>1),conflicting=duplicateProperties.filter(([,v])=>new Set(v.map(d=>d.value+'!'+d.important)).size>1),definitions=new Set(custom.map(d=>d.name));
const hash=crypto.createHash('sha256');for(const f of css){hash.update(rel(f)+'\n');hash.update(fs.readFileSync(f));}
const compact=m=>({...Object.fromEntries(Object.entries(m).map(([k,v])=>[k,typeof v==='number'?v:Object.fromEntries(Object.entries(v).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,['hex','hexSpelling','colorFunctions','px','fontPairs','shadow'].includes(k)?18:100))])),counts:Object.fromEntries(mapKeys.map(k=>[k,{occurrences:sum(m[k]),unique:Object.keys(m[k]).length}]))});
const lines=sources.filter(f=>/[/\\](components|lib)[/\\]/.test(f)).flatMap(f=>fs.readFileSync(f,'utf8').split(/\r?\n/).map((s,i)=>({file:rel(f),line:i+1,length:s.length})));
console.log(JSON.stringify({measuredAt:new Date().toISOString(),parser:require('postcss/package.json').version,cssSha256:hash.digest('hex'),entries:entries.map(rel),total:compact(total),active:compact(active),rows,custom,unresolved:Object.keys(total.varRefs).filter(k=>!definitions.has(k)),duplicatePropertyGroups:duplicateProperties.length,conflictingPropertyGroups:conflicting.length,activeDuplicatePropertyGroups:duplicateProperties.filter(([,list])=>list.filter(d=>reachable.has(path.resolve(base,d.file))).length>1).length,activeConflictingPropertyGroups:conflicting.filter(([,list])=>new Set(list.filter(d=>reachable.has(path.resolve(base,d.file))).map(d=>d.value+'!'+d.important)).size>1).length,overrideExamples:conflicting.filter(([,list])=>new Set(list.filter(d=>reachable.has(path.resolve(base,d.file))).map(d=>d.value+'!'+d.important)).size>1).slice(0,8),sourceLines:{over300:lines.filter(x=>x.length>300).length,over1000:lines.filter(x=>x.length>1000).length,longest:lines.sort((a,b)=>b.length-a.length).slice(0,6)}}));
```
