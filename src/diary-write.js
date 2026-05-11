require(‘dotenv’).config();

const { Client } = require(’@notionhq/client’);
const { getDiaryConfig } = require(’./diary-config’);

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ─── 리포트 DB 자동 생성 ──────────────────────────────────
async function ensureReportDb() {
const config = getDiaryConfig();
if (config.REPORT_DB_ID) return config.REPORT_DB_ID;

console.log(’[diary-write] 리포트 DB 생성 중…’);

// 워크스페이스 루트에 부모 페이지 없이 생성하기 위해
// 먼저 워크스페이스 루트 페이지를 찾거나 직접 생성
const page = await notion.pages.create({
parent: { type: ‘workspace’, workspace: true },
icon: { type: ‘emoji’, emoji: ‘📔’ },
properties: {
title: { title: [{ text: { content: ‘📔 일기 분석 리포트’ } }] },
},
});

const db = await notion.databases.create({
parent: { type: ‘page_id’, page_id: page.id },
icon: { type: ‘emoji’, emoji: ‘📊’ },
title: [{ type: ‘text’, text: { content: ‘일기 분석 결과’ } }],
properties: {
‘제목’:     { title: {} },
‘분석 기간’: { rich_text: {} },
‘분석 일자’: { date: {} },
‘총 일기 수’: { number: { format: ‘number’ } },
‘기록률’:   { rich_text: {} },
},
});

config.saveReportDbId(db.id);
console.log(’[diary-write] 리포트 DB 생성 완료:’, db.id);
return db.id;
}

async function findExistingPage(dbId, title) {
const res = await notion.databases.query({
database_id: dbId,
filter: { property: ‘제목’, title: { equals: title } },
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
const dbId = await ensureReportDb();
const { dateRange, total, writingRate } = stats;
const title = `${dateRange?.start} ~ ${dateRange?.end} 일기 분석`;

console.log(`[diary-write] 페이지: "${title}"`);
const existing = await findExistingPage(dbId, title);

if (existing) {
console.log(’[diary-write] 기존 페이지 업데이트…’);
await clearPageBlocks(existing.id);
await appendBlocksInChunks(existing.id, blocks);
console.log(’[diary-write] 업데이트 완료’);
return existing.id;
}

const page = await notion.pages.create({
parent: { database_id: dbId },
icon: { type: ‘emoji’, emoji: ‘📔’ },
properties: {
‘제목’:     { title: [{ text: { content: title } }] },
‘분석 기간’: { rich_text: [{ text: { content: `${dateRange?.start} ~ ${dateRange?.end}` } }] },
‘분석 일자’: { date: { start: new Date().toISOString().slice(0, 10) } },
‘총 일기 수’: { number: total },
‘기록률’:   { rich_text: [{ text: { content: `${writingRate}%` } }] },
},
});

await appendBlocksInChunks(page.id, blocks);
console.log(’[diary-write] 새 페이지 생성 완료’);
return page.id;
}

module.exports = { upsertDiaryReportPage };
