# C2 미사용 코드 점검

정적 import, 동적 import, 컴포넌트 이름 및 문자열 경로를 저장소에서 대조했습니다. `task-detail.tsx`, `task-detail.css`, `secondary-views.tsx`, `secondary-views.css`는 다른 모듈에서 사용하지 않아 제거했습니다. 실제 개인업무 상세와 일정은 `personal-work.tsx` 등에서 제공합니다. `task-detail-actions.css`는 `ui.tsx`에서 사용하므로 유지했습니다.

## 빌드 전후

동일한 O1·M14 적용 상태에서 C2 파일 제거 전후에 배포용 빌드를 실행했습니다.

| 산출물 | 제거 전 | 제거 후 | gzip 전/후 |
|---|---:|---:|---:|
| app/page JS | 582,926B | 582,926B | 148,235B / 148,235B |
| CSS 5개 합계 | 346,491B | 346,491B | 63,616B / 63,616B |

이미 미사용 파일이 번들에 포함되지 않아 크기 변화는 없습니다. 소스 중복만 제거했습니다. 최종 전체 테스트 및 개인업무 상세·일정 수동 확인은 전체 점검표에 기록합니다.

## 미사용 export 검토 후보

아래 항목은 외부 import가 없거나 제한적이라 후속 검토할 후보입니다. 모듈 내부 사용·타입 계약·추가 사용 가능성이 있으므로 이번 작업에서 삭제하지 않았고, 미사용 분석 의존성도 추가하지 않았습니다.

`delegationLabel`, `DelegationRequestDialog`, `DepartmentDivisionTable`, `validateDiagnosticBytes`, `ATTACHMENT_SIZE_LIMIT`, `attachmentExtensions`, `isLocalDemo`, `budgetItemSchema`, `DOCUMENT_AI_TEXT_LIMIT`, `isManager`, `assertDepartmentEditable`, `periodFor`, `prototypeCorsRuleId`, `organizationDemoUsers`, `PROCEDURE_STEP_LIMIT`.

M14에서는 `isLocalDemo`를 새 접근 코드 경로에서 명시적으로 사용하므로 제거 후보에서 제외해야 합니다. 이처럼 검색 결과만으로 export를 제거하지 않습니다.
