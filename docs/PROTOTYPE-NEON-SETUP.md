# 온이음 프로토타입 · Neon DB와 파일 저장소 설정

기준일: 2026-11-01. 이 프로젝트는 기능을 확인하는 프로토타입입니다. 현재 PC와 Vercel의 앱이 Neon DB와 Object Storage를 사용하도록 구성합니다. 기존 가상 계정 선택과 역할 전환을 계속 사용하며, 실제 기관 로그인이나 SSO를 준비할 필요는 없습니다.

현재 PC의 설정은 **`D:\Workflow-Project\.env.local`**에서 관리합니다. 이 파일은 Git에서 제외됩니다. `.env.example`은 변수 이름을 보여 주는 빈 예시이며 실제 연결값을 넣는 파일이 아닙니다. 이미 있는 `.env.local`을 열어 필요한 줄만 수정하고 기존 BizRouter 값을 유지하세요. Vercel에서 실행하는 앱은 **Vercel 프로젝트 → Settings → Environment Variables**의 값을 사용합니다. 두 설정은 자동으로 동기화되지 않습니다.

| 항목 | 저장 위치 |
| --- | --- |
| 조직·계정·업무·절차·일정·성과·평가·감사 기록 | Neon Postgres의 `ieum_workspaces` 테이블 |
| 첨부파일 이름·크기·업무 연결 등 정보 | 같은 DB의 워크스페이스 데이터 |
| 실제 PDF·문서·이미지 파일 내용 | 같은 Neon 프로젝트/브랜치의 Object Storage 버킷 |
| 화면과 서버 실행 | 현재 PC 또는 Vercel |

현재 앱의 전체 테스트 데이터는 `.data/workspace.json`입니다. `.qa`와 `.qa-data`는 자동 검증을 위해 따로 만든 데이터이므로 현재 업무 목록에 합치지 않습니다. 이관은 가상 데이터를 새로 만드는 작업이 아니라 현재 파일의 기록을 보존해 옮기는 작업입니다.

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

현재 Vercel 앱 주소는 **https://on-ieum.vercel.app**입니다. 이 주소와 로컬 주소의 CORS 설정을 완료했습니다. 다른 주소를 추가하거나 다시 확인할 때 PowerShell에서 아래 명령을 실행합니다. 주소 마지막에 경로나 `/`를 붙이지 않습니다.

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

## 5. 현재 테스트 데이터를 DB로 이관

PowerShell에서 프로젝트 폴더로 이동하고 다음 순서로 실행합니다. 명령은 프로젝트의 `.env.local`을 읽습니다.

```powershell
cd D:\Workflow-Project
npm run neon:check
npm run neon:import
npm run neon:import:apply
```

| 명령 | 하는 일 |
| --- | --- |
| `neon:check` | 설정값 유무, DB 연결과 파일 버킷 접근 확인 |
| `neon:import` | 현재 로컬 데이터와 이관 대상 확인. 실제 이관 전 점검 |
| `neon:import:apply` | 현재 로컬 데이터를 지정된 워크스페이스 ID로 저장하고 연결된 파일 이관 |

`scripts/setup-neon.ts`는 새로운 가상 예시를 만드는 이전 명령이므로 현재 데이터를 옮길 때 사용하지 않습니다. 이미 DB에 다른 기록이 있으면 이관 명령이 이를 그대로 덮어쓰지 않습니다. 로컬 기록으로 교체하려는 경우에만 대상과 내용을 확인한 후 아래 명령을 사용합니다. 기존 DB의 해당 기록을 별도 보존한 다음 교체합니다.

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

1. `http://127.0.0.1:3000` 또는 Vercel의 앱 주소에 접속해 기존 시연 계정으로 로그인합니다.
2. 기존 단위업무·세부업무·일정·성과·월별 실적이 보이는지 확인합니다.
3. 업무의 **관련 근거**에서 작은 TXT 또는 PDF 파일을 올리고 **변경사항 저장**을 누릅니다.
4. Neon의 같은 브랜치 **Object storage → ieum-attachments**에서 파일 객체가 생겼는지 확인합니다. 내부 저장 이름은 사용자 파일명과 다를 수 있습니다.
5. 다운로드를 확인하려면 관리자 역할로 같은 업무를 열고 파일 옆 **테스트 파일 허용**을 누릅니다. 이후 다운로드 버튼으로 파일을 받을 수 있습니다. 이 버튼은 프로토타입의 파일 출처 확인 기능입니다.
6. 본문이 있는 관련 근거를 선택해 AI 절차 초안을 생성합니다.
7. 새로고침하거나 앱을 다시 시작한 뒤 업무와 파일 연결이 유지되는지 확인합니다.

다운로드 버튼은 현재 업무 권한을 확인한 뒤 60초 동안 유효한 Neon 파일 주소로 이동합니다. 기존 로컬 첨부파일도 계속 읽을 수 있습니다.

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
| AI 설정 오류 | BizRouter 서비스 API 키와 정확한 모델 ID 확인. 저장된 근거 본문이 있어야 분석 가능 |

저장소 오류의 필드 대응은 [Neon 문제 해결 문서](https://neon.com/docs/storage/troubleshooting)에서 확인할 수 있습니다. 연결 비밀값은 채팅이나 GitHub에 붙여 넣지 않고 `.env.local`에서 직접 설정합니다.
