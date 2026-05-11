require(‘dotenv’).config();

const { Client } = require(’@notionhq/client’);
const { getDiaryConfig } = require(’./diary-config’);

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function getKSTToday() {
return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─── 페이지 본문 텍스트 읽기 ──────────────────────────────
async function getPageBodyText(pageId, maxLen) {
let text = ‘’;
let cursor;
try {
do {
const res = await notion.blocks.children.list({
block_id: pageId, start_cursor: cursor, page_size: 50,
});
for (const block of res.results) {
const richTexts = block[block.type]?.rich_text || block[block.type]?.text || [];
if (Array.isArray(richTexts)) {
text += richTexts.map(t => t.plain_text).join(’’) + ’ ’;
}
if (text.length > maxLen * 2) break;
}
cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor && text.length < maxLen * 2);
} catch { /* 읽기 실패 무시 */ }
return text.trim().slice(0, maxLen);
}

// ─── 일기 페이지 파싱 ─────────────────────────────────────
function parseDiaryPage(page) {
const { DAY_NAMES } = getDiaryConfig();
const props = page.properties;

const dateStr = props[‘Date’]?.date?.start || null;
const comment = (props[‘Comment’]?.rich_text || []).map(t => t.plain_text).join(’’).trim();
const title   = (props[‘Title’]?.title || []).map(t => t.plain_text).join(’’).trim();

let dayOfWeek = null, dayIndex = null;
if (dateStr) {
const d = new Date(dateStr + ‘T00:00:00’);
dayIndex = d.getDay();
dayOfWeek = DAY_NAMES[dayIndex];
}

return { pageId: page.id, dateStr, dayOfWeek, dayIndex, title, comment, bodyText: null };
}

// ─── 기간별 일기 조회 ──────────────────────────────────────
async function getDiaryEntries(startDate, endDate) {
const { DIARY_DB_ID, OUTPUT } = getDiaryConfig();
console.log(`[diary-read] 조회: ${startDate} ~ ${endDate}`);

let allResults = [], cursor;
do {
const res = await notion.databases.query({
database_id: DIARY_DB_ID,
filter: {
and: [
{ property: ‘Date’, date: { on_or_after: startDate } },
{ property: ‘Date’, date: { on_or_before: endDate } },
],
},
sorts: [{ property: ‘Date’, direction: ‘ascending’ }],
start_cursor: cursor,
page_size: 100,
});
allResults.push(…res.results);
cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

console.log(`[diary-read] ${allResults.length}개 로드`);
const entries = allResults.map(parseDiaryPage).filter(e => e.dateStr);

// 본문 텍스트 로드
if (OUTPUT.includeBody && entries.length > 0) {
console.log(’[diary-read] 본문 텍스트 로드 중…’);
for (let i = 0; i < entries.length; i++) {
entries[i].bodyText = await getPageBodyText(entries[i].pageId, OUTPUT.bodyMaxLen);
if ((i + 1) % 5 === 0 || i === entries.length - 1) {
process.stdout.write(`\r  ${i + 1}/${entries.length} 완료`);
}
}
console.log(’’);
}

return entries;
}

// ─── 통계 집계 ────────────────────────────────────────────
function aggregateDiaryStats(entries) {
const { classifyEmotionFromText, classifyTopics, DAY_NAMES, OUTPUT } = getDiaryConfig();

// 각 entry에 감정/주제 분류 추가
const enriched = entries.map(e => {
const fullText = [e.comment, e.bodyText].filter(Boolean).join(’ ’);
return {
…e,
emotionDirection: classifyEmotionFromText(fullText),
topics: classifyTopics(fullText),
fullText,
};
});

const total = enriched.length;
const dateRange = total > 0
? { start: enriched[0].dateStr, end: enriched[enriched.length - 1].dateStr }
: null;

// 감정 분포
const directionCount = { 긍정: 0, 부정: 0, 중립: 0 };
for (const e of enriched) directionCount[e.emotionDirection]++;

// 요일별 감정 분포
const dayStats = Array.from({ length: 7 }, (_, i) => ({
dayIndex: i, dayOfWeek: DAY_NAMES[i],
긍정: 0, 부정: 0, 중립: 0, count: 0,
}));
for (const e of enriched) {
if (e.dayIndex !== null) {
dayStats[e.dayIndex][e.emotionDirection]++;
dayStats[e.dayIndex].count++;
}
}

// 주제 빈도
const topicFreq = {};
for (const e of enriched) {
for (const t of e.topics) topicFreq[t] = (topicFreq[t] || 0) + 1;
}

// 월별 그룹
const byMonth = {};
for (const e of enriched) {
const ym = e.dateStr.slice(0, 7);
if (!byMonth[ym]) byMonth[ym] = [];
byMonth[ym].push(e);
}
const monthlyStats = Object.entries(byMonth).map(([ym, es]) => {
const dir = { 긍정: 0, 부정: 0, 중립: 0 };
es.forEach(e => dir[e.emotionDirection]++);
const dominantEmotion = Object.entries(dir).sort((a, b) => b[1] - a[1])[0][0];
return { ym, count: es.length, direction: dir, dominantEmotion };
});

// 자주 등장 키워드 (단어 빈도)
const wordFreq = {};
for (const e of enriched) {
const words = e.fullText.split(/[\s,.!?。、]+/).filter(w => w.length >= 2);
for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;
}
const topKeywords = Object.entries(wordFreq)
.sort((a, b) => b[1] - a[1])
.slice(0, OUTPUT.keywordCount)
.map(([word, count]) => ({ word, count }));

// 기록 습관 (주간 기록률)
const writingRate = total > 0 ? Math.round((total / Math.max(1, getDaysBetween(dateRange.start, dateRange.end))) * 100) : 0;

return {
total, dateRange, directionCount,
dayStats, monthlyStats, topKeywords, topicFreq, writingRate,
entries: enriched,
};
}

function getDaysBetween(start, end) {
const s = new Date(start), e = new Date(end);
return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

// ─── 테스트 ───────────────────────────────────────────────
async function test() {
const today = getKSTToday();
const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const entries = await getDiaryEntries(threeMonthsAgo, today);
const stats = aggregateDiaryStats(entries);
console.log(`\n총 ${stats.total}개 | 기간: ${stats.dateRange?.start} ~ ${stats.dateRange?.end}`);
console.log(‘감정 분포:’, stats.directionCount);
console.log(‘상위 키워드:’, stats.topKeywords.slice(0, 5));
console.log(‘월별:’, stats.monthlyStats.map(m => `${m.ym}:${m.count}개`).join(’, ’));
}

if (require.main === module) test();

module.exports = { getDiaryEntries, aggregateDiaryStats, getKSTToday };
