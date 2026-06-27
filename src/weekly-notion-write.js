require('dotenv').config();

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const REPORT_DB = process.env.NOTION_REPORT_DB_ID;

async function findExistingPage(title) {
  const res = await notion.databases.query({
    database_id: REPORT_DB,
    filter: { property: '제목', title: { equals: title } },
    page_size: 1,
  });
  return res.results[0] || null;
}

async function clearPageBlocks(pageId) {
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    for (const block of res.results) {
      await notion.blocks.delete({ block_id: block.id });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
}

async function appendBlocksInChunks(pageId, blocks) {
  const CHUNK = 100;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const chunk = blocks.slice(i, i + CHUNK);
    await notion.blocks.children.append({ block_id: pageId, children: chunk });
    console.log(`[notion] 블록 삽입: ${Math.min(i + CHUNK, blocks.length)}/${blocks.length}`);
  }
}

async function upsertReportPage(dateRange, blocks, analysisDate) {
  const title = `${dateRange} 주간 리포트`;
  console.log(`[notion] 페이지 조회: "${title}"`);

  const existing = await findExistingPage(title);

  if (existing) {
    console.log('[notion] 기존 페이지 업데이트 중...');
    await notion.pages.update({
      page_id: existing.id,
      icon: { type: 'emoji', emoji: '📊' },
    });
    await clearPageBlocks(existing.id);
    await appendBlocksInChunks(existing.id, blocks);
    console.log('[notion] 기존 페이지 업데이트 완료');
    return existing.id;
  }

  console.log('[notion] 새 페이지 생성 중...');
  const page = await notion.pages.create({
    parent: { database_id: REPORT_DB },
    icon: { type: 'emoji', emoji: '📊' },
    properties: {
      '제목': { title: [{ text: { content: title } }] },
      '분析 일자': { date: { start: analysisDate } },
    },
  });

  await appendBlocksInChunks(page.id, blocks);
  console.log('[notion] 새 페이지 생성 완료');
  return page.id;
}

module.exports = { upsertReportPage };
