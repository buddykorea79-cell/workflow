/** Small landing-page data; detailed menus and instructions stay in the lazy guide. */
export const guideRoleSummary = {
  member: { id: 'member', title: '업무 담당자', summary: '내 업무와 공통 세부업무를 작성하고 근거·절차·일정·수행 결과와 반기 성과를 관리합니다.' },
  lead: { id: 'lead', title: '팀장', summary: '팀에 도착한 공통업무를 팀원에게 배정하고, 본인의 담당 업무도 수행합니다.' },
  manager: { id: 'manager', title: '부서 담당자', summary: '부서의 업무 배정과 인사이동 시 업무 보관·재배정을 맡고 성과 제출 현황을 확인합니다.' },
  head: { id: 'head', title: '부서장', summary: '공통업무 배포 요청·업무분장·인수인계를 검토·승인하고 직원이 제출한 반기 성과를 평가합니다.' },
  admin: { id: 'admin', title: '관리자', summary: '부서·구성원을 등록하고 인사정보를 변경하며 업무분장·평가·변경 기록을 관리합니다.' },
} as const;

export type GuideRole = keyof typeof guideRoleSummary;
export type GuideSection = 'start' | 'roles' | 'task' | 'faq';
export const guideRoleSummaries = Object.values(guideRoleSummary);
