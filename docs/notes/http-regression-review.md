# H5b HTTP 회귀 검증 · 2026-11-08

최종 H5b 빌드 `2KsSyVQUFn19Vim9mi64S`를 대상으로 `tests/http-*.mjs` 13개를 실행했습니다. 최초 실행에서 8개가 통과했고, 오래된 테스트 기대와 시드 개수 가정을 수정한 5개를 다시 실행해 모두 통과했습니다. 최종 결과는 **13개 스크립트, PASS 검증 묶음 155개 통과**입니다. 각 묶음에는 여러 HTTP 응답·데이터 검증이 포함됩니다.

## 격리와 외부 호출

- 서버는 `scripts/qa-serve.mjs`로 `127.0.0.1:3001`에만 실행했습니다. 스크립트마다 새 `IEUM_QA_DATA_DIR`을 지정하고 서버를 종료한 뒤 다음 시나리오를 시작했습니다.
- `IEUM_STORE=local`, 로컬 첨부 저장, 합성 세션 서명을 사용했습니다. DB·인증·AI·법령·객체 저장소의 외부 연결 변수는 빈 문자열로 명시해 `.env.local`에서 다시 채워지지 않도록 했습니다. 로그인 응답의 로컬 저장 모드와 AI·법령 미연결 표시도 확인했습니다.
- 별도 Node preload에서 외부 `fetch`와 HTTP/HTTPS 요청을 전송 전에 차단했습니다. 차단기가 실제 네트워크 호출 전에 예외를 발생시키는지 확인했습니다. 운영 DB와 유료 AI에는 요청하지 않았습니다.
- `http-description-delegation.mjs`는 `--skip-ai`와 시나리오 전용 **합성 초안 fixture**를 사용했습니다. TXT/HWPX 추출, 첨부, 업무대행, 권한, Excel/PDF 내보내기는 실제 로컬 API로 검증했습니다. **AI 초안 생성·출처 정확도·실제 BizRouter 연동을 검증한 결과는 아닙니다.**
- `http-department-procedure.mjs`의 문서 추출은 OCR·모델 다운로드가 꺼진 로컬 parser를 사용합니다.

## 스크립트별 최종 결과

| 스크립트 | PASS 묶음 | 실행 |
| --- | ---: | --- |
| `http-budget-demo.mjs` | 9 | 최초 통과 |
| `http-common-management.mjs` | 13 | 최초 통과 |
| `http-department-procedure.mjs` | 13 | 기대 수정 후 재검증 |
| `http-description-delegation.mjs` | 11 | 최초 통과 · AI 생성 제외 |
| `http-directives.mjs` | 13 | 최초 통과 |
| `http-personal-management.mjs` | 13 | 최초 통과 |
| `http-procedure-replacement.mjs` | 9 | 최초 통과 |
| `http-procedure-schedule.mjs` | 7 | 최초 통과 |
| `http-task-evidence-files.mjs` | 10 | 기대 수정 후 재검증 |
| `http-unit-evaluation.mjs` | 11 | 시드 가정 수정 후 재검증 |
| `http-work-cycles.mjs` | 9 | 기대 수정 후 재검증 |
| `http-workflow-usability.mjs` | 9 | 최초 통과 |
| `http-workflow.mjs` | 28 | 기대 수정 후 재검증 |

## 수정한 테스트 기대

1. **손상 문서 오류:** PDF 확장자이지만 본문이 유효하지 않은 요청은 현재 공통 문서 추출기와 기존 단위 테스트가 정의한 `422 / DOCUMENT_EXTRACTION_FAILED`를 기대하도록 수정했습니다. 지원하지 않는 확장자의 415와 구분하며 오류 코드 검증을 추가했습니다.
2. **H1 날짜 분리:** 두 HTTP 테스트의 `task.dueDate = 회차 종료일` 기대를 제거했습니다. 원래 업무 마감일이 유지되고 `cycleStartDate`, `cycleDueDate`, 회차 자체 날짜와 절차 날짜가 따로 갱신되는지 검증합니다.
3. **현재 시드의 단위업무 개수:** 과거 복사본의 단위업무 3개를 고정한 평가 테스트를 현재 계정의 전체 단위업무 목록으로 계산하도록 수정했습니다. 총점 50점, 모든 단위업무의 평가 포함, 배점 상한, 합계와 재로그인 보존 검증을 유지합니다. 미래 반기 정책은 변경하지 않았습니다.
4. **H5a 대상별 충돌:** 전역 revision이 오래됐다는 이유만으로 신규 단위업무 생성을 거부하던 기대를 변경했습니다. 오래된 전역 revision의 독립 생성은 성공하고, 같은 단위업무의 오래된 `expected.rev` 수정은 `409 / TARGET_CONFLICT`로 거부되며 최신 내용이 보존되는지를 추가 검증했습니다. 멱등 재전송과 다른 출처의 세션 변경 거부도 유지합니다.

이번 HTTP 보완에서는 애플리케이션 소스를 수정하지 않았습니다. 변경한 HTTP 스크립트의 `git diff --check`도 통과했습니다.

## 실행 기록

- 최초 전체 실행: `.data/h5b-http-2026-11-07T15-54-27-237Z/results.json`
- 보완한 5개 재실행: `.data/h5b-http-2026-11-07T15-56-36-311Z/results.json`
- 각 실행 디렉터리의 스크립트별 하위 폴더에 `server.log`, `test.log`, 격리된 `store/`가 있습니다.
- 실행 도구: `.data/h5b-http-regression-runner.mjs`, `.data/h5b-http-outbound-guard.cjs` (무시되는 로컬 검증 도구)

최초 sandbox 실행은 루프백 연결의 `EACCES`로 HTTP 검증 전에 중단됐습니다. 루프백 전용 실행 권한으로 다시 실행한 위 두 기록이 실제 검증 결과입니다. 빌드가 교체되는 도중 발생한 준비 실패도 기능 실패나 통과 건수에 포함하지 않았습니다.
