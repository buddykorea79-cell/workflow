/** Use the API server clock and Seoul boundary, never the client timezone. */
export function currentHalf(serverTime) {
  const date = new Date(serverTime);
  if (!Number.isFinite(date.getTime())) throw new Error('A valid API serverTime is required.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(part => part.type === 'year').value}-H${Number(parts.find(part => part.type === 'month').value) <= 6 ? 1 : 2}`;
}

export function previousHalf(period) {
  const match = /^(20\d{2})-H([12])$/.exec(period);
  if (!match) throw new Error('A valid half-year period is required.');
  return match[2] === '2' ? `${match[1]}-H1` : `${Number(match[1]) - 1}-H2`;
}

export function recentHalves(serverTime, count = 20) {
  const periods = [];
  let period = currentHalf(serverTime);
  for (let index = 0; index < count && /^20\d{2}-H[12]$/.test(period); index++) {
    periods.push(period);
    period = previousHalf(period);
  }
  return periods;
}
