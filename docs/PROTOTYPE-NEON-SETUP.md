# 온이음 프로토타입 · Neon DB와 파일 저장소 설정

앱 설정·점검 기준일: 2026-11-05. 이 프로젝트는 기능을 확인하는 프로토타입입니다. 현재 PC와 Vercel의 앱이 Neon DB와 Object Storage를 사용하도록 구성합니다. 기존 가상 계정 선택과 역할 전환을 계속 사용하며, 실제 기관 로그인이나 SSO를 준비할 필요는 없습니다.

현재 PC의 설정은 **`D:\Workflow-Project\.env.local`**에서 관리합니다. 이 파일은 Git에서 제외됩니다. `.env.example`은 변수 이름을 보여 주는 빈 예시이며 실제 연결값을 넣는 파일이 아닙니다. 이미 있는 `.env.local`을 열어 필요한 줄만 수정하고 기존 BizRouter 값을 유지하세요. Vercel에서 실행하는 앱은 **Vercel 프로젝트 → Settings → Environment Variables**의 값을 사용합니다. 두 설정은 자동으로 동기화되지 않습니다.

| 항목 | 저장 위치 |
| --- | --- |
| 조직·계정·업무·절차·일정·성과·평가·감사 기록 | Neon Postgres의 `ieum_workspaces` 테이블 |
| 첨부파일 이름·크기·업무 연결 등 정보 | 같은 DB의 워크스페이스 데이터 |
| 실제 PDF·문서·이미지 파일 내용 | 같은 Neon 프로젝트/브랜치의 Object Storage 버킷 |
| 화면과 서버 실행 | 현재 PC 또는 Vercel |

로컬 파일 모드에서 쓰던 테스트 데이터는 `.data/workspace.json`입니다. `DATABASE_URL`을 설정한 현재 앱은 Neon의 워크스페이스 행을 사용하므로 이후 변경은 이 로컬 파일에 자동 복사되지 않습니다. `.qa`와 `.qa-data`는 자동 검증용이며 업무 목록에 합치지 않습니다. 이관은 처음 연결할 때 기존 로컬 기록을 보존해 옮기는 작업입니다. 이미 Neon을 사용 중이라면 아래의 연결 점검만 실행하고 오래된 로컬 파일을 다시 이관하지 마세요.

2026-11-05 연결 확인 결과, Neon DB의 `development` 워크스페이스는 리비전 29이며 사용자 33명·부서 3개·단위업무 18개·세부업무 24개·회차 18개를 읽었습니다. 첨부파일 메타데이터는 0개였습니다. 저장소 접근과 `https://on-ieum.vercel.app`의 CORS 사전 요청, 임시 파일의 서명 업로드·서버 읽기·서명 다운로드와 다운로드 헤더 확인을 통과했고 임시 객체는 삭제했습니다. 기존 워크스페이스는 변경하지 않았습니다. 이는 점검 시점의 결과이며, 기존 첨부파일 전체의 무결성을 검증했다는 뜻은 아닙니다.

## 0. 이미 Vercel에 DB를 설정했다면

Vercel에서 해당 프로젝트를 열고 **Settings → Environment Variables**의 `DATABASE_URL`을 확인합니다. 연동 과정에서 `POSTGRES_URL` 등 다른 이름으로 추가되었더라도 이 앱이 읽는 이름은 **`DATABASE_URL`**입니다. 같은 Neon 연결 문자열을 그 이름으로 설정합니다.

읽을 수 있는 값이면 현재 PC의 `.env.local`에도 복사합니다. Vercel의 **Secret** 유형은 저장 후 다시 읽을 수 없으므로 아래 Neon **Connect** 화면에서 같은 DB의 연결 문자열을 가져오면 됩니다. 값을 보기 위해 기존 Vercel 변수를 삭제할 필요는 없습니다. [Vercel Config·Secret 구분](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types)

## 1. DB 연결값 확인

1. [Neon Console](https://console.neon.tech/)에 로그인하고 이미 만든 프로젝트를 선택합니다.
2. 사용할 브랜치를 선택합니다. DB와 Object Storage 모두 **같은 브랜치**를 사용합니다.
3. 왼쪽 위 **Connect**를 누르고 DB 연결 화면에서 브랜치, Compute, Database, Role을 확인합니다.
4. **Connection string**의 `postgresql://`로 시작하는 전체 주소를 복사합니다. `psql` 명령어 자체나 바깥따옴표는 복사하지 않습니다. 비밀번호와 `?sslmode=...` 부분도 주소에 포함됩니다.
5. `.env.local`의 `DATABASE_URL=` 뒤에 붙여 넣습니다. 기본으로 제공하는 pooled 연결 주소를 사용할 수 있습니다. [Neon DB 연결 공식 안내](https://neon.com/docs/connect/connect-from-any-app)

```dotenv
DATABASE_URL="Neon Connect 화면에서 복사한 postgresql:// 연결 문자열"
IEUM_WORKSPACE_ID=development
```

`IEUM_WORKSPACE_ID`는 Neon 프로젝트 이름이나 브랜치 ID가 아닙니다. 앱이 `ieum_workspaces` 테이블에서 읽을 행의 ID입니다. 이관과 앱 실행에 같은 값을 사용해야 하며, 현재 기본값인 `development`를 유지하면 됩니다.

## 2. 파일 버킷 만들기

Neon Object Storage는 별도의 AWS 계정 없이 사용할 수 있습니다. 변수 이름이 `AWS_`로 시작하는 이유는 S3 호환 API를 사용하기 때문입니다. [Neon 저장소 인증 안내](https://neon.com/docs/storage/authentication)

2026-11-01 공식 문서 기준 지원 리전은 Ohio(`aws-us-east-2`), N. Virginia(`aws-us-east-1`), Frankfurt(`aws-eu-central-1`), Singapore(`aws-ap-southeast-1`)입니다. 프로젝트에 **Object storage**가 보이지 않으면 해당 프로젝트의 리전을 먼저 확인합니다. 기존 DB를 삭제할 필요는 없으며, 지원 리전에서 사용할 프로젝트를 정한 뒤 그 프로젝트의 DB와 저장소를 함께 설정하면 됩니다. [Neon Object Storage 지원 범위](https://neon.com/docs/storage/overview)

1. Neon Console에서 DB에 사용한 프로젝트와 브랜치를 선택합니다.
2. **Object storage → New bucket**으로 이동합니다.
3. 이름을 **`ieum-attachments`**, 접근 방식을 **Private**로 지정하고 **Create**를 누릅니다.
4. `.env.local`에 아래 두 줄을 추가합니다. 이미 같은 이름의 변수가 있다면 해당 줄만 수정합니다. [버킷 생성 공식 안내](https://neon.com/docs/storage/buckets)

```dotenv
IEUM_STORAGE_PROVIDER=neon
IEUM_STORAGE_BUCKET=ieum-attachments
```

다른 버킷 이름을 사용했다면 `IEUM_STORAGE_BUCKET`에 실제 이름을 정확히 입력합니다. 버킷 주소 전체가 아니라 이름만 넣습니다.

## 3. 파일 저장소 연결값 확인

1. 같은 프로젝트/브랜치에서 왼쪽 위 **Connect**를 누릅니다.
2. **Storage** 탭을 엽니다.
3. 클라이언트 선택에서 **Parameters only**를 고릅니다.
4. **Reveal credential**을 눌러 숨겨진 값을 표시한 뒤 **Copy credentials**로 연결값을 복사합니다.
5. 아래 네 변수만 `.env.local`에 추가하거나 같은 이름의 기존 줄을 수정합니다. [Neon Console의 저장소 연결값 안내](https://neon.com/docs/storage/authentication)

| `.env.local` 변수 | Neon에서 가져오는 값 | 확인할 점 |
| --- | --- | --- |
| `AWS_ENDPOINT_URL_S3` | Storage 연결 화면의 endpoint | `https://br-...storage...neon.tech` 전체 주소. DB의 `ep-...` 호스트를 넣지 않음 |
| `AWS_REGION` | Storage 연결 화면의 region | 예: `ap-southeast-1`. 프로젝트 표시용 `aws-` 접두사를 붙이지 않음 |
| `AWS_ACCESS_KEY_ID` | Access Key ID, API 응답에서는 `token_id` | 일반 Neon 관리 API 키나 DB 비밀번호가 아님 |
| `AWS_SECRET_ACCESS_KEY` | Secret Access Key, API 응답에서는 `s3_secret_access_key` | `api_token`과 다름. 전체 값을 사용 |

별도 자격증명을 만들려면 **프로젝트 Settings → Credentials → Create credential**에서 이름을 정하고 `storage:read`, `storage:write`를 선택합니다. 생성한 값은 해당 브랜치에 연결됩니다. 연결 화면의 기본 자격증명을 사용한다면 별도 발급 과정은 필요하지 않습니다.

앱은 서버가 발급한 임시 업로드 URL을 사용해 브라우저에서 Neon으로 파일을 직접 전송합니다. 따라서 **버킷 CORS에 앱 주소를 허용**해야 합니다. `forcePathStyle`과 서명 URL 생성은 코드가 처리하며, 저장소 비밀키를 브라우저에 넣지 않습니다. Neon은 `PutBucketCors`와 브라우저 preflight를 지원합니다. [S3 호환 규칙](https://neon.com/docs/storage/s3-compatibility)

## 4. `.env.local` 최종 모양

아래의 설명 문구는 실제 값으로 바꿉니다. 이미 설정한 `BIZROUTER_API_KEY`, `BIZROUTER_MODEL`은 그대로 유지합니다.

```dotenv
# DB: Neon → Connect → DB 연결 화면
DATABASE_URL="복사한 postgresql:// 연결 문자열"
IEUM_WORKSPACE_ID=development
IEUM_PROTOTYPE_MODE=true
IEUM_SESSION_SECRET="직접 생성한 32자 이상의 임의 문자열"

# 첨부파일: Neon → Object storage에서 만든 버킷
IEUM_STORAGE_PROVIDER=neon
IEUM_STORAGE_BUCKET=ieum-attachments

# Neon → Connect → Storage → Parameters only
AWS_ENDPOINT_URL_S3="복사한 https:// 저장소 endpoint"
AWS_REGION="복사한 region"
AWS_ACCESS_KEY_ID="복사한 Access Key ID"
AWS_SECRET_ACCESS_KEY="복사한 Secret Access Key"

# 기존 설정 유지
BIZROUTER_API_KEY="이미 설정한 서비스 API 키"
BIZROUTER_MODEL="이미 설정한 모델 ID"

# 기관 인증은 사용하지 않음
NEON_AUTH_BASE_URL=
NEON_AUTH_USER_MAP=
# 로컬 실행에서는 아래 두 값을 비워 둠
IEUM_APP_ORIGIN=
IEUM_DATA_DIR=
IEUM_ALLOW_DEMO_SEED=false
```

같은 변수를 파일에 여러 번 적지 않습니다. `NEXT_PUBLIC_` 접두사도 붙이지 않습니다. `.env.local.txt`가 아니라 확장자 없는 `.env.local`인지 확인합니다. 환경변수를 바꾼 뒤에는 실행 중인 서버를 다시 시작해야 합니다.

`IEUM_PROTOTYPE_MODE=true`는 Vercel에서도 가상 계정을 선택할 수 있도록 하는 앱 설정입니다. 로컬의 일반 역할 선택은 기존대로 동작합니다. `IEUM_SESSION_SECRET`은 세션과 파일 업로드 확인에 사용하는 앱 자체 비밀값이며 Neon에서 발급받는 값이 아닙니다. **현재 `.env.local`에 이미 충분히 긴 값이 있으면 그대로 사용하고 Vercel에도 그 값을 넣습니다.** 값이 없을 때만 아래 명령으로 한 번 생성합니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`NEON_AUTH_BASE_URL`과 `NEON_AUTH_USER_MAP`은 비워 둡니다. DB와 저장소를 쓰기 위해 Neon Auth를 설정할 필요는 없습니다. `IEUM_DATA_DIR`은 로컬 파일 위치를 바꾸는 변수이며 Neon 주소를 입력하는 곳이 아닙니다.

### 브라우저 파일 업로드 허용 주소 설정

현재 Vercel 앱 주소는 **https://on-ieum.vercel.app**입니다. 이 주소의 CORS·파일 연결 시험은 2026-11-05 통과했습니다. 다른 주소를 추가하거나 CORS 설정을 바꿀 때 PowerShell에서 아래 명령을 실행합니다. 기존 설정을 바꾸지 않고 확인만 하려면 다음 절의 `neon:files:check`를 사용합니다. 주소 마지막에 경로나 `/`를 붙이지 않습니다.

```powershell
cd D:\Workflow-Project
npm run neon:storage:setup -- --origin https://on-ieum.vercel.app --test
```

이 명령은 버킷이 없으면 생성하고, 브라우저 업로드를 위한 CORS를 설정합니다. 기존 파일과 다른 CORS 규칙은 유지하며, 아래 주소를 허용 목록에 포함합니다.

- 로컬 기본 주소 `http://127.0.0.1:3000`, `http://localhost:3000`
- `--origin`으로 지정한 앱 주소
- `.env.local`의 `IEUM_APP_ORIGIN`이 설정되어 있다면 그 주소

`--test`는 작은 임시 파일을 업로드하고 읽어 비교한 후 삭제하는 연결 확인입니다. 기존 첨부파일을 지우지 않습니다. 성공하면 `storage: configured`와 `objectTest: upload-read-delete-passed`가 표시됩니다.

앱 주소가 둘 이상이면 `--origin`을 반복해서 넣습니다. 기존에 등록한 주소도 유지됩니다. 로컬에서만 시험하려면 `npm run neon:storage:setup -- --test`로 실행합니다. Vercel 주소가 바뀌거나 새 Preview 주소를 쓰면 새 주소로 이 명령을 다시 실행합니다. 이 설정은 Neon 버킷에 한 번 저장되므로 Vercel 배포마다 같은 명령을 실행할 필요는 없습니다.

## 5. 연결 점검과 처음 한 번의 데이터 이관

### 이미 Neon에 연결했다면: 점검만 실행

PowerShell에서 다음 명령을 실행합니다. 프로젝트의 `.env.local`을 읽으며 비밀값과 서명 URL은 출력하지 않습니다. 이 명령들은 워크스페이스 데이터와 기존 첨부파일을 바꾸지 않습니다.

```powershell
cd D:\Workflow-Project
npm run neon:check
npm run neon:files:check -- --origin https://on-ieum.vercel.app
```

| 점검 | 확인 범위와 결과 읽기 |
| --- | --- |
| `neon:check` | 설정값 유무, DB 접속·테이블·워크스페이스 행·리비전과 데이터 건수, 버킷 접근, CORS 규칙 건수 확인. `database: connected`, `workspace: ready`인지 확인 |
| `neon:files:check -- --origin ...` | 지정한 앱 주소의 실제 CORS 사전 요청, 서명 URL로 임시 파일 업로드, 서버 읽기와 바이트 비교, 서명 다운로드와 다운로드 헤더 확인. 성공 후 만든 임시 객체만 삭제 |

`neon:check`의 `objectWrites: not-tested`는 오류가 아니라 그 명령이 파일을 쓰지 않는다는 뜻입니다. CORS 규칙이 1개 있다는 사실만으로 실제 앱 주소의 업로드 허용을 확인할 수는 없으므로 파일 시험을 별도로 실행합니다. 파일 시험의 `cors`·`signedUpload`·`signedDownload`가 `passed`, `storedBytes`가 `matched`, `temporaryObject`가 `removed`인지 확인하세요. 실패 시 출력된 `stage`로 CORS·업로드·읽기·다운로드 중 어느 단계가 막혔는지 구분합니다. `cleanup-failed`가 나오면 그 시험이 출력한 임시 객체 키만 확인해 정리합니다.

이 검사는 Neon 연결을 확인합니다. `BIZROUTER_API_KEY`와 `BIZROUTER_MODEL`이 설정되어 있다는 표시만으로 AI 호출 성공을 검증하지 않으며, AI는 8절의 화면 절차로 따로 확인합니다. 실제 첨부 연결·사용자 권한·파일 검사 상태도 앱에서 확인해야 합니다.

### 아직 로컬 데이터만 있다면: 최초 이관

DB에 현재 업무가 아직 없는 경우에만 아래 순서로 실행합니다. 먼저 이관 대상과 로컬 데이터가 맞는지 점검합니다.

```powershell
npm run neon:import
npm run neon:import:apply
```

| 명령 | 하는 일 |
| --- | --- |
| `neon:import` | 현재 로컬 데이터와 이관 대상 확인. 실제 이관 전 점검 |
| `neon:import:apply` | 현재 로컬 데이터를 지정된 워크스페이스 ID로 저장하고 연결된 파일 이관 |

`scripts/setup-neon.ts`는 새로운 가상 예시를 만드는 이전 명령이므로 현재 데이터를 옮길 때 사용하지 않습니다. 이미 DB에 다른 기록이 있으면 이관 명령이 이를 그대로 덮어쓰지 않습니다. **현재 Neon의 최신 업무를 로컬 파일의 내용으로 교체하려는 경우에만** 대상과 내용을 확인한 후 아래 명령을 사용합니다. 명령은 기존 DB의 해당 기록을 별도 보존한 다음 교체하지만, 오래된 로컬 파일로 최신 업무를 대체하는 결과는 같습니다. 일반 연결 점검에는 사용하지 않습니다.

```powershell
npm run neon:import:apply -- --replace
```

Neon의 **SQL Editor**에서 같은 브랜치와 DB를 선택하고 다음 조회로 결과를 확인할 수 있습니다. 이 SQL은 데이터를 변경하지 않습니다.

```sql
SELECT
  id,
  revision,
  jsonb_array_length(data->'users') AS users,
  jsonb_array_length(data->'units') AS units,
  jsonb_array_length(data->'tasks') AS tasks,
  jsonb_array_length(data->'runs') AS runs,
  jsonb_array_length(data->'attachments') AS attachments
FROM ieum_workspaces
WHERE id = 'development';
```

## 6. Vercel에도 같은 값을 적용

1. Vercel에서 이 프로젝트를 선택합니다.
2. **Settings → Environment Variables → Add Environment Variable**로 들어갑니다.
3. 아래 표의 값을 설정합니다. 기존 DB와 BizRouter 설정은 같은 이름으로 중복 추가하지 말고 기존 항목을 확인합니다.
4. 현재 사용할 배포가 `main`이면 **Production**, 다른 브랜치의 미리보기면 **Preview**에 적용합니다. **Development**는 로컬 개발 도구용 범위입니다.
5. 저장 후 **Deployments**에서 새 배포를 실행하거나 기존 배포의 **Redeploy**를 실행합니다. 환경변수 변경은 이전 배포에 소급 적용되지 않습니다. [Vercel 환경변수 설정](https://vercel.com/academy/vercel-foundations/vercel-settings), [환경별 적용 범위](https://vercel.com/docs/environment-variables)

| Vercel 변수 | 입력할 값 |
| --- | --- |
| `DATABASE_URL` | 로컬 이관에 사용한 동일 DB 연결 문자열 |
| `IEUM_WORKSPACE_ID` | `development` |
| `IEUM_PROTOTYPE_MODE` | `true` |
| `IEUM_SESSION_SECRET` | 위에서 만든 임의 문자열 |
| `IEUM_APP_ORIGIN` | `https://on-ieum.vercel.app` |
| `IEUM_STORAGE_PROVIDER` | `neon` |
| `IEUM_STORAGE_BUCKET` | `ieum-attachments` 또는 실제 버킷 이름 |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | Neon Connect의 Storage 값 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | 같은 Storage 자격증명 |
| `BIZROUTER_API_KEY`, `BIZROUTER_MODEL` | 기존 BizRouter 설정 유지 |

`NEON_AUTH_BASE_URL`, `NEON_AUTH_USER_MAP`, `IEUM_DATA_DIR`은 추가하지 않습니다. Preview에도 시험할 경우 그 주소에 맞는 `IEUM_APP_ORIGIN`과 버킷 CORS가 필요합니다. 프로토타입 모드에서는 접속자가 가상 계정과 역할을 선택할 수 있습니다.

## 7. BizRouter 값은 어디에서 확인하나요?

- **API 키:** BizRouter 로그인 → **설정 → API 연동 → 서비스 API 키 → 새 API 키 생성**. 생성 직후 표시되는 전체 키를 `BIZROUTER_API_KEY`에 넣습니다. 기존에 설정한 키가 있다면 다시 만들 필요는 없습니다. 사용량 조회 전용 키는 모델 호출용 키와 다릅니다. [BizRouter 인증 안내](https://bizrouter.ai/docs/authentication)
- **모델:** 모델 카탈로그의 구체적인 모델 ID를 `BIZROUTER_MODEL`에 넣습니다. 앱은 `/v1/models`에서 해당 키에 허용되고 `json_schema` 응답을 지원하는지 확인합니다. 화면용 모델 이름과 API ID를 구분합니다. [BizRouter 모델 목록](https://bizrouter.ai/docs/models)

## 8. 연결 후 화면에서 확인

BizRouter 연결과 실제 분석은 `npm run bizrouter:check`로 별도 확인할 수 있습니다. 가상 근거 3개를 실제 API로 보내므로 사용량이 발생하며, 실제 DB와 업무 데이터는 변경하지 않습니다. 모델 목록·요약·절차 생성 문제의 점검 결과는 [BizRouter 분석 QA](QA-bizrouter-analysis.md)를 참고하세요. 기존 키·모델 설정을 그대로 사용합니다.

1. `http://127.0.0.1:3000` 또는 Vercel의 앱 주소에 접속해 기존 시연 계정으로 로그인합니다.
2. 기존 단위업무·세부업무·일정·성과·월별 실적이 보이는지 확인합니다.
3. 현재 주담당자·지원담당자 계정으로 업무를 엽니다. 기준을 작성할 때에는 **업무 기준 수정 → 관련 근거**에서 작은 TXT 또는 PDF 파일을 올립니다. 확정 후 생산 문서를 추가할 때에는 **수행 기록 입력 → 관련 근거**에서 유형이 생산 문서인 자료에 연결합니다. 관리자라는 이유만으로 모든 업무에 파일을 올릴 수 있는 것은 아닙니다.
4. 파일 교체 시 새로 가져온 본문과 추출 경고를 확인하고 사용할 본문을 선택합니다. 기존 본문은 새 파일과 일치한다는 확인 후 유지할 수 있습니다. 읽을 수 없는 파일의 새 본문을 선택하면 기존 본문을 비우므로 필요한 내용을 직접 입력합니다. 스캔 PDF·앞 10,000자 제한 등 누락 가능성도 확인합니다.
5. 작성 모드에 맞게 **변경사항 저장** 또는 **수행 기록 저장**을 누릅니다. 파일 업로드만으로 해당 업무의 근거 연결 저장까지 끝나는 것은 아닙니다. 수행 기록 변경 이력에서는 기록자·시각과 문서·집행내역의 변경 전후를 확인할 수 있습니다.
6. Neon의 같은 브랜치 **Object storage → ieum-attachments**에서 파일 객체가 생겼는지 확인합니다. 내부 저장 이름은 사용자 파일명과 다를 수 있습니다.
7. 다운로드를 확인하려면 관리자 역할로 같은 업무를 열고 파일 옆 **테스트 파일 허용**을 누릅니다. 이후 다운로드 버튼으로 파일을 받을 수 있습니다. 이 버튼은 프로토타입의 파일 출처 확인 기능입니다.
8. AI는 업무 기준을 수정할 수 있는 상태에서 저장된 본문이 있는 관련 근거를 선택해 **AI 근거 요약·절차 만들기**를 실행합니다. 종합 요약·근거별 요약과 인용·담당 역할·순서를 검토한 뒤 초안을 적용하고 변경사항을 저장합니다. 확정된 업무 기준을 바꾸려면 먼저 부서장의 재작성 허용이 필요합니다.
9. 새로고침하거나 앱을 다시 시작한 뒤 업무와 파일 연결이 유지되는지 확인합니다.

다운로드 버튼은 현재 업무 권한을 확인한 뒤 60초 동안 유효한 Neon 파일 주소로 이동합니다. 기존 로컬 첨부파일도 계속 읽을 수 있습니다.

### 업무 흐름 확인 시 구분할 내용

| 기능 | 현재 동작 |
| --- | --- |
| 확정 후 기록 | 일정·수행 결과·성과와 생산 문서·집행내역을 기록할 수 있음. 법령·지침·절차·예산 총액 등 기준 변경은 재작성 허용 필요 |
| 공통업무 접수 | 확정된 부서에도 새 업무 접수 가능. 팀·개인 배정과 내 단위업무 등록은 재작성 허용 후 진행 |
| 공통업무 기한 | 중앙 제출기한과 내부 회차 종료일을 구분. 내부 일정 변경으로 중앙 기한이나 해당 회차의 보고기간이 바뀌지 않음 |
| 인계 전 본인 성과 | 현재 업무 접근권을 잃어도 성과 · 평가에서 기존 본인 성과 수정·보완 가능. 제출 상태면 평가 확정 전 회수 필요 |
| 인수인계 대기 | 새 요청은 체크·메모·회차 일정·수행 기록을 계속 입력해도 승인 가능. 업무 기준·배정 대상 변경은 취소 후 재요청 필요 |

위 흐름의 자세한 절차는 앱의 **사용 안내**와 [인수인계 안내](HANDOVER.md)를 참고합니다. 한 반기에 여러 부서의 성과를 분리 제출·평가하는 기능 등 후속 범위는 [단계별 개선 계획](IMPROVEMENT-ROADMAP.md)에서 구분합니다.

## 9. 자주 막히는 부분

| 증상 | 확인할 내용 |
| --- | --- |
| DB를 만들었는데 앱이 계속 로컬 데이터를 사용함 | 현재 PC의 `.env.local`에 `DATABASE_URL`이 들어 있는지, 서버를 다시 시작했는지 확인. Neon Console에 프로젝트를 만든 것만으로 로컬 설정이 바뀌지는 않음 |
| `DATABASE_NOT_INITIALIZED` | DB 테이블뿐 아니라 `IEUM_WORKSPACE_ID`와 같은 ID의 데이터 행이 있어야 함. 현재 데이터 이관 절차 실행 필요 |
| 이관 후 기존 업무가 보이지 않음 | 앱과 이관 명령이 같은 `.env.local`, DB, `IEUM_WORKSPACE_ID`를 사용했는지 확인 |
| 파일이 여전히 로컬에 저장됨 | `IEUM_STORAGE_PROVIDER=neon` 및 저장소 변수 5개 확인 후 서버 재시작 |
| `NoSuchBucket` | DB와 같은 브랜치의 버킷이 있는지, `IEUM_STORAGE_BUCKET` 이름이 일치하는지 확인 |
| `InvalidAccessKeyId` | Access Key ID에 `token_id` 전체 값을 넣었는지 확인 |
| `SignatureDoesNotMatch` | Secret Access Key에 `s3_secret_access_key`를 넣었는지 확인. `api_token`으로 대체하지 않음 |
| `AccessDenied` | 저장소 자격증명에 쓰기 권한이 있는지, endpoint가 같은 브랜치인지 확인 |
| Vercel 시연 계정 선택이 막힘 | `IEUM_PROTOTYPE_MODE=true`, 32자 이상 `IEUM_SESSION_SECRET`, 정확한 `IEUM_APP_ORIGIN` 확인. 기관 인증 변수는 비워 두고 Redeploy |
| 브라우저에서 파일 전송만 실패함 | 버킷 CORS에 실제 앱의 origin이 허용되어 있는지 확인. DB 연결 성공과 파일 CORS는 별개 |
| `neon:check`에서 `objectWrites: not-tested` | 읽기 위주 연결 점검의 정상 표시. `neon:files:check -- --origin https://on-ieum.vercel.app`으로 임시 파일 시험을 별도 실행 |
| 업로드했는데 새로고침 후 근거 연결이 없음 | 파일 선택·본문 확인 후 변경사항 저장 또는 수행 기록 저장까지 완료했는지 확인 |
| 업무분장 확정 후 문서·집행을 추가할 수 없음 | 현재 주담당자·지원담당자로 수행 기록 입력 사용. 법령·지침·예산 총액은 이 모드에서 수정하지 않음 |
| 새 파일에 이전 본문이 연결될까 걱정됨 | 파일 교체 확인에서 새 본문 선택. 기존 본문은 새 파일과 일치함을 직접 확인한 경우에만 유지 |
| AI 설정 오류 | BizRouter 서비스 API 키와 정확한 모델 ID 확인. 저장된 근거 본문이 있어야 분석 가능 |

저장소 오류의 필드 대응은 [Neon 문제 해결 문서](https://neon.com/docs/storage/troubleshooting)에서 확인할 수 있습니다. 연결 비밀값은 채팅이나 GitHub에 붙여 넣지 않고 `.env.local`에서 직접 설정합니다.
