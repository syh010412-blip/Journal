require('dotenv').config();

const { Client } = require('@notionhq/client');
const { getRehabConfig } = require('./diary-config');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function parseRehabPage(page, config) {
  const props = page.properties;
  const { DATE_PROP, PAIN_PROP } = config;

  const dateStr = props[DATE_PROP]?.date?.start || null;

  // 페이지 제목을 운동명으로 사용 (title 타입 속성 자동 탐색)
  const titleKey = Object.keys(props).find(k => props[k].type === 'title');
  const exerciseName = titleKey
    ? (props[titleKey]?.title || []).map(t => t.plain_text).join('').trim()
    : '';

  const painLevel = props[PAIN_PROP]?.number ?? null;

  let dayOfWeek = null, dayIndex = null;
  if (dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    dayIndex = d.getDay();
    dayOfWeek = DAY_NAMES[dayIndex];
  }

  return { pageId: page.id, dateStr, dayOfWeek, dayIndex, exerciseName, painLevel };
}

async function getRehabEntries(startDate, endDate) {
  const config = getRehabConfig();
  const { REHAB_DB_ID, DATE_PROP } = config;

  if (!REHAB_DB_ID) throw new Error('재활_DB_ID가 설정되지 않았습니다. diary-config.txt를 확인하세요.');

  console.log(`[rehab-read] 조회: ${startDate} ~ ${endDate}`);

  let allResults = [], cursor;
  do {
    const res = await notion.databases.query({
      database_id: REHAB_DB_ID,
      filter: {
        and: [
          { property: DATE_PROP, date: { on_or_after: startDate } },
          { property: DATE_PROP, date: { on_or_before: endDate } },
        ],
      },
      sorts: [{ property: DATE_PROP, direction: 'ascending' }],
      start_cursor: cursor,
      page_size: 100,
    });
    allResults.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  console.log(`[rehab-read] ${allResults.length}개 로드`);
  const config2 = config;
  return allResults.map(p => parseRehabPage(p, config2)).filter(e => e.dateStr);
}

function aggregateRehabStats(entries) {
  // 날짜별 그룹
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.dateStr]) byDate[e.dateStr] = [];
    byDate[e.dateStr].push(e);
  }

  const totalSessions = entries.length;
  const totalDays = Object.keys(byDate).length;
  const dateRange = totalSessions > 0
    ? { start: entries[0].dateStr, end: entries[entries.length - 1].dateStr }
    : null;

  // 평균 통증 레벨
  const painEntries = entries.filter(e => e.painLevel !== null);
  const avgPain = painEntries.length > 0
    ? Math.round(painEntries.reduce((s, e) => s + e.painLevel, 0) / painEntries.length * 10) / 10
    : null;

  // 최근 vs 초기 통증 추이 (개선 여부)
  const firstHalf = painEntries.slice(0, Math.ceil(painEntries.length / 2));
  const secondHalf = painEntries.slice(Math.ceil(painEntries.length / 2));
  const firstAvg = firstHalf.length > 0
    ? Math.round(firstHalf.reduce((s, e) => s + e.painLevel, 0) / firstHalf.length * 10) / 10
    : null;
  const secondAvg = secondHalf.length > 0
    ? Math.round(secondHalf.reduce((s, e) => s + e.painLevel, 0) / secondHalf.length * 10) / 10
    : null;
  const painTrend = firstAvg !== null && secondAvg !== null
    ? (secondAvg < firstAvg ? '개선' : secondAvg > firstAvg ? '악화' : '유지')
    : '데이터부족';

  // 운동별 빈도
  const exerciseFreq = {};
  for (const e of entries) {
    if (e.exerciseName) exerciseFreq[e.exerciseName] = (exerciseFreq[e.exerciseName] || 0) + 1;
  }
  const topExercises = Object.entries(exerciseFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // 요일별 통계
  const dayStats = Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i, dayOfWeek: DAY_NAMES[i], count: 0, avgPain: null,
  }));
  for (let i = 0; i < 7; i++) {
    const dayEs = entries.filter(e => e.dayIndex === i);
    dayStats[i].count = dayEs.length;
    const dayPain = dayEs.filter(e => e.painLevel !== null);
    if (dayPain.length > 0) {
      dayStats[i].avgPain = Math.round(
        dayPain.reduce((s, e) => s + e.painLevel, 0) / dayPain.length * 10
      ) / 10;
    }
  }

  // 날짜별 통증 추이 (일별 평균)
  const dailyPainTrend = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, es]) => {
      const pe = es.filter(e => e.painLevel !== null);
      return {
        dateStr,
        dayOfWeek: es[0]?.dayOfWeek || '',
        sessionCount: es.length,
        avgPain: pe.length > 0
          ? Math.round(pe.reduce((s, e) => s + e.painLevel, 0) / pe.length * 10) / 10
          : null,
        exercises: es.map(e => e.exerciseName).filter(Boolean),
      };
    });

  return {
    totalSessions, totalDays, dateRange, avgPain, painTrend,
    firstAvg, secondAvg, topExercises, dayStats, dailyPainTrend,
    entries,
  };
}

module.exports = { getRehabEntries, aggregateRehabStats };
