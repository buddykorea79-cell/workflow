# H5a 명령 대상과 변경 버전

AI 업무등록의 `work.import`를 포함한 82개 서버 명령을 전수 분류했습니다. 아래 표의 대상은 충돌을 검사할 주 대상입니다. 실제 저장에서 연쇄 변경된 업무·회차·인수인계·공통업무·성과 등은 주 대상 여부와 관계없이 각각 변경 버전을 올립니다.

| 명령 | 충돌 대상 | 식별 기준 |
|---|---|---|
| budget.upsert | budgetItem | item.id 또는 id |
| budget.setActive | budgetItem | item.id 또는 id |
| budget.import | budgetCatalog | catalog |
| transfer.emergency | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| transfer.request | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| transfer.rolesRequest | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| transfer.approve | transfer | transferId |
| transfer.reject | transfer | transferId |
| transfer.cancel | transfer | transferId |
| department.confirm | departmentPlan | departmentId 또는 요청자의 부서 |
| department.reopen | departmentPlan | departmentId 또는 요청자의 부서 |
| unit.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| work.import | 없음 | 검토한 단위·세부업무 전체 생성. 사용자별 importId로 중복 방지, 모든 항목 검증 뒤 단일 반영 |
| unit.update | unit | unitId |
| unit.delete | unit | unitId |
| unit.restore | unit | unitId |
| organization.departmentCreate | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| organization.userCreate | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| organization.userUpdate | user | userId |
| common.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| common.resubmit | common | commonId |
| common.approve | common | commonId |
| common.reject | common | commonId |
| task.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| task.delete | task | taskId |
| task.restore | task | taskId |
| task.record | task | taskId |
| task.procedure.replace | task | taskId |
| task.configure | task | taskId |
| task.setProgress | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| task.update | task | taskId |
| task.submit | task | taskId |
| task.confirm | task | taskId |
| task.revise | task | taskId |
| task.archive | task | taskId |
| run.schedule | runOrTask | runId가 있으면 run, 없으면 taskId의 task |
| run.completeCycle | runOrTask | runId가 있으면 run, 없으면 taskId의 task |
| run.nextCycle | task | taskId |
| run.create | task | taskId |
| run.check | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| run.completeStep | run | runId |
| run.note | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| handover.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| handover.approve | handover | handoverId |
| handover.check | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| handover.accept | handover | handoverId |
| handover.requestChanges | handover | handoverId |
| handover.cancel | handover | handoverId |
| handover.apply | handover | handoverId |
| handover.update | handover | handoverId |
| common.assignTeam | common | commonId |
| common.assignPerson | common | commonId |
| common.register | common | commonId |
| common.assign | common | commonId |
| common.distribute | common | commonId |
| directive.updateMetadata | common | commonId |
| directive.saveMonthlyReport | common | commonId |
| performance.setWeights | plan | [담당자 ID, 반기] 논리 키 |
| performance.submitPerson | plan | [담당자 ID, 반기] 논리 키 |
| performance.withdrawSubmission | plan | [담당자 ID, 반기] 논리 키 |
| performance.evaluatePerson | plan | [담당자 ID, 반기] 논리 키 |
| performance.saveHalf | halfPerformance | [작성자 ID, 업무 ID, 반기] 논리 키 |
| performance.submitHalf | halfPerformance | [작성자 ID, 업무 ID, 반기] 논리 키 |
| performance.evaluate | performance | performanceId |
| admin.release | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| performance.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| performance.resubmit | performance | performanceId |
| performance.approve | performance | performanceId |
| performance.requestChanges | performance | performanceId |
| source.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| source.verify | source | sourceId |
| source.revise | source | sourceId |
| delegation.requestBatch | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| delegation.request | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| delegation.create | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| delegation.approve | delegation | batchId 또는 delegationId (묶음 소속이면 묶음) |
| delegation.reject | delegation | batchId 또는 delegationId (묶음 소속이면 묶음) |
| delegation.cancel | delegation | batchId 또는 delegationId (묶음 소속이면 묶음) |
| delegation.revoke | delegation | batchId 또는 delegationId (묶음 소속이면 묶음) |
| attachment.allowTest | attachment | attachmentId |
| notification.read | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |
| reconcile | 없음 | 새 항목 생성, 명시적 체크 값, 추가 기록 또는 관리 보충 명령 |

## 저장 계약

- `expectedRevision`은 기존 클라이언트와 조회 응답 순서 확인을 위해 유지하며, 조직 전체 번호 차이를 저장 거절 이유로 사용하지 않습니다.
- 선택한 `expected: { kind, id, rev }`가 있으면 실제 명령 대상과 일치하는지 먼저 확인하고, 대상의 현재 버전과 비교합니다. 다른 대상을 보낸 요청은 `COMMAND_TARGET_MISMATCH`, 같은 대상의 오래된 초안은 `TARGET_CONFLICT`입니다.
- `expected` 없는 기존 요청은 계속 처리합니다. 편집 대상이 있는 명령은 명령 종류와 대상 종류만 서버 경고 로그에 남기며, 업무 내용이나 개인정보는 로그에 넣지 않습니다.
- 기존 `rev`가 없으면 0입니다. 새로 생성된 항목은 1, 실제 내용이 바뀐 기존 항목은 직전 값 + 1입니다. 같은 시각의 연속 변경도 구별합니다.
- 명령 처리 전 업무 레코드만 복사해 종료 시 내용 비교로 버전을 갱신합니다. 감사 로그·처리 요청 이력은 비교 대상에서 제외합니다. 과거 버전 및 평가·절차 이력 내부의 스냅샷은 변경하지 않습니다.
- `halfPerformance`는 같은 작성자·업무·반기 성과들의 버전 합계, `delegationBatch`는 묶음 구성원들의 버전 합계입니다. 생성 전에는 0이며 실제 레코드와 논리 대상 모두 변경 응답을 반환합니다.
- 실제 변경 목록 `TargetRevisionChange[]`는 `{ kind, id, fromRev, toRev }`이며 API의 `workspace.commandChanges`로 해당 요청에만 붙습니다. 클라이언트는 이 응답으로 확인된 자기 저장만 대기열의 예상 버전에 연쇄 반영합니다.
- 멱등 재전송 검사를 대상 충돌 검사보다 먼저 수행합니다. 같은 요청의 재전송과 변경 없는 업무 개요 저장은 빈 변경 목록을 반환합니다. 기존 요청 ID로 다른 내용을 보내면 계속 거절합니다.
- 예정 인수인계의 별도 조정 경로도 실제 변경된 항목의 버전을 갱신합니다. 인계 실패 사유만 바뀐 경우도 한 번 갱신하지만 기존 함수 반환 의미(실제 인계 적용 여부)는 유지합니다.
- 처음 예산 원장을 저장할 때도 기본 제공 항목을 비교 기준에 넣어 수정하지 않은 항목이 불필요하게 충돌하지 않게 합니다. 검색 응답은 개별 `item.rev`와 원장의 `catalogRev`를 제공합니다.

## 검증과 제한

- 81개 명령과 분류표의 누락 여부, 다른 부서의 독립 저장, 동일 대상 충돌, 권한·대상 위조 거절, 멱등 재전송, 변경 없는 저장, 반기 성과 생성 경쟁, 묶음 버전, 예정 인계와 예산 첫 저장을 단위·통합 테스트로 검증합니다.
- HTTP 절차 교체 검증도 기존 전역 충돌 기대를 명시적인 대상 버전 충돌로 바꾸었습니다. 충돌 시 최신 값을 다시 읽고 자동 재시도하는 코드는 제거했습니다.
- 저장소 자체의 직렬 쓰기 잠금은 이 항목에서 변경하지 않습니다. 잠금 없는 조회 및 연결 재사용은 H5b 범위입니다.
- 버전을 보내지 않는 이전 클라이언트는 기존 호환 정책에 따라 대상 충돌 보호가 적용되지 않습니다. 주요 편집 화면은 편집 시작 시 버전을 유지해 전송합니다.
