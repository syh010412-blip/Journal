require('dotenv').config();

const { Client } = require('@notionhq/client');
const { getDiaryConfig } = require('./diary-config');

const { getDiaryEntries, aggregateDiaryStats } = require('./diary-read');
const { analyzeDiaryData } = require('./diary-analyzer');
const { buildDiaryReportBlocks } = require('./diary-blocks');

const { getRehabEntries, aggregateRehabStats } = require('./rehab-read');
const { analyzeRehabData } = require('./rehab-analyzer');
const { buildRehabReportBlocks } = require('./rehab-blocks');

const { getCalendarClient } = require('./weekly-google-auth');
const { getEventsForWeek } = require('./weekly-calendar');
const { getWeekRange, getTasksForWeek, getKSTToday } = require('./weekly-notion-read');
const { compareDayPlanVsExecution, aggregateWeeklyStats } = require('./weekly-comparator');
const { analyzeWeeklyData } = require('./weekly-analyzer');
const { buildWeeklyReportBlocks } = require('./weekly-blocks');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sectionHeader(emoji, title) {
  return [
    { object: 'block', type: 'divider', divider: {} },
    {
      object: 'block', type: 'heading_1',
      heading_1: {
        rich_text: [{ type: 'text', text: { content: `${emoji}  ${title}` }, annotations: { bold: true, color: 'default' } }],
        color: 'gray_background',
      },
    },
    { object: 'block', type: 'divider', divider: {} },
  ];
}

async function findExistingPage(dbId, title) {
  const res = await notion.databases.query({
    database_id: dbId,
    filter: { property: '리포트 명', title: { equals: title } },
    page_size: 1,
  });
  return res.results[0] || null;
}

async function clearPageBlocks(pageId) {
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    await Promise.all(res.results.map(b => notion.blocks.delete({ block_id: b.id })));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
}

async function appendBlocksInChunks(pageId, blocks) {
  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    await notion.blocks.children.append({ block_id: pageId, children: blocks.slice(i, i + CHUNK) });
    log(`블록 업로드: ${Math.min(i + CHUNK, blocks.length)}/${blocks.length}`);
  }
}

async function upsertReportPage(start, blocks) {
  const { REPORT_DB_ID } = getDiaryConfig();
  if (!REPORT_DB_ID) throw new Error('리포트_DB_ID가 설정되지 않았습니다. diary-config.txt를 확인하세요.');

  const title = `주간 올인원 리포트 ${start.replace(/-/g, '.')}`;
  log(`Notion 페이지: "${title}"`);

  const existing = await findExistingPage(REPORT_DB_ID, title);
  if (existing) {
    log('기존 페이지 업데이트…');
    await clearPageBlocks(existing.id);
    await appendBlocksInChunks(existing.id, blocks);
    log('업데이트 완료');
    return existing.id;
  }

  const page = await notion.pages.create({
    parent: { database_id: REPORT_DB_ID },
    icon: { type: 'emoji', emoji: '🗓️' },
    properties: {
      '리포트 명': { title: [{ text: { content: title } }] },
      '분석 날짜': { date: { start } },
    },
  });
  await appendBlocksInChunks(page.id, blocks);
  log('새 페이지 생성 완료');
  return page.id;
}

async function main() {
  log('=== 주간 올인원 리포트 시작 ===');

  const today = getKSTToday();
  const week = getWeekRange(today);
  const { monday: start, sunday: end } = week;
  log(`분석 기간: ${start} (월) ~ ${end} (일)`);

  // ── 1. 데이터 수집 ──────────────────────────────────────
  log('데이터 수집 중…');

  // Google Calendar + Notion 할 일 (실패해도 나머지 계속)
  let calEvents = null;
  let notionTasks = null;
  try {
    const calClient = await getCalendarClient();
    [calEvents, notionTasks] = await Promise.all([
      getEventsForWeek(calClient, start, end),
      getTasksForWeek(start, end),
    ]);
    const calCount = [...calEvents.values()].flat().length;
    const taskCount = [...notionTasks.values()].flat().length;
    log(`캘린더: ${calCount}건 | 할 일: ${taskCount}건`);
  } catch (err) {
    log(`[경고] 캘린더 수집 실패 (건너뜀): ${err.message}`);
  }

  const [diaryResult, rehabResult] = await Promise.allSettled([
    getDiaryEntries(start, end),
    getRehabEntries(start, end),
  ]);

  const hasDiary = diaryResult.status === 'fulfilled' && diaryResult.value.length > 0;
  const hasRehab = rehabResult.status === 'fulfilled' && rehabResult.value.length > 0;
  const hasCalendar = calEvents !== null;

  if (!hasDiary && !hasRehab && !hasCalendar) {
    log('해당 기간에 데이터가 없습니다.');
    process.exit(0);
  }

  if (diaryResult.status === 'rejected') log(`[경고] 일기 조회 실패: ${diaryResult.reason?.message}`);
  if (rehabResult.status === 'rejected') log(`[경고] 재활 조회 실패: ${rehabResult.reason?.message}`);

  // ── 2. 통계 집계 ────────────────────────────────────────
  const diaryStats = hasDiary ? aggregateDiaryStats(diaryResult.value) : null;
  const rehabStats = hasRehab ? aggregateRehabStats(rehabResult.value) : null;

  if (diaryStats) log(`일기 ${diaryStats.total}개 | 긍정 ${diaryStats.directionCount['긍정']} 부정 ${diaryStats.directionCount['부정']} 중립 ${diaryStats.directionCount['중립']}`);
  if (rehabStats) log(`재활 ${rehabStats.totalSessions}회 | 평균 통증 ${rehabStats.avgPain ?? '—'}/10 | 추이 ${rehabStats.painTrend}`);

  let weeklyData = null;
  if (hasCalendar) {
    const dailyComparisons = week.dates.map(dateStr => {
      const calEvts = calEvents.get(dateStr) || [];
      const tasks = notionTasks.get(dateStr) || [];
      return compareDayPlanVsExecution(calEvts, tasks, dateStr);
    });
    weeklyData = aggregateWeeklyStats(dailyComparisons);
    log(`주간 실행률: ${weeklyData.weekly.completionRate}% (${weeklyData.weekly.completed}/${weeklyData.weekly.totalTasks})`);
  }

  // ── 3. AI 분석 (병렬) ───────────────────────────────────
  log('AI 분석 중…');
  const [diaryAnalysis, rehabAnalysis, calAnalysis] = await Promise.allSettled([
    hasDiary ? analyzeDiaryData(diaryStats) : Promise.resolve(null),
    hasRehab ? analyzeRehabData(rehabStats) : Promise.resolve(null),
    weeklyData ? analyzeWeeklyData(weeklyData) : Promise.resolve(null),
  ]);

  if (diaryAnalysis.status === 'rejected') log(`[경고] 일기 AI 분석 실패: ${diaryAnalysis.reason?.message}`);
  if (rehabAnalysis.status === 'rejected') log(`[경고] 재활 AI 분석 실패: ${rehabAnalysis.reason?.message}`);
  if (calAnalysis.status === 'rejected') log(`[경고] 캘린더 AI 분석 실패: ${calAnalysis.reason?.message}`);

  // ── 4. 블록 조립 ────────────────────────────────────────
  const blocks = [];

  blocks.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `🗓️ 주간 올인원 리포트  |  ${start} ~ ${end}` } }],
      icon: { type: 'emoji', emoji: '🗓️' },
      color: 'blue_background',
    },
  });

  if (hasDiary && diaryAnalysis.status === 'fulfilled' && diaryAnalysis.value) {
    blocks.push(...sectionHeader('📔', '일기 분석'));
    const diaryBlocks = buildDiaryReportBlocks(diaryStats, diaryAnalysis.value);
    blocks.push(...diaryBlocks.slice(1));
  } else if (hasDiary) {
    blocks.push(...sectionHeader('📔', '일기 분석'));
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'AI 분석을 불러오지 못했습니다.' } }] } });
  }

  if (hasRehab && rehabAnalysis.status === 'fulfilled' && rehabAnalysis.value) {
    blocks.push(...sectionHeader('🏃', '재활 분석'));
    const rehabBlocks = buildRehabReportBlocks(rehabStats, rehabAnalysis.value);
    blocks.push(...rehabBlocks.slice(1));
  } else if (hasRehab) {
    blocks.push(...sectionHeader('🏃', '재활 분석'));
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'AI 분석을 불러오지 못했습니다.' } }] } });
  }

  if (weeklyData && calAnalysis.status === 'fulfilled' && calAnalysis.value) {
    blocks.push(...sectionHeader('📅', '캘린더 vs 할 일 비교'));
    const calBlocks = buildWeeklyReportBlocks(weeklyData, calAnalysis.value);
    blocks.push(...calBlocks.slice(1));
  } else if (hasCalendar) {
    blocks.push(...sectionHeader('📅', '캘린더 vs 할 일 비교'));
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'AI 분석을 불러오지 못했습니다.' } }] } });
  }

  log(`총 Notion 블록: ${blocks.length}개`);

  // ── 5. Notion 저장 ──────────────────────────────────────
  try {
    const pageId = await upsertReportPage(start, blocks);
    log(`완료: https://notion.so/${pageId.replace(/-/g, '')}`);
  } catch (err) {
    log(`[오류] Notion 업로드 실패: ${err.message}`);
    process.exit(1);
  }

  log('=== 주간 올인원 리포트 완료 ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
