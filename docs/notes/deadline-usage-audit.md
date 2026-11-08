# H1 마감일 사용처 분류

사용자 결정: 반복 업무도 업무 마감일을 고정하고, 회차 일정을 별도로 관리합니다. 저장된 날짜의 일괄 이관은 하지 않습니다.

| 분류 | 위치 | 의미·처리 |
|---|---|---|
| 업무 마감 | domain.getWorkspace | task.dueDate 치환 제거. cycleStartDate/cycleDueDate는 별도 읽기 모델 |
| 업무 마감 | personal-work 목록·개요·상세 헤더 | 업무 마감 유지, 공통 deadlineState로 기한 경과 판정 |
| 업무 마감 | workspace Dashboard dueSoon·recent·배지 | 업무 마감으로 정렬·집계. 완료·일시중지·보관·삭제 제외 |
| 업무 마감 | department-work.taskExecution | run.dueDate 대체 제거, 업무 마감으로 부서 집계 |
| 업무 마감 | task.configure·task.update·버전 snapshot | 명시적 업무 마감 변경만 반영. 관리 회차의 일정은 별도 유지 |
| 회차 일정 | work-cycles 일정 등록·회차 카드·이력 | run.startDate/dueDate. 업무 마감 초과 경고·확인 후 저장 |
| 절차 일정 | ScheduleView·procedure-order·procedure-schedule | 절차별 시작·종료일. 달력의 업무 마감과 구분 |
| 공통 제출 | common-deadline·common-status·common-work·allocation-review | 중앙 제출기한은 그대로 유지. 내부 회차 종료일로 연장하지 않음 |
| 인계·업무분장 | personnel-handover·work-division | 정의와 fingerprint에 쓰는 날짜는 업무 마감 유지 |
| 업무분장 내보내기 | organization-division-export·모델 | 현재 dueDate 열이 없어 변경 불필요 |
| 평가 | unit-evaluation | dueDate 참조가 없어 변경 불필요 |
| 과거 기록 | procedure-replacement·RunProcedureHistory | 당시 회차의 날짜를 보존 |
| 초기 데이터 | seed·budget-demo·seed-helpers.createRun | 초기 업무/회차 날짜가 같은 것은 정상. 반복 회차 계산의 템플릿 사용은 유지 |
| 미사용 구현 | task-detail·secondary-views | C2에서 제거하여 중복 수정하지 않음 |

## 현재 코드와 원문 차이

원문은 `task.update`를 지목하지만 실제 관리 회차를 덮는 코드는 `task.configure`였습니다. 레거시 회차의 기존 동기화만 유지합니다. `run.nextCycle`의 `previous.dueDate = task.dueDate`는 이전 실행 기록이 없을 때 과거 완료 회차를 최초 복원하는 경로여서, 이미 존재하는 회차를 덮는 동작이 아닙니다.

## 기존 테스트 기대 변경

`schedule-registration.test.ts`와 `work-cycles.test.ts`는 회차 종료일로 치환된 `view.dueDate`를 기대했습니다. 새로운 정책에서는 원래 업무 마감과 별도 `cycleDueDate`를 각각 검증합니다. `personal-integration.test.ts`의 레거시 동기화 검증은 유지하고 관리 회차의 비동기화 검증을 추가합니다.

## 과거 데이터 진단 가능 범위

versions의 dueDate 변화를 비교하는 읽기 전용 진단은 구현할 수 있습니다. 다만 모든 중간 수정이 이력에 남지 않으므로 의심 후보만 찾을 수 있고, 일정 치환이 원인이라고 확정하거나 원래 날짜를 자동 복구할 수는 없습니다. 운영 DB 진단·수정은 수행하지 않습니다.
