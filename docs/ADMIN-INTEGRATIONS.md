# 관리자 연결·테스트

관리자 화면의 **서비스 연결**에서 AI 모델을 선택하고 AI, DB, 파일 저장소를 점검합니다. 다른 역할은 모델 설정이나 진단 API를 실행할 수 없습니다.

## 연결값 설정

API 키·DB 비밀번호·저장소 비밀키는 서버 환경변수로 관리합니다. 화면에는 비밀값을 표시하지 않으며 업무 데이터에도 저장하지 않습니다. 관리자 화면에서 저장하는 AI 모델 ID는 비밀값이 아닌 워크스페이스 공통 설정입니다.

- **배포**: Vercel 프로젝트 → Settings → Environment Variables에 저장하고 Production 환경으로 Redeploy합니다.
- **로컬**: 프로젝트 `.env.local`에 같은 이름으로 저장하고 개발 서버를 재시작합니다. Vercel 값은 로컬로 자동 전달되지 않습니다.
- **BizRouter**: 서비스 API 키를 `BIZROUTER_API_KEY`에 저장합니다. `BIZROUTER_MODEL`은 관리자 저장 모델이 없을 때 사용할 서버 기본값입니다. `.env.example`의 `openai/gpt-6.1-sol`은 예시이며 현재 키의 허용 목록과 `json_schema` 지원을 확인해야 합니다. 서버 기본값이 없어도 관리자 화면에서 사용 가능한 모델을 저장하면 됩니다.
- **Neon DB**: Neon 프로젝트 → Connect의 PostgreSQL 연결 문자열을 `DATABASE_URL`에 저장합니다. `IEUM_WORKSPACE_ID`의 기본값은 `development`입니다.
- **Neon 파일**: Connect → Storage → Parameters only의 `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 저장합니다. `IEUM_STORAGE_PROVIDER=neon`, `IEUM_STORAGE_BUCKET` 기본값은 `ieum-attachments`, `IEUM_SESSION_SECRET`은 32자 이상의 임의 문자열입니다.
- **파일 CORS**: 저장소에서 현재 앱 주소(예: `https://on-ieum.vercel.app`), `PUT`, `GET`, `HEAD` 메서드와 `Content-Type` 요청 헤더를 허용합니다. 상세 설정은 [Neon 프로토타입 설정](./PROTOTYPE-NEON-SETUP.md)을 참고합니다.

## AI 모델 선택과 적용

1. **모델 목록 새로고침**으로 서버에 설정된 BizRouter 키의 사용 가능 모델을 확인합니다. 이 조회는 AI 답변을 생성하지 않습니다.
2. **AI 모델 선택**에서 모델을 고른 뒤 **모델 저장**을 누릅니다. 현재 키에 허용되고 JSON 구조화 응답을 지원하는 모델만 저장할 수 있습니다. 선택만 바꾸면 적용되지 않습니다.
3. **현재 적용 모델**과 설정 출처를 확인합니다. 저장한 모델은 다음 AI 업무등록·업무 설명 초안·절차 생성·웹 관리자 AI 연결 시험부터 적용됩니다. 이미 시작한 요청의 모델은 바꾸지 않습니다.
4. 실제 응답까지 확인하려면 **AI 연결·응답 테스트**를 실행합니다. 이 시험은 별도의 AI 호출이므로 소량의 사용량이 발생합니다.

우선순위는 **관리자 저장 모델 → 서버 환경변수 `BIZROUTER_MODEL`**입니다. **서버 기본값 복구**는 관리자 저장값을 지우고 환경변수의 모델을 사용합니다. 복구 후 서버 기본값도 없으면 AI 사용 전 모델을 다시 설정해야 합니다. 모델 저장·복구는 API 키를 변경하지 않습니다.

관리자 저장값은 `aiSettings.bizrouterModel`로 기존 워크스페이스 데이터에 보관합니다. Neon에서는 기존 워크스페이스 JSON에, 로컬 저장에서는 해당 로컬 데이터에 저장하므로 별도 SQL 마이그레이션은 필요하지 않습니다. 같은 워크스페이스를 사용하는 사용자에게 공통 적용됩니다.

선택 화면에는 `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`, `google/gemini-4-argon`을 후보로 안내합니다. 후보 표시 자체가 사용 가능하다는 뜻은 아닙니다. 현재 키의 모델 목록에서 찾을 수 없거나 JSON 구조화 응답을 지원하지 않으면 선택·저장을 제한하고 이유를 표시합니다. 목록 조회에 실패했다면 연결 상태와 키 권한을 확인한 뒤 다시 조회합니다.

2026-11-09 검증에서는 로컬에 설정된 기존 BizRouter 키로 모델 목록만 조회하여 위 네 모델의 목록 포함과 `json_schema` 지원을 확인했습니다. 당시 로컬 서버 기본값은 `openai/gpt-6.1-sol`입니다. 실제 AI 생성은 실행하지 않았고 업무 데이터도 전송하지 않았습니다. Vercel 운영 키가 같은지 또는 동일한 권한을 갖는지는 이 검사로 확인하지 않았으므로 운영 화면에서 모델 목록을 다시 확인합니다.

BizRouter의 모델 목록은 API 키의 모델 범위와 조직 정책을 반영합니다. 모델이 목록에 있어도 제공사의 실시간 가용성이나 모든 요청의 성공까지 보장하지 않습니다. JSON 구조화 응답 지원 정보도 실제 응답 검증을 대신하지 않습니다. [BizRouter 모델 목록 API](https://bizrouter.ai/docs/models), [Chat Completions API](https://bizrouter.ai/docs/chat-completions).

## Vercel에서 변경할 항목

| 변경 내용 | 필요한 작업 |
| --- | --- |
| 같은 BizRouter 키로 사용할 모델만 전환 | 관리자 화면에서 모델 저장. 환경변수 수정·재배포 불필요 |
| BizRouter 키 최초 등록·교체 | Vercel의 해당 환경에서 `BIZROUTER_API_KEY` 변경 후 재배포 |
| 서버 기본 모델 변경 | `BIZROUTER_MODEL` 변경 후 재배포. 관리자 저장값이 남아 있으면 그 값이 계속 우선하므로 서버 기본값 복구 필요 |
| 선택하려는 모델이 현재 키에 허용되지 않음 | BizRouter에서 조직 정책·해당 키의 모델 접근 범위를 확인한 뒤 모델 목록 다시 조회 |

OpenAI·Anthropic·Google 모델을 선택하더라도 앱은 같은 BizRouter 서비스 키로 호출합니다. 각 제공사의 API 키를 앱에 추가할 필요는 없습니다. API 키는 서버 환경변수에만 보관합니다. [BizRouter 인증](https://bizrouter.ai/docs/authentication).

Vercel 환경변수 변경은 이미 실행 중인 배포에 소급 적용되지 않습니다. Production 값을 바꿨다면 새 Production 배포에 반영해야 합니다. 관리자 화면의 모델 저장은 업무 저장소의 설정 변경이므로 이 재배포 절차와 별개입니다. [Vercel 환경변수 관리](https://vercel.com/docs/environment-variables/managing-environment-variables).

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

개발용 `npm run bizrouter:check`는 워크스페이스를 읽지 않고 가상 시험 자료만 사용하는 별도 검사입니다. 이 명령은 `.env.local`의 키와 `BIZROUTER_MODEL`을 시험하며 관리자 저장 모델을 적용하지 않습니다. 실제 AI 생성 호출과 사용량이 발생합니다. 관리자 저장 모델을 확인할 때는 웹 화면의 **AI 연결·응답 테스트**를 사용합니다.

## 회귀검증

```powershell
node --import tsx --test tests/admin-integrations.test.ts tests/ai-model-settings.test.ts tests/admin-ai-model-settings.test.ts tests/ai-model-selection-generation.test.ts
```

비밀값 비공개, 관리자·동일 출처 검사, 모델 저장·복구·동시 변경·재시도, 세 AI 생성 경로의 선택 모델 적용, AI 응답 검증, DB 롤백, 토큰 변조·소유자·기간 검사, 실제 로컬 업로드/다운로드/정리와 업무 데이터 불변을 검증합니다. 이 테스트는 실제 외부 AI·Neon 연결을 호출하지 않습니다.
