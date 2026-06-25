const { getConfig } = require('./weekly-config');

function richText(content, opts = {}) {
  return {
    type: 'text',
    text: { content, link: opts.link ? { url: opts.link } : null },
    annotations: {
      bold: !!opts.bold,
      italic: !!opts.italic,
      strikethrough: false,
      underline: false,
      code: !!opts.code,
      color: opts.color || 'default',
    },
  };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function heading1(text) {
  return {
    object: 'block', type: 'heading_1',
    heading_1: { rich_text: [richText(text)], is_toggleable: false },
  };
}

function heading2(text) {
  return {
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [richText(text)], is_toggleable: false },
  };
}

function heading3(text) {
  return {
    object: 'block', type: 'heading_3',
    heading_3: { rich_text: [richText(text)], is_toggleable: false },
  };
}

function toggleHeading2(text, children = []) {
  return {
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [richText(text)], is_toggleable: true, children },
  };
}

function callout(richTexts, emoji = '📌', color = 'default') {
  return {
    object: 'block', type: 'callout',
    callout: {
      rich_text: Array.isArray(richTexts) ? richTexts : [richText(richTexts)],
      icon: { type: 'emoji', emoji },
      color,
    },
  };
}

function bulletItem(richTexts) {
  return {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: Array.isArray(richTexts) ? richTexts : [richText(richTexts)],
    },
  };
}

function numberedItem(richTexts) {
  return {
    object: 'block', type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: Array.isArray(richTexts) ? richTexts : [richText(richTexts)],
    },
  };
}

function paragraph(richTexts) {
  return {
    object: 'block', type: 'paragraph',
    paragraph: {
      rich_text: Array.isArray(richTexts) ? richTexts : [richText(richTexts)],
    },
  };
}

function tableBlock(headers, rows) {
  const width = headers.length;
  const headerRow = {
    object: 'block', type: 'table_row',
    table_row: { cells: headers.map(h => [richText(h, { bold: true })]) },
  };
  const dataRows = rows.map(row => ({
    object: 'block', type: 'table_row',
    table_row: { cells: row.map(cell => [richText(String(cell))]) },
  }));
  return {
    object: 'block', type: 'table',
    table: {
      table_width: width,
      has_column_header: true,
      has_row_header: false,
      children: [headerRow, ...dataRows],
    },
  };
}

function buildWeeklyReportBlocks(weeklyData, analysis) {
  const { STATUS_EMOJI } = getConfig();
  const { weekly, dailyComparisons, timeSlotAnalysis, habitAnalysis, delays, failures, gapAnalysis, scoreAnalysis } = weeklyData;
  const blocks = [];

  const monday = dailyComparisons[0]?.date || '';
  const sunday = dailyComparisons[dailyComparisons.length - 1]?.date || '';
  const gradeEmoji = { A: '🏆', B: '👍', C: '😐', D: '😟', F: '😰' };

  function scoreBar(score) {
    const filled = Math.round(score / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}점`;
  }

  const wGrade = scoreAnalysis.weeklyGrade;
  blocks.push(callout([
    richText(`${monday} ~ ${sunday} 주간 리포트\n`, { bold: true }),
    richText('주간 점수 ', {}),
    richText(`${scoreAnalysis.weeklyScore}점`, { bold: true, color: 'red' }),
    richText(` (${wGrade}) | 실행률 ${weekly.completionRate}% | 당일완료 ${weekly.successRate}%`),
  ], gradeEmoji[wGrade] || '📊', 'blue_background'));

  blocks.push(divider());
  blocks.push(heading1('📋 주간 총평'));
  blocks.push(callout([richText(analysis.weeklyOverview)], '💬', 'gray_background'));

  const pct = (n) => weekly.actionable > 0 ? `${Math.round(n / weekly.actionable * 100)}%` : '0%';
  blocks.push(tableBlock(
    ['항목', '건수', '비율(실행대상 기준)'],
    [
      ['✅ 완료', String(weekly.completed), pct(weekly.completed)],
      ['⏰ 지연 완료', String(weekly.delayed), pct(weekly.delayed)],
      ['🔵 진행 중', String(weekly.inProgress), pct(weekly.inProgress)],
      ['❌ 못함', String(weekly.failed), pct(weekly.failed)],
      ['⬜ 미진행', String(weekly.pending), pct(weekly.pending)],
      ['🚫 취소', String(weekly.cancelled), '제외'],
      ['📌 참고', String(weekly.reference), '제외'],
      ['📊 실행 대상', String(weekly.actionable), '100%'],
    ]
  ));

  blocks.push(divider());
  blocks.push(heading1('🏅 주간 점수'));

  if (analysis.scoreInsight) {
    blocks.push(callout([richText(analysis.scoreInsight)], '📊', 'gray_background'));
  }

  if (scoreAnalysis.weeklyScoreItems && Object.keys(scoreAnalysis.weeklyScoreItems).length > 0) {
    const itemRows = Object.values(scoreAnalysis.weeklyScoreItems).map(item => [
      item.label, `${item.weight}%`, scoreBar(item.score),
    ]);
    blocks.push(tableBlock(
      ['항목', '가중치', '주간 평균'],
      [...itemRows, ['📊 종합', '100%', scoreBar(scoreAnalysis.weeklyScore)]]
    ));
  }

  const scoredDays = dailyComparisons.filter(d => d.score != null);
  if (scoredDays.length > 0) {
    const dayScoreRows = scoredDays.map(d => {
      const s = d.score;
      const items = s.items;
      const execH = Math.floor(s.totalExecMinutes / 60);
      const execM = s.totalExecMinutes % 60;
      return [
        `${d.dayOfWeek} ${d.date.slice(5)}`,
        `${items.completionRate.score}`,
        `${items.planAdherence.score}`,
        `${items.gapEfficiency.score}`,
        `${items.planExecAlignment.score}`,
        `${items.totalExecTime.score} (${execH}h${execM > 0 ? execM + 'm' : ''})`,
        `${s.total}점`,
      ];
    });
    blocks.push(tableBlock(
      ['날짜', '완료율', '계획이행', '공백효율', '계획일치', '실행시간', '총점'],
      dayScoreRows
    ));
  }

  if (scoreAnalysis.bestDay && scoreAnalysis.worstDay) {
    blocks.push(callout([
      richText(`🏆 Best: ${scoreAnalysis.bestDay.dayOfWeek} ${scoreAnalysis.bestDay.date.slice(5)} (${scoreAnalysis.bestDay.score}점)`, { bold: true }),
      richText('  |  '),
      richText(`📉 Worst: ${scoreAnalysis.worstDay.dayOfWeek} ${scoreAnalysis.worstDay.date.slice(5)} (${scoreAnalysis.worstDay.score}점)`, { bold: true }),
    ], '📊', 'gray_background'));
  }

  blocks.push(divider());
  blocks.push(heading1('📅 일별 비교'));

  for (const day of dailyComparisons) {
    const di = analysis.dailyInsights?.find(d => d.date === day.date);
    const gradeStr = di ? ` [${di.grade}]` : '';
    const emoji = day.stats.completionRate >= 80 ? '✅' : day.stats.completionRate >= 50 ? '🟡' : '🔴';

    const hasCalendar = day.matched.length > 0 || day.plannedOnly.length > 0;
    const calTotal = day.matched.length + day.plannedOnly.length;
    const calMatched = day.matched.length;

    const children = [];
    if (di?.insight) {
      children.push(callout([richText(di.insight)], '💡', 'yellow_background'));
    }

    if (day.score) {
      const s = day.score;
      const execH = Math.floor(s.totalExecMinutes / 60);
      const execM = s.totalExecMinutes % 60;
      children.push(callout([
        richText(`총점 ${s.total}점\n`, { bold: true }),
        ...Object.values(s.items).map(item =>
          richText(`${item.label}: ${item.score}점 (×${item.weight}%)  `)
        ),
        richText(`\n실행 시간: ${execH}시간 ${execM > 0 ? execM + '분' : ''}`),
      ], '🏅', 'blue_background'));
    }

    if (hasCalendar) {
      children.push(heading3(`📆 구글 캘린더 계획 → 실행 (${calMatched}/${calTotal})`));
      const calRows = [];
      for (const m of day.matched) {
        const planTime = m.plan.isAllDay ? '종일' : `${m.plan.start.slice(11, 16)}~${m.plan.end.slice(11, 16)}`;
        const statusE = STATUS_EMOJI[m.execution.status] || '⬜';
        calRows.push([statusE, planTime, m.plan.title, m.execution.title, m.execution.status]);
      }
      for (const p of day.plannedOnly) {
        const planTime = p.isAllDay ? '종일' : `${p.start.slice(11, 16)}~${p.end.slice(11, 16)}`;
        calRows.push(['⚠️', planTime, p.title, '(매칭 없음)', '—']);
      }
      children.push(tableBlock(
        ['상태', '계획 시간', '구글 캘린더(계획)', '노션(실행)', '결과'],
        calRows
      ));
    }

    children.push(heading3('📝 노션 할 일 전체'));
    const taskRows = day.tasks.map(t => {
      const time = t.startTime ? `${t.startTime.slice(11, 16)}~${(t.endTime || '').slice(11, 16)}` : '';
      const statusE = STATUS_EMOJI[t.status] || '⬜';
      return [statusE, time, t.title, t.status];
    });
    if (taskRows.length > 0) {
      children.push(tableBlock(['상태', '시간', '할 일', '결과'], taskRows));
    }

    if (hasCalendar && day.executedOnly.length > 0) {
      children.push(callout([
        richText(`캘린더에 없던 실행 ${day.executedOnly.length}건: `, { bold: true }),
        richText(day.executedOnly.map(t => t.title).join(', ')),
      ], '➕', 'blue_background'));
    }

    if (day.gaps.warnings.length > 0) {
      children.push(callout([
        richText(`공백 경고 ${day.gaps.warnings.length}건 (총 ${day.gaps.totalGapMinutes}분)\n`, { bold: true }),
        ...day.gaps.warnings.map(w =>
          richText(`${w.from}~${w.to} (${w.minutes}분) "${w.afterTask}" → "${w.beforeTask}"\n`)
        ),
      ], '⏳', 'orange_background'));
    }

    const scoreStr = day.score ? ` ${day.score.total}점` : '';
    const calInfo = hasCalendar ? ` | 📆 ${calMatched}/${calTotal}` : '';
    blocks.push(toggleHeading2(
      `${day.dayOfWeek} ${day.date.slice(5)} —${scoreStr} (실행률 ${day.stats.completionRate}%) ${emoji}${gradeStr}${calInfo}`,
      children
    ));
  }

  blocks.push(divider());
  blocks.push(heading1('⏰ 시간대별 집중도'));

  if (analysis.timeSlotAnalysis) {
    const ta = analysis.timeSlotAnalysis;
    if (ta.bestSlot) {
      blocks.push(callout([
        richText(`Best: ${ta.bestSlot.name} — ${ta.bestSlot.rate}%\n`, { bold: true }),
        richText(ta.bestSlot.insight),
      ], '🟢', 'green_background'));
    }
    if (ta.worstSlot) {
      blocks.push(callout([
        richText(`Worst: ${ta.worstSlot.name} — ${ta.worstSlot.rate}%\n`, { bold: true }),
        richText(ta.worstSlot.insight),
      ], '🔴', 'red_background'));
    }
  }

  if (timeSlotAnalysis.length > 0) {
    blocks.push(tableBlock(
      ['시간대', '총 건수', '완료', '완료율'],
      timeSlotAnalysis.map(s => [
        `${s.name} (${s.label})`, String(s.total), String(s.completed), `${s.rate}%`,
      ])
    ));
  }

  if (analysis.timeSlotAnalysis?.recommendation) {
    blocks.push(paragraph([richText('💡 ', { bold: true }), richText(analysis.timeSlotAnalysis.recommendation)]));
  }

  blocks.push(divider());
  blocks.push(heading1('🔄 습관 트래커'));

  if (analysis.habitReport?.summary) {
    blocks.push(callout([richText(analysis.habitReport.summary)], '📝', 'gray_background'));
  }

  const dayHeaders = ['습관', '월', '화', '수', '목', '금', '토', '일', '완료율'];
  const habitRows = habitAnalysis.map(h => {
    const weekDates = dailyComparisons.map(d => d.date);
    const dayStatuses = weekDates.map(date => {
      const entry = h.entries.find(e => e.date === date);
      return entry ? (STATUS_EMOJI[entry.status] || '⬜') : '—';
    });
    return [h.name, ...dayStatuses, `${h.rate}%`];
  });

  if (habitRows.length > 0) {
    blocks.push(tableBlock(dayHeaders, habitRows));
  }

  if (analysis.habitReport?.habits) {
    for (const h of analysis.habitReport.habits) {
      if (h.recommendation) {
        blocks.push(bulletItem([
          richText(`${h.name}`, { bold: true }),
          richText(` (${h.rate}%): ${h.recommendation}`),
        ]));
      }
    }
  }

  blocks.push(divider());
  blocks.push(heading1('📊 패턴 分析'));

  if (analysis.patterns) {
    blocks.push(heading2('⏰ 지연 패턴'));
    blocks.push(paragraph([richText(analysis.patterns.delays)]));
    for (const d of delays) {
      blocks.push(bulletItem([
        richText(`${d.dayOfWeek} `, { bold: true }),
        richText(`${d.startTime?.slice(11, 16) || ''} ${d.title}`),
      ]));
    }

    blocks.push(heading2('❌ 실패 패턴'));
    blocks.push(paragraph([richText(analysis.patterns.failures)]));
    for (const f of failures) {
      blocks.push(bulletItem([
        richText(`${f.dayOfWeek} `, { bold: true }),
        richText(`${f.startTime?.slice(11, 16) || ''} ${f.title}`),
      ]));
    }

    if (analysis.patterns.gaps) {
      blocks.push(heading2('⏳ 공백 시간 패턴'));
      blocks.push(paragraph([richText(analysis.patterns.gaps)]));
    }
  }

  blocks.push(divider());
  blocks.push(heading1('⏳ 공백 시간 分析'));

  if (analysis.gapReport) {
    blocks.push(callout([richText(analysis.gapReport.summary)], '🕐', 'orange_background'));

    const gapRows = gapAnalysis.dailyGaps
      .filter(d => d.totalGapMinutes > 0)
      .map(d => [
        `${d.dayOfWeek} ${d.date.slice(5)}`,
        `${d.totalGapMinutes}분`,
        `${d.warningCount}건`,
        d.warnings.map(w => `${w.from}~${w.to}(${w.minutes}분)`).join(', ') || '—',
      ]);

    if (gapRows.length > 0) {
      blocks.push(tableBlock(
        ['날짜', '총 공백', '경고', '주요 공백 구간'],
        gapRows
      ));
    }

    if (analysis.gapReport.worstDay) {
      blocks.push(bulletItem([
        richText('최악의 날: ', { bold: true }),
        richText(`${analysis.gapReport.worstDay.date} (${analysis.gapReport.worstDay.totalMinutes}분) — ${analysis.gapReport.worstDay.insight}`),
      ]));
    }

    if (analysis.gapReport.recommendation) {
      blocks.push(paragraph([richText('💡 ', { bold: true }), richText(analysis.gapReport.recommendation)]));
    }
  }

  blocks.push(divider());
  blocks.push(heading1('💡 다음 주 추천'));

  if (analysis.nextWeekRecommendations) {
    for (const rec of analysis.nextWeekRecommendations) {
      blocks.push(numberedItem([richText(rec)]));
    }
  }

  blocks.push(divider());
  blocks.push(callout([richText('Claude AI가 분析한 주간 리포트입니다.')], '🤖', 'gray_background'));

  return blocks;
}

module.exports = { buildWeeklyReportBlocks };
