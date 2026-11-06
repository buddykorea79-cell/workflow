# 관리자 연결·테스트

관리자 화면의 **서비스 연결**에서 AI, DB, 파일 저장소를 점검합니다. 다른 역할은 진단 API를 실행할 수 없습니다.

## 연결값 설정

이 화면은 설정 여부와 시험 결과만 표시합니다. API 키·DB 비밀번호·서명된 저장소 비밀키를 화면 입력란이나 업무 데이터에 저장하지 않습니다.

- **배포**: Vercel 프로젝트 → Settings → Environment Variables에 저장하고 Production 환경으로 Redeploy합니다.
- **로컬**: 프로젝트 `.env.local`에 같은 이름으로 저장하고 개발 서버를 재시작합니다. Vercel 값은 로컬로 자동 전달되지 않습니다.
- **BizRouter**: 관리 화면의 API 키를 `BIZROUTER_API_KEY`, 사용 허용된 모델 ID를 `BIZROUTER_MODEL`에 저장합니다. 모델은 `json_schema` 응답을 지원해야 합니다.
- **Neon DB**: Neon 프로젝트 → Connect의 PostgreSQL 연결 문자열을 `DATABASE_URL`에 저장합니다. `IEUM_WORKSPACE_ID`의 기본값은 `development`입니다.
- **Neon 파일**: Connect → Storage → Parameters only의 `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 저장합니다. `IEUM_STORAGE_PROVIDER=neon`, `IEUM_STORAGE_BUCKET` 기본값은 `ieum-attachments`, `IEUM_SESSION_SECRET`은 32자 이상의 임의 문자열입니다.
- **파일 CORS**: 저장소에서 현재 앱 주소(예: `https://on-ieum.vercel.app`), `PUT`, `GET`, `HEAD` 메서드와 `Content-Type` 요청 헤더를 허용합니다. 상세 설정은 [Neon 프로토타입 설정](./PROTOTYPE-NEON-SETUP.md)을 참고합니다.

## 시험 항목

| 버튼 | 실제 확인 내용 |
| --- | --- |
| AI 연결·응답 테스트 | 모델 목록 인증·선택 모델 접근·JSON 구조화 응답·고정 시험 문장의 실제 완료 응답 |
| DB 연결·읽기·쓰기 테스트 | DB 접속·워크스페이스 읽기·동일 revision 값 UPDATE 권한 확인 후 ROLLBACK |
| 파일 저장소 연결 테스트 | 새 임시 파일 쓰기·읽기·SHA256 비교·임시 파일 정리 |
| 업로드·다운로드 테스트 | 브라우저의 실제 직접 PUT·저장 확인·서명된 GET·원본 크기/SHA256 비교·임시 파일 정리 |

파일을 선택하지 않으면 작은 시험용 텍스트를 자동으로 만듭니다. 직접 선택하는 시험 파일은 1MB 이하이며, 확인된 파일을 다시 내려받는 버튼도 제공합니다. 시험 객체는 `admin-diagnostics/<UUID>.bin`에만 만들고 기존 업무 첨부와 섞지 않습니다. 실패해도 정리를 시도하며 정리에 실패한 경우 **임시 파일 정리 재시도**를 사용합니다.

시험 도중 페이지를 새로고침하거나 브라우저를 닫으면 정리가 끝나지 않아 1MB 이하 시험 객체가 남을 수 있습니다. 결과의 정리 완료를 확인한 뒤 화면을 닫아 주세요. 강제 종료 후 남은 객체는 Neon Storage의 `admin-diagnostics/` 경로에서 해당 시험 시각의 객체만 삭제할 수 있습니다. 자동 만료 삭제는 제공하지 않습니다.

DB 시험은 실제 업무 데이터를 변경하지 않습니다. AI 시험에는 고정 시험 문장만 보내며 소량의 API 사용량이 발생합니다. 결과에는 실행 시각·소요 시간·단계별 성공/실패가 표시됩니다.

`DATABASE_URL`이 없으면 DB 시험은 Neon 미설정으로 표시됩니다. 로컬 파일 저장을 사용하는 개발 환경에서는 파일 시험을 로컬 임시 파일로 수행합니다. Vercel에서는 Neon 파일 설정이 필요합니다.

## 회귀검증

```powershell
node --import tsx --test tests/admin-integrations.test.ts
```

설정값 비공개, 관리자·동일 출처 검사, AI 응답 검증, DB 롤백, 토큰 변조·소유자·기간 검사, 실제 로컬 업로드/다운로드/정리와 업무 데이터 불변을 검증합니다. 이 테스트는 실제 외부 AI·Neon 연결을 호출하지 않습니다.
