// ─── 헬퍼 (diary-blocks.js와 동일한 패턴) ─────────────────
function rt(content, bold = false, color = 'default') {
  return { type: 'text', text: { content: String(content) }, annotations: { bold, color } };
}
const h1 = c => ({ object: 'block', type: 'heading_1', heading_1: { rich_text: [rt(c)] } });
const h2 = c => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [rt(c)] } });
const p  = parts => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: Array.isArray(parts) ? parts : [rt(parts)] } });
const div = () => ({ object: 'block', type: 'divider', divider: {} });
const callout = (c, emoji = '💡') => ({ object: 'block', type: 'callout', callout: { rich_text: [rt(c)], icon: { type: 'emoji', emoji } } });
const bullet = parts => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: Array.isArray(parts) ? parts : [rt(parts)] } });
const quote = c => ({ object: 'block', type: 'quote', quote: { rich_text: [rt(c)] } });

function painBar(level) {
  if (level === null) return '—';
  const filled = Math.round(level);
  const empty = 10 - filled;
  return '🔴'.repeat(filled) + '⬜'.repeat(Math.max(0, empty)) + `  ${level}/10`;
}

function painColor(level) {
  if (level === null) return 'default';
  if (level <= 3) return 'green';
  if (level <= 6) return 'yellow';
  return 'red';
}

function trendEmoji(trend) {
  return { '개선': '📉✅', '악화': '📈⚠️', '유지': '➡️', '데이터부족': '—' }[trend] || '—';
}

// ─── 메인 빌더 ─────────────────────────────────────────────
function buildRehabReportBlocks(stats, analysis) {
  const blocks = [];
  const { totalSessions, totalDays, dateRange, avgPain, painTrend, firstAvg, secondAvg, topExercises, dayStats, dailyPainTrend } = stats;

  // ── 헤더 ──
  blocks.push(callout(
    `🏃 재활 리포트 | ${dateRange?.start} ~ ${dateRange?.end} | ${totalSessions}회 세션 / ${totalDays}일`,
    '🏃'
  ));
  blocks.push(div());

  // ── 1. 전체 총평 ──
  blocks.push(h1('📊 전체 총평'));
  blocks.push(p(analysis.overallSummary || ''));
  blocks.push(p([
    rt('총 세션: ', true), rt(`${totalSessions}회  `),
    rt('운동한 날: ', true), rt(`${totalDays}일  `),
    rt('평균 통증: ', true),
    rt(avgPain !== null ? `${avgPain}/10` : '—', false, painColor(avgPain)),
  ]));
  blocks.push(p([
    rt('통증 추이: ', true),
    rt(`${trendEmoji(painTrend)} ${painTrend}`, false,
      painTrend === '개선' ? 'green' : painTrend === '악화' ? 'red' : 'default'),
  ]));
  if (firstAvg !== null && secondAvg !== null) {
    blocks.push(p([
      rt('  초반 평균: ', false, 'gray'), rt(`${firstAvg}/10  `, false, painColor(firstAvg)),
      rt('→  후반 평균: ', false, 'gray'), rt(`${secondAvg}/10`, false, painColor(secondAvg)),
    ]));
  }
  blocks.push(div());

  // ── 2. 통증 분석 ──
  blocks.push(h1('🩺 통증 분석'));
  if (analysis.painAnalysis) {
    const pa = analysis.painAnalysis;
    if (pa.currentLevel) blocks.push(p([rt('현재 수준: ', true), rt(pa.currentLevel)]));
    if (pa.trend) blocks.push(p([rt('추이: ', true), rt(pa.trend)]));
    if (pa.insight) blocks.push(callout(pa.insight, '🔍'));
  }
  blocks.push(div());

  // ── 3. 운동 패턴 ──
  blocks.push(h1('🏋️ 운동 패턴'));
  if (topExercises.length > 0) {
    blocks.push(h2('자주 한 운동'));
    for (const ex of topExercises.slice(0, 10)) {
      blocks.push(p([rt(`${ex.name}  `, true), rt(`${ex.count}회`, false, 'gray')]));
    }
  }
  if (analysis.exercisePattern) {
    const ep = analysis.exercisePattern;
    if (ep.consistency) blocks.push(p([rt('운동 일관성: ', true), rt(ep.consistency)]));
    if (ep.insight) blocks.push(callout(ep.insight, '🏋️'));
  }
  blocks.push(div());

  // ── 4. 요일별 패턴 ──
  blocks.push(h1('📆 요일별 패턴'));
  const activeDays = dayStats.filter(d => d.count > 0);
  for (const d of activeDays) {
    blocks.push(p([
      rt(`${d.dayOfWeek}요일 `, true),
      rt(`${d.count}회`, false, 'gray'),
      rt(d.avgPain !== null ? `  통증 평균: ${d.avgPain}/10` : '', false, painColor(d.avgPain)),
    ]));
  }
  if (analysis.weekdayPattern) {
    const wp = analysis.weekdayPattern;
    if (wp.activeDays) blocks.push(p([rt('🏃 활동적인 날: ', true, 'green'), rt(wp.activeDays)]));
    if (wp.restDays) blocks.push(p([rt('💤 휴식 패턴: ', true, 'blue'), rt(wp.restDays)]));
    if (wp.insight) blocks.push(callout(wp.insight, '📆'));
  }
  blocks.push(div());

  // ── 5. 회복 진행 상황 ──
  blocks.push(h1('🌱 회복 진행 상황'));
  if (analysis.recoveryProgress) {
    const rp = analysis.recoveryProgress;
    if (rp.status) blocks.push(p([rt('회복 단계: ', true), rt(rp.status, false, 'blue')]));
    if (rp.positivePoints) { blocks.push(h2('✅ 잘 되고 있는 부분')); blocks.push(p(rp.positivePoints)); }
    if (rp.concerns) { blocks.push(h2('⚠️ 주의 사항')); blocks.push(p(rp.concerns)); }
    if (rp.insight) blocks.push(callout(rp.insight, '🪞'));
  }
  blocks.push(div());

  // ── 6. 재활 제안 ──
  blocks.push(h1('✨ 재활 개선 제안'));
  for (let i = 0; i < (analysis.recommendations || []).length; i++) {
    blocks.push(bullet([rt(`${i + 1}. `, true), rt(analysis.recommendations[i])]));
  }
  blocks.push(div());

  // ── 7. 일별 통증 기록 ──
  blocks.push(h1('📋 일별 기록'));
  for (const d of dailyPainTrend) {
    blocks.push(p([
      rt(`${d.dateStr}(${d.dayOfWeek}) `, true),
      rt(d.avgPain !== null ? `통증 ${d.avgPain}/10 ` : '통증 — ', false, painColor(d.avgPain)),
      rt(d.exercises.join(', ') || '(운동명 없음)', false, 'gray'),
    ]));
  }

  return blocks;
}

module.exports = { buildRehabReportBlocks };
