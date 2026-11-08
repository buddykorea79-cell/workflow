# D5 표기 일관성 점검

2026-11-08 기준으로 `src`의 `eyebrow`, `hero-eyebrow`, `td-eyebrow` 사용과 표시 문구를 검색했다. 사용자에게 표시되던 영문 머리말은 다음 6개이며 모두 한국어로 바꿨다. 코드의 컴포넌트명·속성명과 CSS 주석의 영어는 표시 문구에 포함하지 않는다.

| 화면 / 파일 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 공통업무 / `src/components/common-work.tsx` | Shared work, clear ownership | 함께하는 업무 |
| 성과·평가 / `src/components/unit-evaluation.tsx` | Performance & evaluation | 성과와 평가 |
| 조직·구성원 / `src/components/management.tsx` | People & organization | 조직과 구성원 |
| 관리자 / `src/components/management.tsx` | Administration | 시스템 관리 |
| 업무 일정 / `src/components/personal-work.tsx` | Plan your next step | 다가오는 일정 |
| 일정의 선택 날짜 / `src/components/personal-work.tsx` | Selected day | 선택한 날짜 |

함께 정리한 표시:

- 일정 화면의 제목 `일정.`을 메뉴와 같은 `업무 일정`으로 변경했다.
- 사이드바의 워크스페이스 부서 표시는 관리자에게 `전체 부서`, 다른 역할에는 기존 소속 부서명을 표시한다. 접근 권한이나 화면별 조회 범위는 바꾸지 않았다.
- 로그인 카드의 내부 사용자 ID는 M14에서 이미 제거하여 중복 수정하지 않았다. 관리 목적의 구성원 정보와 내부 데이터의 ID는 이번 항목의 제거 대상이 아니다.
- `src` 전체에서 `배정는`, `배정를`을 검색한 결과 잔여 항목이 없었다. M5에서 수정한 알림의 `배정을` 표기를 유지한다.
- 숫자 0 채우기는 M9에서 처리한 상태를 유지한다.

사용자의 유지 결정에 따라 로그인 화면의 기존 시연 설명과 README의 시연 순서는 수정하지 않았다. 두 시연 설명을 하나의 시나리오로 통일했다고 보고하지 않는다.

문구만 변경한 항목이므로 새 구현 대응 테스트는 추가하지 않는다. 기존 화면·알림·성과 관련 테스트와 타입 검사를 수행하고, 1440/375 화면 확인은 통합 빌드의 수동 검증에 포함한다.

통합 검증은 전체695개 테스트·타입·배포용 빌드 통과. 실제 공통업무·일정·성과·조직·관리자 화면에서 한국어 머리말과 제목을 확인했다. 관리자 사이드바의 ‘전체 부서’도 확인했다. 1440×900 및375×812 화면을 `.data/review-screenshots/d5-{common,schedule,performance,organization,admin}-{1440,375}.jpg`에 저장했다. 모바일 화면은 메뉴/화면 전환이 끝난 뒤 다시 촬영했고 각 본문 폭과 스크롤 폭이360px로 일치했다. 변경 중 실제 운영 데이터·AI 연결 테스트는 실행하지 않았다.
