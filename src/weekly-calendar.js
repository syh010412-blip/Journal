require('dotenv').config();

const { getCalendarClient } = require('./weekly-google-auth');
const { getConfig } = require('./weekly-config');

function parseEvent(event, calendarName) {
  const start = event.start.dateTime || event.start.date;
  const end = event.end.dateTime || event.end.date;
  const isAllDay = !event.start.dateTime;

  const startDate = new Date(start);
  const endDate = new Date(end);

  return {
    title: event.summary || '(제목 없음)',
    start,
    end,
    isAllDay,
    startHour: isAllDay ? null : startDate.getHours() + startDate.getMinutes() / 60,
    endHour: isAllDay ? null : endDate.getHours() + endDate.getMinutes() / 60,
    duration: isAllDay ? null : (endDate - startDate) / (1000 * 60),
    calendar: calendarName,
  };
}

async function getEventsForWeek(client, monday, sunday) {
  const timeMin = `${monday}T00:00:00+09:00`;
  const timeMax = `${sunday}T23:59:59+09:00`;

  const { CALENDAR_EXCLUDE } = getConfig();
  const calListRes = await client.calendarList.list();
  const calendars = calListRes.data.items.filter(cal =>
    !CALENDAR_EXCLUDE.some(pat => cal.id.includes(pat) || (cal.summary || '').includes(pat))
  );

  console.log(`[calendar] ${calendars.length}개 캘린더 조회 중...`);

  const allEvents = [];
  const results = await Promise.allSettled(
    calendars.map(async (cal) => {
      const res = await client.events.list({
        calendarId: cal.id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 200,
      });
      const events = (res.data.items || []).map(e => parseEvent(e, cal.summary));
      if (events.length > 0) {
        console.log(`[calendar]   ${cal.summary}: ${events.length}건`);
      }
      return events;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') allEvents.push(...r.value);
  }

  const seen = new Set();
  const unique = [];
  for (const ev of allEvents) {
    const key = `${ev.title}|${ev.start}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(ev);
    }
  }

  const byDate = new Map();
  for (const ev of unique) {
    const dateStr = ev.start.slice(0, 10);
    if (!byDate.has(dateStr)) byDate.set(dateStr, []);
    byDate.get(dateStr).push(ev);
  }

  for (const [, evts] of byDate) {
    evts.sort((a, b) => (a.startHour || 0) - (b.startHour || 0));
  }

  console.log(`[calendar] 총 ${unique.length}건 (${byDate.size}일)`);
  return byDate;
}

if (require.main === module) {
  (async () => {
    const client = await getCalendarClient();
    const events = await getEventsForWeek(client, '2026-04-06', '2026-04-12');
    for (const [date, evts] of events) {
      console.log(`\n=== ${date} (${evts.length}개) ===`);
      for (const e of evts) {
        const time = e.isAllDay ? '종일' : `${e.start.slice(11, 16)}~${e.end.slice(11, 16)}`;
        console.log(`  ${time} | ${e.title} [${e.calendar}]`);
      }
    }
  })();
}

module.exports = { getEventsForWeek };
