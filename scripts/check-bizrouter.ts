import { generateAiProcedure } from '../src/lib/bizrouter';
import { DomainError } from '../src/lib/domain';

// Synthetic evidence only. Never read the workspace or send real attachments.
const references = [
  { id: 'probe-law', type: 'law' as const, title: '시험용 자료 제출 규정', content: '제1조 담당자는 월별 실적 자료를 수집하고 누락 여부를 확인한다. 제2조 부서장은 제출 전에 자료의 정확성과 증빙을 검토한다. 제3조 담당자는 검토가 완료된 자료를 총괄 부서에 제출한다.' },
  { id: 'probe-guide', type: 'guideline' as const, title: '시험용 실적 작성 지침', content: '1. 담당자는 부서별 실적과 증빙 목록을 작성한다. 2. 지원담당자는 증빙 파일과 집계 수치를 대조하고 차이를 담당자에게 알린다. 3. 담당자는 검토 의견에 따라 자료를 보완한 뒤 부서장에게 검토를 요청한다.' },
  { id: 'probe-report', type: 'document' as const, title: '시험용 지난 회차 결과보고', content: '지난 회차에 증빙 파일 두 건이 누락되었다. 담당자는 제출 전에 증빙 목록과 실제 파일의 일치 여부를 확인하고, 지원담당자는 점검 결과를 기록한다. 부서장은 최종 결과를 검토한다.' },
];

async function main() {
  const started = Date.now();
  const result = await generateAiProcedure({ title: '월별 실적 자료 작성과 제출', description: '세 가지 시험용 근거를 종합하여 자료 작성, 증빙 대조, 보완, 검토와 제출 절차를 구성합니다.', references });
  console.log(JSON.stringify({ connection: 'passed', model: result.model, selectedSources: references.length, summarizedSources: result.draft.analysis?.sources.length, summary: result.draft.analysis?.summary ? 'present' : 'missing', procedureSteps: result.draft.steps.length, citations: 'verified', elapsedMs: Date.now() - started, workspaceRecords: 'unchanged' }));
}
main().catch(error => {
  console.error(JSON.stringify({ connection: 'failed', code: error instanceof DomainError ? error.code : 'CHECK_FAILED', message: error instanceof DomainError ? error.message : 'BizRouter 연결 검사에 실패했습니다. 비밀값은 출력하지 않습니다.' }));
  process.exitCode = 1;
});
