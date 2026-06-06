require('dotenv').config();

const { Client } = require('@notionhq/client');
const { getDiaryConfig } = require('./diary-config');

const { getDiaryEntries, aggregateDiaryStats, getKSTToday } = require('./diary-read');
const { analyzeDiaryData } = require('./diary-analyzer');
const { buildDiaryReportBlocks } = require('./diary-blocks');

const { getRehabEntries, aggregateRehabStats } = require('./rehab-read');
const { analyzeRehabData } = require('./rehab-analyzer');
const { buildRehabReportBlocks } = require('./rehab-blocks');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseDateArgs() {
  const args = process.argv.slice(2);
  if (args.length >= 2) return { start: args[0], end: args[1] };
  const today = getKSTToday();
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start: weekAgo, end: today };
}

// ─── 통합 리포트 Notion 페이지 저장 ───────────────────────
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

async function upsertCombinedReportPage(dateRange, blocks) {
  const { REPORT_DB_ID } = getDiaryConfig();
  if (!REPORT_DB_ID) throw new Error('리포트_DB_ID가 설정되지 않았습니다.');

  const title = `주간 통합 리포트 ${dateRange.start?.replace(/-/g, '.')}`;
  log(`페이지: "${title}"`);

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
    icon: { type: 'emoji', emoji: '📊' },
    properties: {
      '리포트 명': { title: [{ text: { content: title } }] },
      '분석 날짜': { date: { start: dateRange.start } },
    },
  });
  await appendBlocksInChunks(page.id, blocks);
  log('새 페이지 생성 완료');
  return page.id;
}

// ─── 섹션 구분 블록 ────────────────────────────────────────
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

// ─── 메인 ─────────────────────────────────────────────────
async function main() {
  log('=== 주간 통합 리포트 시작 ===');

  const { start, end } = parseDateArgs();
  log(`분석 기간: ${start} ~ ${end}`);

  // 1. 일기 + 재활 기록 병렬 조회
  log('데이터 조회 중…');
  const [diaryEntries, rehabEntries] = await Promise.allSettled([
    getDiaryEntries(start, end),
    getRehabEntries(start, end),
  ]);

  const hasDiary = diaryEntries.status === 'fulfilled' && diaryEntries.value.length > 0;
  const hasRehab = rehabEntries.status === 'fulfilled' && rehabEntries.value.length > 0;

  if (!hasDiary && !hasRehab) {
    log('해당 기간에 일기와 재활 기록 모두 없습니다.');
    process.exit(0);
  }

  if (diaryEntries.status === 'rejected') log(`[경고] 일기 조회 실패: ${diaryEntries.reason?.message}`);
  if (rehabEntries.status === 'rejected') log(`[경고] 재활 기록 조회 실패: ${rehabEntries.reason?.message}`);

  // 2. 통계 집계
  const diaryStats = hasDiary ? aggregateDiaryStats(diaryEntries.value) : null;
  const rehabStats = hasRehab ? aggregateRehabStats(rehabEntries.value) : null;

  if (diaryStats) log(`일기 ${diaryStats.total}개 | 감정: 긍정 ${diaryStats.directionCount['긍정']} 부정 ${diaryStats.directionCount['부정']} 중립 ${diaryStats.directionCount['중립']}`);
  if (rehabStats) log(`재활 ${rehabStats.totalSessions}회 세션 | 평균 통증: ${rehabStats.avgPain ?? '—'}/10 | 추이: ${rehabStats.painTrend}`);

  // 3. AI 분석 병렬 실행
  log('AI 분석 중…');
  const [diaryAnalysis, rehabAnalysis] = await Promise.allSettled([
    hasDiary ? analyzeDiaryData(diaryStats) : Promise.resolve(null),
    hasRehab ? analyzeRehabData(rehabStats) : Promise.resolve(null),
  ]);

  if (diaryAnalysis.status === 'rejected') log(`[경고] 일기 분석 실패: ${diaryAnalysis.reason?.message}`);
  if (rehabAnalysis.status === 'rejected') log(`[경고] 재활 분석 실패: ${rehabAnalysis.reason?.message}`);

  // 4. 블록 조합
  const combinedBlocks = [];

  // 커버 헤더
  combinedBlocks.push({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `📊 주간 통합 리포트  |  ${start} ~ ${end}` } }],
      icon: { type: 'emoji', emoji: '📊' },
      color: 'blue_background',
    },
  });

  // 일기 섹션
  if (hasDiary && diaryAnalysis.status === 'fulfilled' && diaryAnalysis.value) {
    combinedBlocks.push(...sectionHeader('📔', '일기 분석'));
    const diaryBlocks = buildDiaryReportBlocks(diaryStats, diaryAnalysis.value);
    // 일기 블록의 첫 callout(헤더)은 이미 섹션 헤더로 대체했으므로 제거
    combinedBlocks.push(...diaryBlocks.slice(1));
  } else if (hasDiary) {
    combinedBlocks.push(...sectionHeader('📔', '일기 분석'));
    combinedBlocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'AI 분석을 불러오지 못했습니다.' } }] } });
  }

  // 재활 섹션
  if (hasRehab && rehabAnalysis.status === 'fulfilled' && rehabAnalysis.value) {
    combinedBlocks.push(...sectionHeader('🏃', '재활 기록 분석'));
    const rehabBlocks = buildRehabReportBlocks(rehabStats, rehabAnalysis.value);
    combinedBlocks.push(...rehabBlocks.slice(1));
  } else if (hasRehab) {
    combinedBlocks.push(...sectionHeader('🏃', '재활 기록 분석'));
    combinedBlocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'AI 분석을 불러오지 못했습니다.' } }] } });
  }

  log(`노션 블록 ${combinedBlocks.length}개 생성`);

  // 5. 노션 업로드
  const dateRange = {
    start: diaryStats?.dateRange?.start || rehabStats?.dateRange?.start || start,
    end: diaryStats?.dateRange?.end || rehabStats?.dateRange?.end || end,
  };

  try {
    const pageId = await upsertCombinedReportPage(dateRange, combinedBlocks);
    log(`노션 업로드 완료: https://notion.so/${pageId.replace(/-/g, '')}`);
  } catch (err) {
    log(`[오류] 노션 업로드 실패: ${err.message}`);
    process.exit(1);
  }

  log('=== 주간 통합 리포트 완료 ===');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
