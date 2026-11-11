/** Small landing-page data; detailed menus and instructions stay in the lazy guide. */
export const guideRoleSummary = {
  member: { id: 'member', title: '업무 담당자', summary: '내 업무를 등록하고 절차·일정에 따라 수행한 뒤 반기 성과를 제출합니다.' },
  lead: { id: 'lead', title: '팀장', summary: '팀에 도착한 공통업무를 팀원에게 배정하고 본인 업무를 수행합니다.' },
  manager: { id: 'manager', title: '부서 담당자', summary: '접수된 업무를 팀에 배정하고 인수인계와 직원의 성과 제출 현황을 챙깁니다.' },
  head: { id: 'head', title: '부서장', summary: '업무분장을 확정하고 배포·인수인계·대행 요청을 승인하며 반기 성과를 평가합니다.' },
  admin: { id: 'admin', title: '관리자', summary: '조직·인사정보와 기본 대행자, 예산 원장, AI·저장소 연결을 관리합니다.' },
} as const;

export type GuideRole = keyof typeof guideRoleSummary;
export type GuideSection = 'start' | 'roles' | 'task' | 'faq';
export const guideRoleSummaries = Object.values(guideRoleSummary);
