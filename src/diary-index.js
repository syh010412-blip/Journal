require('dotenv').config();

const { getDiaryEntries, aggregateDiaryStats, getKSTToday } = require('./diary-read');
const { getCalendarEvents, aggregateCalendarStats } = require('./gcal-read');
const { analyzeDiaryData } = require('./diary-analyzer');
const { buildDiaryReportBlocks } = require('./diary-blocks');
const { upsertDiaryReportPage } = require('./diary-write');

function log(msg) {
console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 인자 파싱: node diary-index.js 2026-01-01 2026-03-31
function parseDateArgs() {
const args = process.argv.slice(2);
if (args.length >= 2) {
return { start: args[0], end: args[1] };
}
// 기본값: 최근 7일 (주간 리포트)
const today = getKSTToday();
const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
.toISOString().slice(0, 10);
return { start: weekAgo, end: today };
}

async function main() {
log('=== 일기 분석 리포트 시작 ===');

const { start, end } = parseDateArgs();
log(`분석 기간: ${start} ~ ${end}`);

// 1. 일기 + 캘린더 병렬 로드
let entries = [], calEvents = [];
[entries, calEvents] = await Promise.all([
  getDiaryEntries(start, end).catch(err => {
    log(`[경고] Notion 일기 로드 실패 (건너뜀): ${err.message}`);
    return [];
  }),
  getCalendarEvents(start, end).catch(err => {
    log(`[경고] Google Calendar 로드 실패 (건너뜀): ${err.message}`);
    return [];
  }),
]);
if (entries.length === 0 && calEvents.length === 0) {
  log('해당 기간에 일기와 캘린더 데이터가 없습니다.');
  process.exit(0);
}
log(`일기 ${entries.length}개, 캘린더 이벤트 ${calEvents.length}개 로드 완료`);

// 2. 통계 집계
const stats = aggregateDiaryStats(entries);
const calStats = aggregateCalendarStats(calEvents);
log(`감정 분포 — 긍정:${stats.directionCount['긍정']} 부정:${stats.directionCount['부정']} 중립:${stats.directionCount['중립']}`);
log(`기록률: ${stats.writingRate}%  |  캘린더 이벤트: ${calStats.total}개`);

// 3. AI 분석
let analysis;
try {
analysis = await analyzeDiaryData(stats, calStats);
log('AI 분석 완료');
} catch (err) {
log(`[오류] AI 분석 실패: ${err.message}`);
process.exit(1);
}

// 4. 노션 블록 빌드
const blocks = buildDiaryReportBlocks(stats, analysis, calStats);
log(`노션 블록 ${blocks.length}개 생성`);

// 5. 노션 업로드
try {
const pageId = await upsertDiaryReportPage(stats, blocks);
log(`노션 업로드 완료: https://notion.so/${pageId.replace(/-/g, '')}`);
} catch (err) {
log(`[오류] 노션 업로드 실패: ${err.message}`);
process.exit(1);
}

log('=== 일기 분석 리포트 완료 ===');
}

main().catch(err => {
console.error('[FATAL]', err);
process.exit(1);
});
