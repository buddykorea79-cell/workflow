import { currentPeriod } from './schedule';
import type { Task, WorkspaceData } from './types';
import { createRun, defaultCard, defaultWorkflow, koreaDate, offsetDate, snapshot } from './seed-helpers';
import { applyBudgetDemo } from './budget-demo';
import { applyOrganizationDemo } from './organization-demo';
import { applyStatisticsDemo } from './statistics-demo';
export { createRun, commonWorkflow, defaultCard, defaultWorkflow, koreaDate, offsetDate, snapshot } from './seed-helpers';
export function createSeed(now = new Date()): WorkspaceData {
  const iso = now.toISOString(); const today = koreaDate(now); const year = today.slice(0, 4); const month = today.slice(5, 7); const period = `${year}년 ${Math.ceil(Number(month) / 3)}분기`;
  const users: WorkspaceData['users'] = [
    { id: 'u-minseo', name: '김담당', initials: '김', departmentId: 'dept-plan', team: '기획팀', role: 'manager', title: '부서 업무담당', color: 'stone', active: true },
    { id: 'u-jiho', name: '박주무관', initials: '박', departmentId: 'dept-plan', team: '기획팀', role: 'member', title: '주무관', color: 'stone', active: true },
    { id: 'u-seoyeon', name: '정주무관', initials: '정', departmentId: 'dept-plan', team: '기획팀', role: 'member', title: '주무관', color: 'stone', active: true },
    { id: 'u-head', name: '한과장', initials: '한', departmentId: 'dept-plan', team: '기획팀', role: 'head', title: '기획재정담당관', color: 'stone', active: true },
    { id: 'u-admin', name: '이관리자', initials: '이', departmentId: 'dept-plan', team: '시스템운영팀', role: 'admin', title: '시스템 관리자', color: 'stone', active: true },
    { id: 'u-doyun', name: '오담당', initials: '오', departmentId: 'dept-support', team: '데이터팀', role: 'manager', title: '부서 업무담당', color: 'stone', active: true },
    { id: 'u-support-head', name: '최과장', initials: '최', departmentId: 'dept-support', team: '데이터팀', role: 'head', title: '데이터정보화담당관', color: 'stone', active: true },
    { id: 'u-plan-lead', name: '이팀장', initials: '이', departmentId: 'dept-plan', team: '기획팀', role: 'lead', title: '기획팀장', color: 'stone', active: true },
    { id: 'u-support-lead', name: '김팀장', initials: '김', departmentId: 'dept-support', team: '데이터팀', role: 'lead', title: '데이터팀장', color: 'stone', active: true },
    { id: 'u-support-member', name: '송주무관', initials: '송', departmentId: 'dept-support', team: '데이터팀', role: 'member', title: '주무관', color: 'stone', active: true },
    { id: 'u-support-admin', name: '나관리자', initials: '나', departmentId: 'dept-support', team: '시스템운영팀', role: 'admin', title: '시스템 관리자', color: 'stone', active: true },
    { id: 'u-innovation-manager', name: '강담당', initials: '강', departmentId: 'dept-innovation', team: '혁신팀', role: 'manager', title: '부서 업무담당', color: 'stone', active: true },
    { id: 'u-innovation-head', name: '유과장', initials: '유', departmentId: 'dept-innovation', team: '혁신팀', role: 'head', title: '혁신행정담당관', color: 'stone', active: true },
    { id: 'u-innovation-lead', name: '박팀장', initials: '박', departmentId: 'dept-innovation', team: '혁신팀', role: 'lead', title: '혁신팀장', color: 'stone', active: true },
    { id: 'u-innovation-member', name: '임주무관', initials: '임', departmentId: 'dept-innovation', team: '혁신팀', role: 'member', title: '주무관', color: 'stone', active: true },
    { id: 'u-innovation-admin', name: '서관리자', initials: '서', departmentId: 'dept-innovation', team: '시스템운영팀', role: 'admin', title: '시스템 관리자', color: 'stone', active: true },
  ];
  users.forEach((user, index) => { user.email = `${user.id.slice(2)}@ieum.example`; user.phone = `02-0000-${String(index + 1001)}`; });
  const units: WorkspaceData['units'] = [
    { id: 'unit-budget', title: '예산 관리', departmentId: 'dept-plan', ownerId: 'u-minseo', description: '예산 편성부터 집행 점검까지', color: 'sage', icon: 'wallet' },
    { id: 'unit-strategy', title: '기획 · 성과 관리', departmentId: 'dept-plan', ownerId: 'u-minseo', description: '목표를 계획하고 성과를 기록합니다', color: 'gold', icon: 'chart' },
    { id: 'unit-meeting', title: '회의 · 보고 운영', departmentId: 'dept-plan', ownerId: 'u-jiho', description: '조직의 논의와 결정을 연결합니다', color: 'clay', icon: 'calendar' },
    { id: 'unit-record', title: '기록 · 자료 관리', departmentId: 'dept-plan', ownerId: 'u-seoyeon', description: '업무의 맥락과 근거를 보존합니다', color: 'stone', icon: 'folder' },
    { id: 'unit-support', title: '데이터 · 정보화 운영', departmentId: 'dept-support', ownerId: 'u-doyun', description: '공공데이터의 품질과 정보시스템 운영을 관리합니다', color: 'stone', icon: 'users' },
    { id: 'unit-data', title: '공공데이터 품질 관리', departmentId: 'dept-support', ownerId: 'u-support-member', description: '공공데이터 개방과 품질 진단을 수행합니다', color: 'stone', icon: 'folder' },
    { id: 'unit-innovation', title: '행정서비스 혁신', departmentId: 'dept-innovation', ownerId: 'u-innovation-manager', description: '국민이 체감하는 서비스 개선 과제를 관리합니다', color: 'stone', icon: 'folder' },
    { id: 'unit-service', title: '민원 절차 개선', departmentId: 'dept-innovation', ownerId: 'u-innovation-member', description: '불편 사항을 수집하고 행정 절차를 개선합니다', color: 'stone', icon: 'folder' },
  ];
  const specs: [string, string, string, string, string, number, Task['priority'], Task['frequency'], Task['status']][] = [
    ['task-budget', '분기 예산 집행 현황 보고', 'unit-budget', 'u-minseo', '예산 집행 현황과 증빙을 검증하여 부서별 집행 상황을 보고합니다.', 3, 'high', 'quarterly', 'confirmed'],
    ['task-plan', '2027년 주요업무 추진계획 수립', 'unit-strategy', 'u-minseo', '부서별 실행 계획을 취합하고 기관의 다음 연도 추진 방향을 정리합니다.', 12, 'high', 'yearly', 'confirmed'],
    ['task-meeting', '주간 간부회의 운영', 'unit-meeting', 'u-jiho', '회의 안건과 자료를 준비하고 결정 사항의 후속 조치를 관리합니다.', 2, 'medium', 'once', 'confirmed'],
    ['task-indicator', '부서 성과지표 실적 점검', 'unit-strategy', 'u-seoyeon', '지표별 실적과 증빙을 확인하고 개선이 필요한 항목을 기록합니다.', 7, 'medium', 'monthly', 'confirmed'],
    ['task-manual', '업무 매뉴얼 현행화', 'unit-record', 'u-minseo', '변경된 절차와 서식을 반영하고 인수인계 유의사항을 보완합니다.', 18, 'low', 'half_yearly', 'confirmed'],
    ['task-contract', '용역 계약 이행 현황 점검', 'unit-budget', 'u-jiho', '계약 이행 자료와 결과물을 확인하여 미완료 사항을 조정합니다.', -2, 'high', 'monthly', 'confirmed'],
    ['task-archive', '기록물 정리 및 이관', 'unit-record', 'u-seoyeon', '보존 대상 자료의 분류와 목록을 점검하고 기록관리 담당자에게 이관합니다.', 22, 'medium', 'yearly', 'review'],
    ['task-improve', '부서 협업 절차 개선', 'unit-strategy', 'u-minseo', '자료 요청과 검토 과정의 병목을 확인하고 개선안을 작성합니다.', 25, 'low', 'once', 'draft'],
    ['task-assets', '공용 자산 정기 점검', 'unit-support', 'u-doyun', '공용 자산의 상태와 사용 현황을 점검합니다.', 10, 'medium', 'quarterly', 'confirmed'],
    ['task-data', '공공데이터 품질 진단 및 오류 정비', 'unit-data', 'u-support-member', '개방 데이터의 오류를 진단하고 개선 결과를 기록합니다.', 8, 'high', 'quarterly', 'confirmed'],
    ['task-service', '민원 처리 절차 개선안 작성', 'unit-service', 'u-innovation-member', '반복 민원을 분석하여 처리 절차와 안내 양식을 개선합니다.', 15, 'medium', 'half_yearly', 'confirmed'],
    ['task-directive', '민원 서비스 개선 추진 지시', 'unit-innovation', 'u-innovation-manager', '처리 기간이 긴 민원 업무를 분석하고 개선 계획을 제출합니다. 시연용 가상 지시사항입니다.', 20, 'high', 'once', 'draft'],
  ];
  const tasks = specs.map(([id, title, unitId, primaryId, description, days, priority, frequency, status], i): Task => {
    const departmentId = units.find(unit => unit.id === unitId)!.departmentId;
    const task: Task = { id, code: `WK-${String(i + 1).padStart(3, '0')}`, title, description, unitId, departmentId, primaryId, supportIds: departmentId === 'dept-plan' ? [primaryId === 'u-jiho' ? 'u-minseo' : 'u-jiho'] : [], reviewerId: users.find(u => u.departmentId === departmentId && u.role === 'head')!.id, status, priority, frequency, dueDate: offsetDate(days, now), tags: i === 0 ? ['공통업무', '예산'] : [units.find(u => u.id === unitId)!.title.split(' ')[0]], version: 1, completionCriteria: '필수 체크리스트와 결과물을 확인하고 총괄의 검토를 완료합니다.', card: defaultCard(description), workflow: defaultWorkflow({ legacy: true }), sourceIds: departmentId === 'dept-plan' ? ['source-manual'] : [], versions: [], commonId: i === 0 ? 'common-budget' : undefined, createdAt: offsetDate(-25, now) + 'T00:00:00+09:00', updatedAt: iso };
    task.budget = [240000000, 60000000, 12000000, 18000000, 5000000, 120000000, 0, 10000000, 8000000, 80000000, 30000000, 0][i];
    task.expenses = task.budget ? [{ id: `expense-${i + 1}`, date: offsetDate(-7, now), description: '시연용 사업 착수 및 운영비', amount: Math.round(task.budget * 0.35) }] : [];
    task.references = [
      { id: `ref-guide-${i + 1}`, type: 'guideline', title: '업무 수행 지침 · 시연용', content: '해당 업무의 자료 취합과 검토 절차를 기록하는 가상 지침입니다.' },
      { id: `ref-agenda-${i + 1}`, type: 'national_agenda', title: '행정서비스 개선 · 가상 국정과제', content: '국정과제와 업무를 연결하는 입력 예시입니다. 실제 국정과제 번호나 내용이 아닙니다.' },
    ];
    task.workflow.forEach((step, stepIndex) => { step.startDate = offsetDate(days - 8 + stepIndex * 2, now); step.dueDate = offsetDate(days - 6 + stepIndex * 2, now); step.done = false; });
    if (id === 'task-directive') { task.commonId = 'directive-service'; task.tags = ['지시사항']; task.references.push({ id: 'ref-service-directive', type: 'directive', title: task.title, content: task.description }); }
    if (status === 'confirmed') task.versions.push(snapshot(task, task.reviewerId, iso));
    return task;
  });
  const runs = tasks.filter(t => t.status === 'confirmed').map((task, index) => { const run = createRun(task, currentPeriod(task.frequency, now), iso); const completedCount = [2, 1, 1, 2, 0, 1, 2, 1, 0][index] ?? 0; run.steps.forEach((s, i) => { if (i < completedCount) { s.status = 'completed'; s.checklist.forEach(c => { c.done = true; c.completedBy = task.primaryId; c.completedAt = iso; }); s.output = `${s.title} 확인 기록`; s.completedAt = iso; s.completedBy = task.primaryId; } else if (i === completedCount) s.status = 'in_progress'; }); run.notes = [{ id: `note-${index}`, authorId: task.primaryId, body: index === 0 ? '부서별 집행 자료 취합을 마쳤습니다. 검증 완료 후 총괄 검토를 요청할 예정입니다.' : '현재 회차의 자료와 진행 상황을 이곳에 기록합니다.', createdAt: iso }]; return run; });
  for (const task of tasks) for (const step of task.workflow) step.done = runs.find(r => r.taskId === task.id)?.steps.find(s => s.stepId === step.id)?.status === 'completed';
  const handoverChecks = () => [{ id: 'hc-1', title: '현재 업무와 미완료 단계 확인', checked: false }, { id: 'hc-2', title: '관련 자료 및 접근 권한 확인', checked: false }, { id: 'hc-3', title: '다음 마감과 담당자 연락처 확인', checked: false }];
  const state: WorkspaceData = {
    revision: 1, users, departments: [{ id: 'dept-plan', name: '기획재정담당관실', shortName: '기획재정' }, { id: 'dept-support', name: '데이터정보화담당관실', shortName: '데이터정보화' }, { id: 'dept-innovation', name: '혁신행정담당관실', shortName: '혁신행정' }], units, tasks, runs,
    handovers: [
      { id: 'handover-meeting', title: '주간 간부회의 운영 인수인계', taskIds: ['task-meeting'], runIds: [runs.find(r => r.taskId === 'task-meeting')!.id], fromId: 'u-jiho', toId: 'u-minseo', departmentId: 'dept-plan', targetDepartmentId: 'dept-plan', status: 'acceptance', effectiveAt: today + 'T09:00:00+09:00', summary: '다음 회의부터 자료 취합과 회의 운영을 인계합니다.', pendingItems: '다음 주 안건 2건의 자료 보완이 필요합니다.', nextAction: '회의 하루 전 15시까지 최종 자료를 확인해 주세요.', notes: '회의록 양식과 안건별 연락처는 업무관리카드를 확인해 주세요.', checklist: handoverChecks(), revision: 1, approvedBy: 'u-head', approvedAt: iso, createdAt: iso },
      { id: 'handover-manual', title: '업무 매뉴얼 현행화 인수인계', taskIds: ['task-manual'], runIds: [runs.find(r => r.taskId === 'task-manual')!.id], fromId: 'u-minseo', toId: 'u-seoyeon', departmentId: 'dept-plan', targetDepartmentId: 'dept-plan', status: 'approval', effectiveAt: offsetDate(5, now) + 'T09:00:00+09:00', summary: '업무 매뉴얼 개정과 자료 관리를 인계합니다.', pendingItems: '개정 요청 3건을 검토해야 합니다.', nextAction: '각 담당자의 변경 의견을 취합합니다.', notes: '확정된 기존 매뉴얼은 보존하고 새 버전으로 작성합니다.', checklist: handoverChecks(), revision: 1, createdAt: iso },
      { id: 'handover-plan', title: '주요업무 계획 수립 담당 변경', taskIds: ['task-plan'], runIds: [], fromId: 'u-minseo', toId: 'u-seoyeon', departmentId: 'dept-plan', targetDepartmentId: 'dept-plan', status: 'scheduled', effectiveAt: offsetDate(14, now) + 'T09:00:00+09:00', summary: '다음 회차의 계획 수립 업무를 인계합니다.', pendingItems: '진행 회차는 기존 담당자가 마무리합니다.', nextAction: '다음 연도 계획 양식 검토', notes: '진행 회차의 담당 배정은 유지합니다.', checklist: handoverChecks().map(c => ({ ...c, checked: true })), revision: 1, approvedBy: 'u-head', approvedAt: iso, acceptedBy: 'u-seoyeon', acceptedAt: iso, acceptedRevision: 1, createdAt: iso },
    ],
    commonTasks: [
      { id: 'common-budget', kind: 'common', distributionMode: 'all', projectName: '2026년 예산 관리', title: '분기 예산 집행 현황 보고', description: '각 부서의 예산 집행 현황을 동일한 기준으로 취합합니다.', managerId: 'u-minseo', dueDate: offsetDate(3, now), frequency: 'quarterly', version: 1, requiredSteps: ['자료 준비', '내용 검증', '내부 검토', '최종 제출'], departmentIds: ['dept-plan', 'dept-support', 'dept-innovation'], distributions: [{ id: 'dist-budget-plan', departmentId: 'dept-plan', status: 'registered', taskId: 'task-budget', team: '기획팀', leadId: 'u-plan-lead', assigneeId: 'u-minseo', distributedAt: iso }, { id: 'dist-budget-support', departmentId: 'dept-support', status: 'pending', distributedAt: iso }, { id: 'dist-budget-innovation', departmentId: 'dept-innovation', status: 'pending', distributedAt: iso }] },
      { id: 'common-security', kind: 'common', distributionMode: 'all', projectName: '정보보호 수준 향상', title: '하반기 정보보안 점검', description: '업무용 계정과 자료 접근 권한의 적정성을 점검합니다.', managerId: 'u-doyun', dueDate: offsetDate(9, now), frequency: 'half_yearly', version: 1, requiredSteps: ['점검 대상 확인', '자체 점검', '결과 검토', '최종 제출'], departmentIds: ['dept-plan', 'dept-support', 'dept-innovation'], distributions: [{ id: 'dist-security-plan', departmentId: 'dept-plan', status: 'team_assigned', team: '기획팀', leadId: 'u-plan-lead', distributedAt: iso }, { id: 'dist-security-support', departmentId: 'dept-support', status: 'person_assigned', team: '데이터팀', leadId: 'u-support-lead', assigneeId: 'u-support-member', distributedAt: iso }, { id: 'dist-security-innovation', departmentId: 'dept-innovation', status: 'pending', distributedAt: iso }] },
      { id: 'directive-service', kind: 'directive', directiveIssuer: 'minister', instructedOn: today, distributionMode: 'selected', projectName: '국민 체감 행정혁신', title: '민원 서비스 개선 추진 지시', description: '처리 기간이 긴 민원 업무를 분석하고 개선 계획을 제출합니다. 시연용 가상 지시사항입니다.', managerId: 'u-minseo', dueDate: offsetDate(20, now), frequency: 'once', version: 1, requiredSteps: ['자료 준비', '내용 검증', '내부 검토', '최종 제출'], departmentIds: ['dept-innovation'], distributions: [{ id: 'dist-directive-innovation', departmentId: 'dept-innovation', status: 'pending', taskId: 'task-directive', distributedAt: iso }] },
    ],
    sources: [
      { id: 'source-manual', title: '업무 수행 및 인수인계 매뉴얼', type: 'manual', departmentId: 'dept-plan', publisher: '기획재정담당관실 · 가상 예제', version: '1.2', effectiveDate: `${year}-01-01`, url: '', description: '기능 검토를 위한 가상 매뉴얼입니다. 실제 기관의 지침이나 법적 근거가 아닙니다.', classification: 'internal', aiAllowed: false, verified: false, updatedAt: iso },
      { id: 'source-budget', title: '예산 집행 현황 제출 안내', type: 'guideline', departmentId: 'dept-plan', publisher: '기획재정담당관실 · 가상 예제', version: '2.0', effectiveDate: `${year}-10-01`, url: '', description: '분기별 예산 집행 현황 보고의 작성 항목과 검토 절차를 설명하는 예제입니다.', classification: 'internal', aiAllowed: false, verified: false, updatedAt: iso },
      { id: 'source-form', title: '업무관리카드 작성 참고 양식', type: 'reference', departmentId: 'dept-plan', publisher: '온이음 워크스페이스', version: '1.0', effectiveDate: today, url: '', description: '목적·이해관계자·근거·책임·절차 등 9개 항목을 작성하는 예제 양식입니다.', classification: 'public', aiAllowed: true, verified: false, updatedAt: iso },
    ],
    performances: [{ period: year + '-H' + (Number(month) <= 6 ? '1' : '2'), id: 'perf-budget', taskId: 'task-budget', runId: runs.find(r => r.taskId === 'task-budget')!.id, title: '분기 예산 집행 자료 정합성 개선', description: '부서별 자료의 누락 항목을 확인하고 제출 양식을 통일했습니다.', authorId: 'u-minseo', departmentId: 'dept-plan', status: 'review', metricName: '검증 완료 자료', value: 12, unit: '건', evidence: '예산 집행 현황 검증 결과 기록', createdAt: iso }],
    delegations: [],
    audit: [
      { id: 'audit-1', actorId: 'u-head', action: 'handover.approve', targetType: 'handover', targetId: 'handover-meeting', title: '인수인계 승인', detail: '주간 간부회의 운영 · 인수자 수락 대기', departmentId: 'dept-plan', createdAt: iso },
      { id: 'audit-2', actorId: 'u-minseo', action: 'run.note', targetType: 'run', targetId: runs[0].id, title: '수행 기록 추가', detail: '분기 예산 집행 현황 보고', departmentId: 'dept-plan', createdAt: iso },
      { id: 'audit-3', actorId: 'u-head', action: 'task.confirm', targetType: 'task', targetId: 'task-budget', title: '업무 기준 확정', detail: '분기 예산 집행 현황 보고 · v1', departmentId: 'dept-plan', createdAt: iso },
    ],
    notifications: [{ id: 'notification-1', title: '인수 확인이 필요해요', description: '박주무관님이 주간 간부회의 운영을 인계했습니다.', type: 'handover', targetId: 'handover-meeting', read: false, userId: 'u-minseo' }, { id: 'notification-2', title: '새 공통업무가 도착했어요', description: '하반기 정보보안 점검의 담당자를 배정해 주세요.', type: 'common', targetId: 'common-security', read: false, userId: 'u-minseo' }],
    attachments: [], processedRequests: [],
    releases: [
      { id: 'release-070', version: '0.7.0', date: iso, title: '반복 업무 회차와 지난 절차 이력', notes: '세부업무의 모든 절차를 완료하면 새 일정으로 다음 회차를 시작합니다. 지난 회차의 절차·일정·체크리스트·완료자·결과를 보존하고 읽기 전용으로 조회합니다.' },
      { id: 'release-060', version: '0.6.0', date: iso, title: '부서 업무 계층 조회와 개인별 50점 평가', notes: '팀·직원·단위업무·세부업무를 한 화면에 연결하고 세부업무 상세를 조회합니다. 반기 성과를 개인별로 모아 보고, 개인이 설정한 단위업무별 배점 합계 50점 안에서 부서장이 평가합니다. 평가 시점의 성과와 배점을 보존합니다.' },
      { id: 'release-050', version: '0.5.0', date: '2026-10-31', title: '부서 업무분장과 자료 기반 흐름도', notes: '부서장 전용 업무 요약, 업무분장 일괄 확정·재작성 허용과 변경 잠금, 부서별 조직 조회 및 관리자 전체 권한 확인을 제공합니다. PDF 텍스트·법령·지침 본문에서 근거와 역할이 연결된 절차 초안을 작성하고 검토 후 흐름도로 저장합니다. 스캔 PDF OCR과 외부 AI·법령 자동 조회는 후속 과제입니다.' },
      { id: 'release-041', version: '0.4.1', date: '2026-10-31', title: '부서별 로그인과 예산 업무 시연', notes: '일반 역할은 데이터정보화담당관실 계정을 기본 선택하고, 공통업무 담당은 기획재정담당관실 예산담당 주무관으로 시연합니다. 기획재정담당관실 박주무관은 개인 담당자 역할의 예산담당 주무관으로 공통업무 관리 권한을 함께 갖습니다. 기획재정·데이터정보화 부서의 예산 단위업무·세부업무와 공통 예산업무 예시를 보충했습니다. 공통업무 관리와 부서·팀 배정 권한을 구분하며 기존 업무를 보존하고 같은 데모 항목의 중복 생성을 방지합니다.' },
      { id: 'release-040', version: '0.4.0', date: '2026-10-31', title: '공통업무의 배정과 진행을 한눈에', notes: '부서 접수→팀 배정→개인 배정→내 업무 등록→수행·완료 단계를 구분합니다. 공통업무 담당자가 대상 부서별 담당 팀·담당자와 진행 현황을 함께 확인하고 다음 조치가 필요한 배포 항목을 파악할 수 있도록 정리했습니다. 총괄 조회는 배정·진행 요약에 한하며, 세부업무 내용은 기존 열람·수정 권한을 유지합니다.' },
      { id: 'release-030', version: '0.3.0', date: '2026-10-31', title: '단위업무와 세부업무를 명확하게', notes: '단위업무는 업무 묶음, 세부업무는 실행 과제로 구분하고 단위업무별로 표시합니다. 본인 단위업무의 추가·수정·삭제·복원과 직접 만든 세부업무의 추가·수정·단위 이동·삭제·복원을 제공합니다. 활성 세부업무가 있는 단위업무의 삭제와 공통업무 원본의 삭제를 보호하며, 배정된 공통업무는 소속 단위업무를 변경할 수 있습니다. 삭제한 항목은 개인업무 휴지통에서 확인하고 복원합니다.' },
      { id: 'release-022', version: '0.2.2', date: '2026-10-31', title: '파랑으로 이어가는 온이음', notes: '서비스명을 온이음으로 변경하고 메인 컬러를 파랑으로 정리했습니다. 녹색은 완료, 코랄은 확인 필요 상태의 보조 강조로 유지하며, 기존 Pretendard 글꼴과 전반적인 화면 구성을 유지했습니다. 초기 홈의 부서 아바타와 3개 부서 소개 문구를 삭제했습니다.' },
      { id: 'release-021', version: '0.2.1', date: '2026-10-31', title: '업무 상태를 색으로 더 명확하게', notes: '기존 Pretendard 글꼴과 화면 배치·디자인 컨셉을 유지하고 Cohere 디자인 문서를 참고한 녹색·파랑·코랄 강조를 적용했습니다. 선택·완료는 녹색, 진행·안내는 파랑, 기한 경과·확인 필요는 코랄로 구분하며, 밝은 본문과 카드 바탕을 유지했습니다.' },
      { id: 'release-020', version: '0.2.0', date: today, title: '업무의 흐름을 하나로', notes: 'Mobbin 기반 화면 전면 개편. 권한별 시연 로그인과 3개 부서·16명 가상 구성원. 개인 단위·세부업무, 공통업무의 부서→팀→개인 배정, 지시사항 자동 생성, 예산·집행·근거 관리, 절차별 일정, 반기 성과 및 부서장 평가.' },
      { id: 'release-010', version: '0.1.0', date: today, title: '업무관리 초기 구현', notes: '업무 정의 및 수행 기록, 인수인계 승인, 로컬 파일 저장, 감사 이력의 기반 구현. 원본 소스와 자료는 etc 폴더에 보관.' },
    ],
  };
  applyBudgetDemo(state, now);
  applyOrganizationDemo(state, now);
  applyStatisticsDemo(state, now);
  return state;
}
