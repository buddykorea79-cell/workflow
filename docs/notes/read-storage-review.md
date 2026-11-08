# H5b 조회와 쓰기 분리

기존 로컬 JSON은 저장 잠금 없이 읽습니다. 파일이 없는 첫 실행만 잠금을 잡아 동일한 시드를 한 번 저장합니다. 손상된 JSON을 새 시드로 덮지 않습니다. Neon 조회는 매개변수가 바인딩된 HTTP SELECT이며 FOR UPDATE와 WebSocket Pool을 사용하지 않습니다.

`GET /api/workspace`는 예정 인수인계가 현재 시각에 적용될 경우에만 트랜잭션으로 다시 들어가 권한과 최신 상태를 확인합니다. 일반 조회는 `readState()`와 읽기 모델만 실행합니다. session·budgets·부서예산·법령·업무분장 내보내기·첨부파일 및 관리자 인증 조회도 분리했습니다. 실제 명령·진단 파일 변경 등 쓰기는 기존 트랜잭션을 유지합니다.

## Pool 재사용: 조건부 적용 가능

설치된 Neon 1.2.0 README는 서버리스/Edge WebSocket 연결의 요청 내 생성·정리를 강조합니다. 그러나 이 앱의 라우트는 Node.js이며, [최신 Vercel 공식 안내](https://vercel.com/kb/guide/connection-pooling-with-functions)와 [Neon 공식 안내](https://neon.com/docs/guides/serverless-connection-pooling)는 Fluid Compute처럼 한 인스턴스가 여러 요청을 처리하는 환경에서 전역 Pool과 수명 관리를 지원합니다. 따라서 전역 Pool을 기술적으로 불가능하다고 판단하지 않습니다.

현재 저장소에 Vercel 프로젝트 설정과 `@vercel/functions`가 없고 설치된 CLI도 확인되지 않았습니다. 기존 배포는 GitHub main 자동 배포이며 Fluid 설정을 확인한 기록이 없습니다. 쓰기 Pool 재사용은 배포 프로젝트의 Fluid 설정을 확인하고 `attachDatabasePool` 같은 수명 관리 및 연결 상한을 검증한 뒤 적용할 수 있습니다. 이번 수정은 쓰기 Pool의 요청별 생성·종료를 유지하며, 일반 조회에서 Pool 생성·종료 자체를 제거합니다.

확인 위치: Vercel 프로젝트 Settings → Functions 또는 공식 프로젝트 조회 응답의 `defaultResourceConfig` 내 Fluid 관련 설정. 이 작업에서 배포 설정·환경변수·운영 DB는 변경하지 않았습니다.
