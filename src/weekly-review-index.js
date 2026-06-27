require('dotenv').config();

const { getCalendarClient } = require('./weekly-google-auth');
const { getEventsForWeek } = require('./weekly-calendar');
const { getWeekRange, getTasksForWeek, getKSTToday } = require('./weekly-notion-read');
const { compareDayPlanVsExecution, aggregateWeeklyStats } = require('./weekly-comparator');
const { analyzeWeeklyData } = require('./weekly-analyzer');
const { buildWeeklyReportBlocks } = require('./weekly-blocks');
const { upsertReportPage } = require('./weekly-notion-write');

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  log('=== 주간 리뷰 리포트 생성 시작 ===');

  const today = process.env.REPORT_DATE || getKSTToday();
  const week = getWeekRange(today);
  log(`대상 주간: ${week.monday} (월) ~ ${week.sunday} (일)`);

  log('데이터 수집 중...');
  let calendarClient, calEvents, notionTasks;
  try {
    calendarClient = await getCalendarClient();
    [calEvents, notionTasks] = await Promise.all([
      getEventsForWeek(calendarClient, week.monday, week.sunday),
      getTasksForWeek(week.monday, week.sunday),
    ]);
    log(`구글 캘린더: ${[...calEvents.values()].flat().length}건, 노션 할 일: ${[...notionTasks.values()].flat().length}건`);
  } catch (err) {
    log(`[오류] 데이터 수집 실패: ${err.message}`);
    process.exit(1);
  }

  log('일별 비교 分析 중...');
  const dailyComparisons = [];
  for (const dateStr of week.dates) {
    const calEvts = calEvents.get(dateStr) || [];
    const tasks = notionTasks.get(dateStr) || [];
    const comparison = compareDayPlanVsExecution(calEvts, tasks, dateStr);
    dailyComparisons.push(comparison);
    const calCount = calEvts.length;
    const matchInfo = calCount > 0 ? ` | 📆 ${comparison.matched.length}/${calCount} 매칭` : '';
    log(`  ${comparison.dayOfWeek} ${dateStr}: ${comparison.stats.totalTasks}건 (실행률 ${comparison.stats.completionRate}%)${matchInfo}`);
  }

  const weeklyData = aggregateWeeklyStats(dailyComparisons);
  log(`주간 실행률: ${weeklyData.weekly.completionRate}% (${weeklyData.weekly.completed}/${weeklyData.weekly.totalTasks})`);

  let analysis;
  try {
    analysis = await analyzeWeeklyData(weeklyData);
    log(`AI 分析 완료 (등급: ${analysis.overallGrade})`);
  } catch (err) {
    log(`[오류] AI 分析 실패: ${err.message}`);
    process.exit(1);
  }

  const blocks = buildWeeklyReportBlocks(weeklyData, analysis);
  log(`노션 블록 생성: ${blocks.length}개`);

  try {
    const mondayDate = new Date(week.monday + 'T00:00:00');
    const month = mondayDate.getMonth() + 1;
    const firstDay = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), 1);
    const firstDayOfWeek = firstDay.getDay();
    const weekOfMonth = Math.max(1, Math.ceil((mondayDate.getDate() + (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1)) / 7));
    const dateRange = `${month}월 ${weekOfMonth}주차`;
    await upsertReportPage(dateRange, blocks, today);
    log('노션 업로드 완료');
  } catch (err) {
    log(`[오류] 노션 업로드 실패: ${err.message}`);
    process.exit(1);
  }

  log('=== 주간 리뷰 리포트 생성 완료 ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
