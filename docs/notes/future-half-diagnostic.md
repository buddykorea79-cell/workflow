# 미래 반기 데이터 읽기 진단

`scripts/check-future-half-periods.ts`는 사용자가 직접 실행할 수 있는 읽기 전용 진단 도구입니다. 현재 서울 날짜보다 미래인 반기의 성과·업무 비중·평가가 저장되어 있는지 확인하며, 원본을 생성·수정·삭제하지 않습니다. 이번 작업에서는 합성 로컬 파일만 검사했고 운영 DB에는 실행하지 않았습니다.

인자 없이 실행하면 도움말만 표시합니다. 기존 로컬 JSON 또는 명시적인 Neon 조회 중 하나를 선택해야 합니다. `.env.local`을 자동으로 읽거나 저장소 기본 경로를 추측하지 않습니다.

```powershell
# 기존 로컬 파일 조회: 실제 파일 경로로 바꾸어 실행합니다.
node --import tsx scripts/check-future-half-periods.ts --file 'D:\path\workspace.json'

# 운영 조회가 필요할 때 사용자가 직접 실행합니다.
# .env.local의 DB 연결을 사용하고, 대상 workspace ID를 반드시 명시합니다.
node --env-file=.env.local --import tsx scripts/check-future-half-periods.ts --neon --workspace-id 'YOUR_WORKSPACE_ID'
```

로컬 모드는 `readFile`만 사용하며 잠금이나 최초 시드를 만들지 않습니다. Neon 모드는 HTTP 드라이버의 매개변수화된 `SELECT data FROM ieum_workspaces WHERE id = ...` 한 번만 사용합니다. `FOR UPDATE`, 저장 트랜잭션, 마이그레이션, 보정 명령은 실행하지 않습니다. 없는 파일·테이블·워크스페이스는 생성하지 않고 오류로 끝납니다.

출력에는 기준 시각·현재 반기·종류별 개수·발견된 미래 반기와 레코드 식별정보만 포함합니다. 성과 본문, 근거, 문서 내용, 첨부, 연락처, DB 연결 문자열과 공급자 오류 내용은 출력하지 않습니다. 미래 데이터가 발견되어도 자동 수정하지 않습니다. 화면에서는 기존 미래 자료를 조회할 수 있으며, 시작 전 반기의 성과·업무 비중 수정과 새 제출은 차단하는 정책을 따릅니다. 이미 제출된 계획에 대한 부서장 평가는 기존 정책을 유지합니다.

합성 파일의 경계 검사에는 `--now '2026-06-30T15:00:00Z'`처럼 시간대가 포함된 기준 시각을 지정할 수 있습니다. 실제 상태를 확인할 때는 이 옵션을 생략합니다. 정상 진단은 종료 코드 0, 입력·연결·형식 오류는 1입니다. 미래 자료가 있다는 사실 자체는 오류가 아니며 `counts`와 `futurePeriods`로 확인합니다.

HTTP 회귀 데이터도 함께 정리했습니다. `http-workflow-usability.mjs`의 2099년부터 거슬러 내려오던 합성 기간은 서버의 서울 현재 반기부터 과거로 선택하고, `http-workflow.mjs`는 현재·직전 반기를 사용합니다. 성과 파일·평가 HTTP 테스트의 기본값도 서버 현재 반기를 사용합니다. helper는 `tests/helpers/http-period.mjs`에 두어 `tests/http-*.mjs` 실행 목록에 섞이지 않게 했습니다.
