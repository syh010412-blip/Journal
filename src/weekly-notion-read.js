require('dotenv').config();

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const TODO_DB = process.env.NOTION_TODO_DB_ID;
const CALENDAR_DB = process.env.NOTION_CALENDAR_DB_ID;

function getKSTToday() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getWeekRange(todayStr) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const fmt = date => {
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  const monday = new Date(y, m - 1, d + mondayOffset);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    dates.push(fmt(new Date(y, m - 1, d + mondayOffset + i)));
  }

  return { monday: fmt(monday), sunday: dates[6], dates };
}

function parseTask(page) {
  const props = page.properties;

  const title = (props['할 일']?.title || [])
    .map(t => t.plain_text).join('').trim();

  const timeData = props['시간 ']?.date;
  const startTime = timeData?.start || null;
  const endTime = timeData?.end || null;

  const status = props['상태']?.status?.name || '시작 전';

  const memo = (props['메모']?.rich_text || [])
    .map(t => t.plain_text).join('').trim();

  let startHour = null;
  let endHour = null;
  if (startTime && startTime.includes('T')) {
    const d = new Date(startTime);
    startHour = d.getHours() + d.getMinutes() / 60;
  }
  if (endTime && endTime.includes('T')) {
    const d = new Date(endTime);
    endHour = d.getHours() + d.getMinutes() / 60;
  }

  return { title, startTime, endTime, startHour, endHour, status, memo };
}

async function getTasksForWeek(monday, sunday) {
  const nextDay = new Date(sunday + 'T00:00:00+09:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const beforeDate = nextDay.toISOString().slice(0, 10);

  let allResults = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: TODO_DB,
      filter: {
        and: [
          { property: '시간 ', date: { on_or_after: monday } },
          { property: '시간 ', date: { before: beforeDate } },
        ],
      },
      sorts: [{ property: '시간 ', direction: 'ascending' }],
      start_cursor: cursor,
      page_size: 100,
    });
    allResults.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const tasks = allResults.map(parseTask);

  const byDate = new Map();
  for (const task of tasks) {
    const dateStr = task.startTime ? task.startTime.slice(0, 10) : null;
    if (!dateStr) continue;
    if (!byDate.has(dateStr)) byDate.set(dateStr, []);
    byDate.get(dateStr).push(task);
  }

  return byDate;
}

if (require.main === module) {
  (async () => {
    const today = getKSTToday();
    const week = getWeekRange(today);
    console.log('이번 주:', week);
    const tasks = await getTasksForWeek(week.monday, week.sunday);
    for (const [date, items] of tasks) {
      console.log(`\n=== ${date} (${items.length}개) ===`);
      for (const t of items) {
        const time = t.startTime ? `${t.startTime.slice(11, 16)}~${(t.endTime || '').slice(11, 16)}` : '시간없음';
        console.log(`  [${t.status}] ${time} | ${t.title}`);
      }
    }
  })();
}

module.exports = { getWeekRange, getTasksForWeek, getKSTToday };
