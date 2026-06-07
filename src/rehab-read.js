require('dotenv').config();

const { Client } = require('@notionhq/client');
const { getRehabConfig } = require('./diary-config');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function parseRehabPage(page, config) {
  const props = page.properties;
  const { DATE_PROP, PAIN_PROP, CONDITION_PROP, EXERCISE_PROP, MOOD_PROP, ARM_PROP, MEMO_PROP } = config;

  const dateStr = props[DATE_PROP]?.date?.start || null;
  const painLevel = props[PAIN_PROP]?.number ?? null;
  const condition = props[CONDITION_PROP]?.select?.name || null;
  const exerciseText = (props[EXERCISE_PROP]?.rich_text || []).map(t => t.plain_text).join('').trim();
  const mood = props[MOOD_PROP]?.select?.name || null;
  const armMovement = props[ARM_PROP]?.number ?? null;
  const memo = (props[MEMO_PROP]?.rich_text || []).map(t => t.plain_text).join('').trim();

  const titleKey = Object.keys(props).find(k => props[k].type === 'title');
  const sessionName = titleKey
    ? (props[titleKey]?.title || []).map(t => t.plain_text).join('').trim()
    : '';

  let dayOfWeek = null, dayIndex = null;
  if (dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    dayIndex = d.getDay();
    dayOfWeek = DAY_NAMES[dayIndex];
  }

  const exercises = exerciseText
    ? exerciseText.split(/[+,/、·\n]+/).map(s => s.trim()).filter(Boolean)
    : sessionName
    ? [sessionName]
    : [];

  return {
    pageId: page.id, dateStr, dayOfWeek, dayIndex,
    sessionName, painLevel, condition, exerciseText, exercises,
    mood, armMovement, memo,
  };
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
  return allResults.map(p => parseRehabPage(p, config)).filter(e => e.dateStr);
}

function aggregateRehabStats(entries) {
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

  const painEntries = entries.filter(e => e.painLevel !== null);
  const avgPain = painEntries.length > 0
    ? Math.round(painEntries.reduce((s, e) => s + e.painLevel, 0) / painEntries.length * 10) / 10
    : null;

  const armEntries = entries.filter(e => e.armMovement !== null);
  const avgArmMovement = armEntries.length > 0
    ? Math.round(armEntries.reduce((s, e) => s + e.armMovement, 0) / armEntries.length * 10) / 10
    : null;

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

  // 왼팔 움직임 추이
  const firstArmHalf = armEntries.slice(0, Math.ceil(armEntries.length / 2));
  const secondArmHalf = armEntries.slice(Math.ceil(armEntries.length / 2));
  const firstArmAvg = firstArmHalf.length > 0
    ? Math.round(firstArmHalf.reduce((s, e) => s + e.armMovement, 0) / firstArmHalf.length * 10) / 10
    : null;
  const secondArmAvg = secondArmHalf.length > 0
    ? Math.round(secondArmHalf.reduce((s, e) => s + e.armMovement, 0) / secondArmHalf.length * 10) / 10
    : null;
  const armTrend = firstArmAvg !== null && secondArmAvg !== null
    ? (secondArmAvg > firstArmAvg ? '개선' : secondArmAvg < firstArmAvg ? '악화' : '유지')
    : '데이터부족';

  // 운동 빈도 집계 (exercises 배열 기준)
  const exerciseFreq = {};
  for (const e of entries) {
    for (const ex of e.exercises) {
      exerciseFreq[ex] = (exerciseFreq[ex] || 0) + 1;
    }
  }
  const topExercises = Object.entries(exerciseFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // 컨디션 분포
  const conditionDist = {};
  for (const e of entries) {
    if (e.condition) conditionDist[e.condition] = (conditionDist[e.condition] || 0) + 1;
  }

  // 기분 분포
  const moodDist = {};
  for (const e of entries) {
    if (e.mood) moodDist[e.mood] = (moodDist[e.mood] || 0) + 1;
  }

  // 요일별 통계
  const dayStats = Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i, dayOfWeek: DAY_NAMES[i], count: 0, avgPain: null, avgArmMovement: null,
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
    const dayArm = dayEs.filter(e => e.armMovement !== null);
    if (dayArm.length > 0) {
      dayStats[i].avgArmMovement = Math.round(
        dayArm.reduce((s, e) => s + e.armMovement, 0) / dayArm.length * 10
      ) / 10;
    }
  }

  // 날짜별 기록
  const dailyPainTrend = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, es]) => {
      const pe = es.filter(e => e.painLevel !== null);
      const ae = es.filter(e => e.armMovement !== null);
      return {
        dateStr,
        dayOfWeek: es[0]?.dayOfWeek || '',
        sessionCount: es.length,
        avgPain: pe.length > 0
          ? Math.round(pe.reduce((s, e) => s + e.painLevel, 0) / pe.length * 10) / 10
          : null,
        avgArmMovement: ae.length > 0
          ? Math.round(ae.reduce((s, e) => s + e.armMovement, 0) / ae.length * 10) / 10
          : null,
        exercises: [...new Set(es.flatMap(e => e.exercises))].filter(Boolean),
        conditions: [...new Set(es.map(e => e.condition).filter(Boolean))],
        moods: [...new Set(es.map(e => e.mood).filter(Boolean))],
        memos: es.map(e => e.memo).filter(Boolean),
      };
    });

  return {
    totalSessions, totalDays, dateRange, avgPain, avgArmMovement,
    painTrend, armTrend, firstAvg, secondAvg, firstArmAvg, secondArmAvg,
    topExercises, conditionDist, moodDist, dayStats, dailyPainTrend,
    entries,
  };
}

module.exports = { getRehabEntries, aggregateRehabStats };
