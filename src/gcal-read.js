require('dotenv').config();

const { google } = require('googleapis');
const { getAuthClient } = require('./gcal-auth');

async function getCalendarEvents(startDate, endDate) {
  const auth = await getAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date(startDate + 'T00:00:00+09:00').toISOString();
  const timeMax = new Date(endDate + 'T23:59:59+09:00').toISOString();

  console.log(`[gcal-read] 캘린더 조회: ${startDate} ~ ${endDate}`);

  // 모든 캘린더 목록 조회
  const calListRes = await calendar.calendarList.list();
  const calendars = calListRes.data.items || [];
  console.log(`[gcal-read] 캘린더 ${calendars.length}개 발견`);

  let allEvents = [];
  for (const cal of calendars) {
    let pageToken;
    do {
      const res = await calendar.events.list({
        calendarId: cal.id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        pageToken,
      });
      const items = (res.data.items || []).map(ev => ({ ...ev, _calendarName: cal.summary }));
      allEvents.push(...items);
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  console.log(`[gcal-read] ${allEvents.length}개 이벤트 로드`);

  // 날짜순 정렬 및 중복 제거 (같은 이벤트가 여러 캘린더에 있을 수 있음)
  const seen = new Set();
  allEvents = allEvents.filter(ev => {
    const key = `${ev.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  allEvents.sort((a, b) => {
    const as = a.start?.dateTime || a.start?.date || '';
    const bs = b.start?.dateTime || b.start?.date || '';
    return as.localeCompare(bs);
  });

  console.log(`[gcal-read] ${allEvents.length}개 이벤트 로드`);

  return allEvents.map(ev => {
    const start = ev.start?.dateTime || ev.start?.date || '';
    const end   = ev.end?.dateTime   || ev.end?.date   || '';
    const isAllDay = !ev.start?.dateTime;
    const dateStr = start.slice(0, 10);
    return {
      id: ev.id,
      title: ev.summary || '(제목 없음)',
      start,
      end,
      dateStr,
      isAllDay,
      description: (ev.description || '').slice(0, 200),
      location: ev.location || '',
      calendarName: ev._calendarName || '',
    };
  });
}

function aggregateCalendarStats(events) {
  const byDate = {};
  for (const ev of events) {
    if (!byDate[ev.dateStr]) byDate[ev.dateStr] = [];
    byDate[ev.dateStr].push(ev);
  }

  const byDay = Array(7).fill(null).map(() => []);
  for (const ev of events) {
    const d = new Date(ev.dateStr + 'T00:00:00');
    byDay[d.getDay()].push(ev);
  }

  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStats = byDay.map((evs, i) => ({ dayOfWeek: DAY_NAMES[i], count: evs.length }));

  const titleFreq = {};
  for (const ev of events) {
    const key = ev.title.trim();
    titleFreq[key] = (titleFreq[key] || 0) + 1;
  }
  const topTitles = Object.entries(titleFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([title, count]) => ({ title, count }));

  return { total: events.length, byDate, dayStats, topTitles, events };
}

if (require.main === module) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  getCalendarEvents(weekAgo, today).then(evs => {
    console.log('\n이벤트 목록:');
    evs.forEach(e => console.log(`  ${e.dateStr} ${e.title}`));
  }).catch(console.error);
}

module.exports = { getCalendarEvents, aggregateCalendarStats };
