require('dotenv').config();

const { getRehabEntries, aggregateRehabStats } = require('./rehab-read');
const { analyzeRehabData } = require('./rehab-analyzer');
const { buildRehabReportBlocks } = require('./rehab-blocks');
const { upsertRehabReportPage } = require('./rehab-write');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getKSTToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 인자 파싱: node rehab-index.js 2026-01-01 2026-01-31
function parseDateArgs() {
  const args = process.argv.slice(2);
  if (args.length >= 2) return { start: args[0], end: args[1] };
  // 기본값: 최근 7일 (주간 리포트)
  const today = getKSTToday();
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start: weekAgo, end: today };
}

async function main() {
  log('=== 재활 리포트 시작 ===');

  const { start, end } = parseDateArgs();
  log(`분석 기간: ${start} ~ ${end}`);

  // 1. 재활 기록 읽기
  let entries;
  try {
    entries = await getRehabEntries(start, end);
    if (entries.length === 0) {
      log('해당 기간에 재활 기록이 없습니다.');
      process.exit(0);
    }
    log(`재활 기록 ${entries.length}개 로드 완료`);
  } catch (err) {
    log(`[오류] 재활 기록 읽기 실패: ${err.message}`);
    process.exit(1);
  }

  // 2. 통계 집계
  const stats = aggregateRehabStats(entries);
  log(`총 ${stats.totalSessions}회 세션 / ${stats.totalDays}일 | 평균 통증: ${stats.avgPain ?? '—'}/10 | 추이: ${stats.painTrend}`);

  // 3. AI 분석
  let analysis;
  try {
    analysis = await analyzeRehabData(stats);
    log('AI 분석 완료');
  } catch (err) {
    log(`[오류] AI 분석 실패: ${err.message}`);
    process.exit(1);
  }

  // 4. 노션 블록 빌드
  const blocks = buildRehabReportBlocks(stats, analysis);
  log(`노션 블록 ${blocks.length}개 생성`);

  // 5. 노션 업로드
  try {
    const pageId = await upsertRehabReportPage(stats, blocks);
    log(`노션 업로드 완료: https://notion.so/${pageId.replace(/-/g, '')}`);
  } catch (err) {
    log(`[오류] 노션 업로드 실패: ${err.message}`);
    process.exit(1);
  }

  log('=== 재활 리포트 완료 ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
