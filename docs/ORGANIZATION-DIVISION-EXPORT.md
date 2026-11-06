# 전체 업무분장표와 다운로드

모든 로그인 역할이 같은 전 부서 업무분장표를 조회합니다. 부서장·관리자의 기존 업무분장 관리 화면은 확정·재작성 등 관리 기능을 계속 제공합니다.

## 화면과 표시 기준

- 부서별로 담당자 → 단위업무 → 세부업무 → 업무대행자를 표시합니다. 업무 코드는 표시하지 않습니다.
- 부서·팀·담당자 이름으로 조회 조건을 설정할 수 있습니다. 이름은 원 담당자 이름을 검색합니다.
- 업무대행을 승인해도 원본 업무를 복제하지 않습니다. 원 담당자의 업무 행에 현재 유효한 대행자 이름이 추가됩니다.
- 대행 승인 대기·반려·종료·취소, 대행 시작 전·종료 후의 사람은 현재 업무대행자로 표시하지 않습니다.
- 삭제·보관된 세부업무, 삭제된 단위업무, 개인업무에 등록되지 않은 공통업무는 제외합니다.
- 업무 제목과 담당 관계만 공유합니다. 설명·절차·예산·성과·연락처·첨부파일·문서 내용은 이 조회 모델에 포함하지 않습니다. 전체 업무분장표 조회가 원본 업무 상세의 접근 권한을 추가하지 않습니다.

## Excel·PDF 내려받기

화면 위 **Excel 다운로드** 또는 **PDF 다운로드**를 누릅니다. 현재 선택한 부서·팀·이름 조건을 적용해 서버에서 최신 데이터로 파일을 생성합니다. 다운로드 도중에도 원본 업무 데이터는 변경하지 않습니다.

- Excel: 실제 `.xlsx` 파일이며 담당자·단위업무를 묶어 표시하고, 각 행의 내용을 문자열로 저장합니다.
- PDF: 한글 글꼴을 포함한 가로 A4 문서입니다. 부서별 구분, 반복되는 표 머리글, 긴 제목의 여러 페이지 이어쓰기를 지원합니다.
- 새 인증 변수나 외부 문서 변환 서비스는 필요하지 않습니다. 기존 로그인과 DB 연결을 사용합니다.

## 구현 경로

| 역할 | 파일 |
| --- | --- |
| 전 역할이 공유하는 최소 조회 모델 | `src/lib/organization-division.ts` |
| 화면과 조회 조건 | `src/components/organization-division.tsx` |
| 파일 생성 | `src/lib/organization-division-export.ts` |
| 인증된 실제 파일 다운로드 | `GET /api/organization-division/export` |

다운로드 API의 매개변수는 `format=xlsx|pdf`, `departmentId`, `team`, `name`입니다. 부서·팀의 `all`은 전체를 뜻합니다. 로그인하지 않으면 401, 잘못된 형식·부서·100자를 넘는 검색 조건에는 422를 반환합니다. 응답에는 첨부파일 이름, MIME 유형과 `no-store, private` 캐시 정책이 설정됩니다.

Vercel의 Node 런타임에서 `exceljs`, `pdfkit`으로 생성합니다. `next.config.ts`의 외부 서버 패키지 설정과 `public/fonts/Pretendard-Regular.otf`의 파일 추적 포함 설정을 유지해야 합니다.

## PDF 글꼴

정적 `Pretendard-Regular.otf`를 [Pretendard 공식 저장소](https://github.com/orioncactus/pretendard/tree/main/packages/pretendard/dist/public/static)에서 가져왔습니다. 라이선스는 `public/fonts/OFL.txt`에 있습니다. 시스템에 설치된 글꼴이나 외부 폰트 서버에 의존하지 않습니다. 앱용 가변 WOFF2 글꼴은 PDF 부분 임베딩에서 오류가 재현되어 PDF에는 정적 OTF를 사용합니다.

## 검증

```powershell
node --import tsx --test tests/organization-division.test.ts tests/organization-division-export.test.ts
```

모든 역할의 동일 조회 내용, 민감한 본문·코드 제외, 승인된 현재 대행자만 표시, 업무 중복 방지, 필터 일치, 실제 Excel 형식, 한국어 PDF와 긴 제목의 페이지 나눔, 다운로드 API 인증·첨부 응답을 검증합니다. API 테스트는 `.qa-data`의 임시 저장소에서 실행하며 실제 Neon DB를 사용하지 않습니다.
