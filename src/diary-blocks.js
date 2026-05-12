// ─── 헬퍼 ──────────────────────────────────────────────────
function rt(content, bold = false, color = 'default') {
return { type: 'text', text: { content: String(content) }, annotations: { bold, color } };
}
const h1 = c => ({ object: 'block', type: 'heading_1', heading_1: { rich_text: [rt(c)] } });
const h2 = c => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [rt(c)] } });
const h3 = c => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: [rt(c)] } });
const p  = parts => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: Array.isArray(parts) ? parts : [rt(parts)] } });
const div = () => ({ object: 'block', type: 'divider', divider: {} });
const callout = (c, emoji = '💡') => ({ object: 'block', type: 'callout', callout: { rich_text: [rt(c)], icon: { type: 'emoji', emoji } } });
const bullet = parts => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: Array.isArray(parts) ? parts : [rt(parts)] } });
const quote = c => ({ object: 'block', type: 'quote', quote: { rich_text: [rt(c)] } });

function bar(pos, neg, neu) {
const total = pos + neg + neu || 1;
const p = Math.round(pos / total * 10);
const ng = Math.round(neg / total * 10);
const n = 10 - p - ng;
return '🟢'.repeat(p) + '🔴'.repeat(ng) + '⬜'.repeat(Math.max(0, n));
}

// ─── 메인 빌더 ─────────────────────────────────────────────
function buildDiaryReportBlocks(stats, analysis, calStats) {
const blocks = [];
const { total, dateRange, directionCount, monthlyStats, dayStats, topKeywords, topicFreq, writingRate } = stats;

const calTotal = calStats?.total || 0;
// ── 헤더 ──
blocks.push(callout(
`📔 일기 ${total}개 + 📆 캘린더 ${calTotal}건 | ${dateRange?.start} ~ ${dateRange?.end} | 기록률 ${writingRate}%`,
'📔'
));
blocks.push(div());

// ── 1. 전체 총평 ──
blocks.push(h1('📊 전체 총평'));
blocks.push(p(analysis.overallSummary || ''));
blocks.push(p([
rt('긍정 ', true, 'green'), rt(`${directionCount['긍정']}개  `),
rt('부정 ', true, 'red'),   rt(`${directionCount['부정']}개  `),
rt('중립 ', true, 'gray'),  rt(`${directionCount['중립']}개`),
]));
blocks.push(p(bar(directionCount['긍정'], directionCount['부정'], directionCount['중립'])));
blocks.push(div());

// ── 2. 기록 습관 ──
blocks.push(h1('📝 기록 습관'));
blocks.push(p([rt('기록률: ', true), rt(`${writingRate}%`, false, writingRate >= 70 ? 'green' : writingRate >= 40 ? 'yellow' : 'red')]));
if (analysis.recordingHabit) {
blocks.push(p(analysis.recordingHabit.insight || ''));
if (analysis.recordingHabit.recommendation) {
blocks.push(callout(analysis.recordingHabit.recommendation, '✍️'));
}
}
blocks.push(div());

// ── 3. 감정 분석 ──
blocks.push(h1('💜 감정 패턴 분석'));
if (analysis.emotionAnalysis) {
const ea = analysis.emotionAnalysis;
if (ea.overallTone) blocks.push(p([rt('전체 톤: ', true), rt(ea.overallTone)]));
if (ea.positivePattern) {
blocks.push(h2('긍정 패턴 🌟'));
blocks.push(p(ea.positivePattern));
}
if (ea.negativePattern) {
blocks.push(h2('부정 패턴 😔'));
blocks.push(p(ea.negativePattern));
}
if (ea.insight) blocks.push(callout(ea.insight, '🔍'));
}
blocks.push(div());

// ── 4. 요일별 패턴 ──
blocks.push(h1('📆 요일별 패턴'));
const activeDays = dayStats.filter(d => d.count > 0);
for (const d of activeDays) {
blocks.push(p([
rt(`${d.dayOfWeek}요일 `, true),
rt(bar(d['긍정'], d['부정'], d['중립']), false, 'gray'),
rt(`  ${d.count}건`, false, 'gray'),
]));
}
if (analysis.weekdayPattern) {
const wp = analysis.weekdayPattern;
blocks.push(p([
rt('🌟 좋은 날: ', true, 'green'), rt(`${wp.bestDay?.dayOfWeek}요일 — ${wp.bestDay?.reason || ''}  `),
]));
blocks.push(p([
rt('😔 힘든 날: ', true, 'red'), rt(`${wp.hardDay?.dayOfWeek}요일 — ${wp.hardDay?.reason || ''}`),
]));
if (wp.insight) blocks.push(callout(wp.insight, '📆'));
}
blocks.push(div());

// ── 5. 주제 분석 ──
if (analysis.topicAnalysis || Object.keys(topicFreq).length > 0) {
blocks.push(h1('🏷️ 자주 다룬 주제'));
const topics = Object.entries(topicFreq).sort((a, b) => b[1] - a[1]);
for (const [topic, count] of topics) {
blocks.push(p([rt(`${topic}  `, true), rt(`${count}회`, false, 'gray')]));
}
if (analysis.topicAnalysis?.insight) {
blocks.push(callout(analysis.topicAnalysis.insight, '🏷️'));
}
blocks.push(div());
}

// ── 6. 월별 추이 ──
if (monthlyStats.length > 1) {
blocks.push(h1('📅 월별 감정 추이'));
for (const m of monthlyStats) {
const trend = analysis.monthlyTrend?.find(t => t.ym === m.ym);
blocks.push(h3(`${m.ym}  (${m.count}개)`));
blocks.push(p([
rt('주요 감정: ', true), rt(m.dominantEmotion + '  '),
rt(bar(m.direction['긍정'], m.direction['부정'], m.direction['중립'])),
]));
if (trend?.summary) blocks.push(quote(trend.summary));
if (trend?.highlight) blocks.push(p([rt('💡 ', false), rt(trend.highlight, false, 'gray')]));
}
blocks.push(div());
}

// ── 7. 자주 쓴 단어 ──
if (topKeywords.length > 0) {
blocks.push(h1('🔤 자주 쓴 단어'));
blocks.push(p([
rt(topKeywords.slice(0, 20).map(k => `${k.word}(${k.count})`).join('  ·  '), false, 'gray')
]));
blocks.push(div());
}

// ── 8. 성장 포인트 ──
if (analysis.growthPoints) {
blocks.push(h1('🌱 성장 포인트'));
const gp = analysis.growthPoints;
if (gp.strengths) { blocks.push(h2('💪 강점')); blocks.push(p(gp.strengths)); }
if (gp.challenges) { blocks.push(h2('🔧 개선 포인트')); blocks.push(p(gp.challenges)); }
if (gp.insight) blocks.push(callout(gp.insight, '🪞'));
blocks.push(div());
}

// ── 9. 자기돌봄 제안 ──
blocks.push(h1('✨ 자기돌봄 제안'));
for (let i = 0; i < (analysis.recommendations || []).length; i++) {
blocks.push(bullet([rt(`${i + 1}. `, true), rt(analysis.recommendations[i])]));
}
blocks.push(div());

// ── 9.5 Google Calendar 인사이트 ──
if (calStats && calStats.total > 0) {
blocks.push(h1('📆 Google Calendar 생활 패턴'));
if (analysis.calendarInsight) {
const ci = analysis.calendarInsight;
if (ci.summary) blocks.push(p(ci.summary));
if (ci.activityBalance) {
blocks.push(h2('⚖️ 활동 균형'));
blocks.push(p(ci.activityBalance));
}
if (ci.suggestion) blocks.push(callout(ci.suggestion, '📆'));
}

blocks.push(h2('📋 주간 캘린더 요약'));
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const byDate = calStats.byDate;
const dateEntries = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
for (const [date, evs] of dateEntries) {
const d = new Date(date + 'T00:00:00');
const day = DAY_NAMES[d.getDay()];
blocks.push(bullet([
rt(`${date}(${day}요일)  `, true),
rt(evs.map(e => e.title).join(' · '), false, 'gray'),
]));
}

if (calStats.topTitles.length > 0) {
blocks.push(h2('🔁 자주 한 활동'));
blocks.push(p([
rt(calStats.topTitles.slice(0, 10).map(t => `${t.title}(${t.count}회)`).join('  ·  '), false, 'gray'),
]));
}
blocks.push(div());
}

// ── 10. 일별 기록 로그 (접이식) ──
blocks.push(h1('📋 일별 기록 로그'));
for (const e of stats.entries) {
const emotionEmoji = { 긍정: '🟢', 부정: '🔴', 중립: '⬜' }[e.emotionDirection] || '⬜';
blocks.push(bullet([
rt(`${e.dateStr}(${e.dayOfWeek}) ${emotionEmoji} `, true),
rt(e.comment ? `"${e.comment.slice(0, 60)}${e.comment.length > 60 ? '...' : ''}"` : '(코멘트 없음)', false, 'gray'),
]));
}

return blocks;
}

module.exports = { buildDiaryReportBlocks };
