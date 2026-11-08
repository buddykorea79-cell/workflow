# M3 날짜 표시 적용 위치

공통 구현은 `src/lib/date-format.ts`이며 `ui.tsx`도 같은 함수를 다시 내보냅니다. 날짜만 있는 값은 기록된 달력 날짜를 유지하고, ISO 시각은 서울 시간으로 변환합니다. 비어 있거나 유효하지 않은 값은 `미지정`입니다.

| 용도 | 공통 함수 | 표시 예 |
| --- | --- | --- |
| 공간이 좁은 목록·달력 | `formatDate(value, { today: workspace.serverTime })` | 같은 해 `11. 8.`, 다른 해 `2025. 11. 8.` |
| 상세·범위·기록의 날짜 | `formatDateFull(value)` | 항상 `2026. 11. 8.` |
| 기록의 날짜와 시각 | `formatDateTimeFull(value)` | `2026. 11. 8. 오후 03:35` · 서울 시간 |

날짜만 있는 값에 `formatDateTimeFull`을 적용해도 임의의 시각을 만들지 않습니다. 목록의 기준 연도는 브라우저 시각이 아닌 API의 `serverTime`을 사용합니다.

## 컴포넌트별 적용

| 파일·함수 | 위치 | 규칙 |
| --- | --- | --- |
| `allocation-review.tsx` · `AllocationReview` | 부서 접수·승인 요청·인수인계 요청 목록의 날짜와 마감 | 규칙형 · 서버 기준 연도 |
| `department-work.tsx` · `DepartmentHierarchy`, `DepartmentCommon` | 부서 업무·공통업무 목록 마감 | 규칙형 · 서버 기준 연도 |
| `department-work.tsx` · `DepartmentDivisionTable`, `PlanStatus` | 업무분장 확정일, 확정·재작성 시각, 마지막 조회 | Full / FullTime |
| `work-cycles.tsx` · `WorkCycles`, `CycleScheduleForm`, `CurrentCycleSteps` | 상세 회차의 업무 마감·회차 범위·절차 날짜·초과 확인창 | Full |
| `work-cycles.tsx` · `CycleHistory`, `ProcedureRevisionEntry`, `CurrentCycleNotes` | 이전 회차 범위, 완료·체크·메모·절차 교체 기록 | Full / FullTime |
| `personnel-handover.tsx` · `TransferComposer`, `TransferDetail`, `PersonnelHandover` | 인수인계 범위의 업무 마감, 요청·승인·적용 시각·이력 | Full / FullTime |
| `delegation-work.tsx` · `TaskDelegationSection`, `DelegationWork` | 대행 시작·종료, 요청·승인 시각 | FullTime |
| `management.tsx` · `AdminView` | 배포 이력 날짜와 감사 기록 시각 | Full / FullTime · 감사 기록 연도 추가 |
| `directive-overview.tsx` · `DirectiveOverview` | 지시사항 상세의 지시일 | Full |
| `directive-monthly.tsx` · `DirectiveMonthlyReports`, `MonthlyReportForm` | 월별 실적 이력·최근 저장 | FullTime |
| `unit-evaluation.tsx` · `SubmissionStatusPanel`, `PersonPerformance` | 성과 제출·평가 시각, 평가 확정일 | FullTime / Full · 평가 확정일도 서울 기준 |
| `organization-editor.tsx` · `OrganizationEditor` | 구성원 변경 이력 | FullTime |
| `organization-division.tsx` · `OrganizationDivision` | 업무분장표 생성 시각 | FullTime |
| `department-budget.tsx` · `DepartmentBudgetView` | 예산 집계 생성 시각 | FullTime |
| `admin-integrations.tsx` · `Result` | 관리자 연결 시험 결과 시각 | FullTime |
| `law-reference-picker.tsx` · `LawReferencePicker` | 법령 시행일·공포일 | 유효한 날짜는 Full |
| `command-revision.tsx` · `latestContent` | 충돌 검토창의 마감·시작·지시일, 절차 범위, 집행일 | Full · 저장 payload는 그대로 유지 |
| `workspace.tsx` · `Dashboard` | 업무·다음 할 일 목록, 최근 감사 기록 | 목록은 규칙형, 감사는 FullTime |
| `personal-work.tsx` | 받은 업무·일정 목록, 업무 상세 헤더·개요·기록 | 목록은 규칙형, 상세와 기록은 Full / FullTime |
| `common-work.tsx` | 공통업무 목록·배정표, 승인 검토의 마감·지시일·처리 시각 | 목록은 규칙형, 승인 기록은 Full / FullTime |

## 입력과 예외

- 날짜·일시 입력의 ISO 값, 날짜 비교용 `YYYY-MM-DD`, 달력의 연월·요일·날짜 숫자, 반기·월별 실적의 기간 이름은 데이터 또는 탐색 구조이므로 유지합니다.
- 법령 API가 날짜로 해석할 수 없는 기존 문자열을 반환하면 원문을 유지하며, 제공되지 않은 법령 날짜는 기존 `미제공` 표시를 유지합니다. 유효하지 않은 원문을 임의의 날짜로 정규화하지 않습니다.
- 새 세부업무의 업무 마감일은 사용자 결정에 따라 비워 두고 선택을 요구합니다. 새 업무·업무 개요 수정·공통업무 작성의 과거 마감에는 `오늘 이전 날짜입니다. 이미 지난 업무를 기록하는 경우에만 사용해 주세요.`를 표시하며 저장은 허용합니다.
- 반복 업무의 다음 회차 날짜를 업무 마감일에 자동 제안·적용하지 않습니다. H1에서 업무 마감일과 회차 일정의 의미가 분리되었으므로, 다음 회차는 회차 일정 화면에서 명시적으로 등록하는 현재 흐름을 유지합니다.

공통 함수의 같은 해·다른 해·ISO 시각·빈 값·잘못된 날짜와 서울 자정 경계는 `tests/date-format.test.ts`에서 검증합니다. 날짜 표시는 저장·충돌 판정·권한·미저장 입력 보호 로직을 변경하지 않습니다.
