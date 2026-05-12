require('dotenv').config();

const { Client } = require('@notionhq/client');
const { getDiaryConfig } = require('./diary-config');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

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
console.log(`[diary-write] 블록: ${Math.min(i + CHUNK, blocks.length)}/${blocks.length}`);
}
}

async function upsertDiaryReportPage(stats, blocks) {
const { REPORT_DB_ID } = getDiaryConfig();
if (!REPORT_DB_ID) throw new Error('리포트_DB_ID가 설정되지 않았습니다. diary-config.txt를 확인하세요.');

const { dateRange } = stats;
const startDate = dateRange?.start;
// 제목 형식: 주간 리포트 YYYY.MM.DD (시작일 기준)
const title = `주간 리포트 ${startDate?.replace(/-/g, '.')}`;

console.log(`[diary-write] 페이지: "${title}"`);
const existing = await findExistingPage(REPORT_DB_ID, title);

if (existing) {
console.log('[diary-write] 기존 페이지 업데이트...');
await clearPageBlocks(existing.id);
await appendBlocksInChunks(existing.id, blocks);
console.log('[diary-write] 업데이트 완료');
return existing.id;
}

const page = await notion.pages.create({
parent: { database_id: REPORT_DB_ID },
icon: { type: 'emoji', emoji: '📔' },
properties: {
'리포트 명': { title: [{ text: { content: title } }] },
'분석 날짜': { date: { start: startDate } },
},
});

await appendBlocksInChunks(page.id, blocks);
console.log('[diary-write] 새 페이지 생성 완료');
return page.id;
}

module.exports = { upsertDiaryReportPage };
