const { getConfig } = require('./weekly-config');

function normalize(title) {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

function timeOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return 0;
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd || aStart + 1, bEnd || bStart + 1);
  if (overlapEnd <= overlapStart) return 0;
  const overlap = overlapEnd - overlapStart;
  const aLen = (aEnd || aStart + 1) - aStart;
  const bLen = (bEnd || bStart + 1) - bStart;
  return overlap / Math.min(aLen, bLen);
}

function hourToHHMM(h) {
  const hh = String(Math.floor(h)).padStart(2, '0');
  const mm = String(Math.round((h % 1) * 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

function computeGaps(tasks, gapConfig) {
  const { warningMinutes, activeStart, activeEnd } = gapConfig;

  const timed = tasks
    .filter(t => t.startHour != null && t.endHour != null)
    .sort((a, b) => a.startHour - b.startHour);

  if (timed.length === 0) return { all: [], warnings: [], totalGapMinutes: 0 };

  const gaps = [];
  for (let i = 0; i < timed.length - 1; i++) {
    const curEnd = timed[i].endHour;
    const nextStart = timed[i + 1].startHour;
    const gapHours = nextStart - curEnd;
    const gapMinutes = Math.round(gapHours * 60);

    if (curEnd < activeStart || nextStart > activeEnd) continue;
    if (gapMinutes <= 0) continue;

    gaps.push({
      afterTask: timed[i].title,
      beforeTask: timed[i + 1].title,
      from: hourToHHMM(curEnd),
      to: hourToHHMM(nextStart),
      minutes: gapMinutes,
    });
  }

  const warnings = gaps.filter(g => g.minutes >= warningMinutes);
  const totalGapMinutes = gaps.reduce((sum, g) => sum + g.minutes, 0);

  return { all: gaps, warnings, totalGapMinutes };
}

function computeDayScore(day) {
  const { SCORE_WEIGHTS, SCORE_SETTINGS, GAP_CONFIG, STATUS_GROUPS } = getConfig();
  const { matched, plannedOnly, tasks, gaps, stats } = day;

  const doneStatuses = [
    ...(STATUS_GROUPS.COMPLETED || []),
    ...(STATUS_GROUPS.DELAYED || []),
  ];
  const excludeStatuses = [
    ...(STATUS_GROUPS.CANCELLED || []),
    ...(STATUS_GROUPS.REFERENCE || []),
  ];

  const completionRate = stats.completionRate;

  const calTotal = matched.length + plannedOnly.length;
  let planAdherence = 100;
  if (calTotal > 0) {
    const calDone = matched.filter(m => doneStatuses.includes(m.execution.status)).length;
    planAdherence = Math.round(calDone / calTotal * 100);
  }

  const activeWindowMin = (GAP_CONFIG.activeEnd - GAP_CONFIG.activeStart) * 60;
  let gapEfficiency = 100;
  if (activeWindowMin > 0 && tasks.length > 0) {
    const gapPct = (gaps.totalGapMinutes / activeWindowMin) * 100;
    const tolerance = SCORE_SETTINGS.gapTolerancePct;
    if (gapPct <= tolerance) {
      gapEfficiency = 100;
    } else {
      gapEfficiency = Math.max(0, Math.round(100 - (gapPct - tolerance) / (50 - tolerance) * 100));
    }
  }

  let planExecAlignment = 100;
  if (matched.length > 0) {
    const toleranceMin = SCORE_SETTINGS.timeDiffToleranceMin;
    let totalDiffMin = 0;
    let countWithTime = 0;
    for (const m of matched) {
      if (m.plan.startHour != null && m.execution.startHour != null) {
        const diffMin = Math.abs(m.plan.startHour - m.execution.startHour) * 60;
        totalDiffMin += diffMin;
        countWithTime++;
      }
    }
    if (countWithTime > 0) {
      const avgDiff = totalDiffMin / countWithTime;
      if (avgDiff <= toleranceMin) {
        planExecAlignment = 100;
      } else {
        planExecAlignment = Math.max(0, Math.round(100 - (avgDiff - toleranceMin) / (120 - toleranceMin) * 100));
      }
    }
  }

  let totalExecMinutes = 0;
  for (const t of tasks) {
    if (excludeStatuses.includes(t.status)) continue;
    if (!doneStatuses.includes(t.status)) continue;
    if (t.startHour != null && t.endHour != null) {
      let dur = t.endHour - t.startHour;
      if (dur < 0) dur += 24;
      totalExecMinutes += dur * 60;
    }
  }
  const targetMin = SCORE_SETTINGS.targetExecHours * 60;
  const totalExecTime = Math.min(100, Math.round(totalExecMinutes / targetMin * 100));

  const w = SCORE_WEIGHTS;
  const totalWeight = w.completionRate + w.planAdherence + w.gapEfficiency + w.planExecAlignment + w.totalExecTime;
  const totalScore = Math.round(
    (completionRate * w.completionRate +
     planAdherence * w.planAdherence +
     gapEfficiency * w.gapEfficiency +
     planExecAlignment * w.planExecAlignment +
     totalExecTime * w.totalExecTime) / totalWeight
  );

  return {
    total: totalScore,
    items: {
      completionRate: { score: completionRate, weight: w.completionRate, label: '완료율' },
      planAdherence: { score: planAdherence, weight: w.planAdherence, label: '계획 이행' },
      gapEfficiency: { score: gapEfficiency, weight: w.gapEfficiency, label: '공백 효율' },
      planExecAlignment: { score: planExecAlignment, weight: w.planExecAlignment, label: '계획-실행 일치' },
      totalExecTime: { score: totalExecTime, weight: w.totalExecTime, label: '총 실행 시간' },
    },
    totalExecMinutes,
  };
}

function compareDayPlanVsExecution(calendarEvents = [], notionTasks = [], dateStr) {
  const { STATUS_GROUPS, KNOWN_HABITS, DAY_NAMES, getTimeSlot } = getConfig();
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = DAY_NAMES[date.getDay()];

  const matched = [];
  const usedCal = new Set();
  const usedNotion = new Set();

  for (let ci = 0; ci < calendarEvents.length; ci++) {
    const cal = calendarEvents[ci];
    const calNorm = normalize(cal.title);
    for (let ni = 0; ni < notionTasks.length; ni++) {
      if (usedNotion.has(ni)) continue;
      const task = notionTasks[ni];
      const taskNorm = normalize(task.title.split(':')[0]);
      if (calNorm === taskNorm || normalize(task.title) === calNorm) {
        matched.push({ plan: cal, execution: task, matchType: 'exact' });
        usedCal.add(ci);
        usedNotion.add(ni);
        break;
      }
    }
  }

  for (let ci = 0; ci < calendarEvents.length; ci++) {
    if (usedCal.has(ci)) continue;
    const cal = calendarEvents[ci];
    const calNorm = normalize(cal.title);
    for (let ni = 0; ni < notionTasks.length; ni++) {
      if (usedNotion.has(ni)) continue;
      const task = notionTasks[ni];
      const taskNorm = normalize(task.title);
      if (taskNorm.includes(calNorm) || calNorm.includes(taskNorm) ||
          taskNorm.includes(calNorm.split(' ')[0]) || calNorm.includes(taskNorm.split(':')[0].trim())) {
        matched.push({ plan: cal, execution: task, matchType: 'partial' });
        usedCal.add(ci);
        usedNotion.add(ni);
        break;
      }
    }
  }

  for (let ci = 0; ci < calendarEvents.length; ci++) {
    if (usedCal.has(ci)) continue;
    const cal = calendarEvents[ci];
    if (cal.isAllDay) continue;
    let bestNi = -1, bestOverlap = 0.5;
    for (let ni = 0; ni < notionTasks.length; ni++) {
      if (usedNotion.has(ni)) continue;
      const task = notionTasks[ni];
      const overlap = timeOverlap(cal.startHour, cal.endHour, task.startHour, task.endHour);
      if (overlap > bestOverlap) { bestOverlap = overlap; bestNi = ni; }
    }
    if (bestNi >= 0) {
      matched.push({ plan: cal, execution: notionTasks[bestNi], matchType: 'time' });
      usedCal.add(ci);
      usedNotion.add(bestNi);
    }
  }

  const plannedOnly = calendarEvents.filter((_, i) => !usedCal.has(i));
  const executedOnly = notionTasks.filter((_, i) => !usedNotion.has(i));

  const allTasks = notionTasks;
  const countByGroup = (groupKey) => allTasks.filter(t => (STATUS_GROUPS[groupKey] || []).includes(t.status)).length;

  const completed = countByGroup('COMPLETED');
  const delayed = countByGroup('DELAYED');
  const inProgress = countByGroup('IN_PROGRESS');
  const failed = countByGroup('FAILED');
  const cancelled = countByGroup('CANCELLED');
  const pending = countByGroup('PENDING');
  const reference = countByGroup('REFERENCE');

  const totalTasks = allTasks.length;
  const actionable = totalTasks - cancelled - reference;
  const completionRate = actionable > 0 ? (completed + delayed) / actionable : 0;
  const successRate = actionable > 0 ? completed / actionable : 0;

  const { GAP_CONFIG } = getConfig();
  const gaps = computeGaps(allTasks, GAP_CONFIG);

  const dayData = {
    date: dateStr,
    dayOfWeek,
    matched,
    plannedOnly,
    executedOnly,
    tasks: allTasks,
    gaps,
    score: null,
    stats: {
      totalTasks,
      completed,
      delayed,
      inProgress,
      failed,
      cancelled,
      pending,
      reference,
      actionable,
      completionRate: Math.round(completionRate * 100),
      successRate: Math.round(successRate * 100),
    },
  };

  dayData.score = allTasks.length > 0 ? computeDayScore(dayData) : null;

  return dayData;
}

function aggregateWeeklyStats(dailyComparisons) {
  const { STATUS_GROUPS, KNOWN_HABITS, getTimeSlot } = getConfig();
  const weekly = {
    totalTasks: 0, completed: 0, delayed: 0, inProgress: 0,
    failed: 0, cancelled: 0, pending: 0, reference: 0,
  };

  const slotStats = {};
  const habitTracker = {};
  for (const h of KNOWN_HABITS) habitTracker[h] = [];

  const delays = [];
  const failures = [];

  const doneStatuses = [
    ...(STATUS_GROUPS.COMPLETED || []),
    ...(STATUS_GROUPS.DELAYED || []),
  ];
  const excludeStatuses = [
    ...(STATUS_GROUPS.CANCELLED || []),
    ...(STATUS_GROUPS.REFERENCE || []),
  ];

  for (const day of dailyComparisons) {
    weekly.totalTasks += day.stats.totalTasks;
    weekly.completed += day.stats.completed;
    weekly.delayed += day.stats.delayed;
    weekly.inProgress += day.stats.inProgress;
    weekly.failed += day.stats.failed;
    weekly.cancelled += day.stats.cancelled;
    weekly.pending += day.stats.pending;
    weekly.reference += day.stats.reference;

    for (const task of day.tasks) {
      if (excludeStatuses.includes(task.status)) continue;

      if (task.startHour != null) {
        const slot = getTimeSlot(Math.floor(task.startHour));
        if (!slotStats[slot.name]) slotStats[slot.name] = { label: slot.label, total: 0, completed: 0 };
        slotStats[slot.name].total++;
        if (doneStatuses.includes(task.status)) {
          slotStats[slot.name].completed++;
        }
      }

      const taskBase = task.title.split(':')[0].trim();
      for (const h of KNOWN_HABITS) {
        if (taskBase === h || normalize(taskBase) === normalize(h)) {
          habitTracker[h].push({ date: day.date, dayOfWeek: day.dayOfWeek, status: task.status });
        }
      }

      if ((STATUS_GROUPS.DELAYED || []).includes(task.status)) {
        delays.push({ ...task, date: day.date, dayOfWeek: day.dayOfWeek });
      }

      if ((STATUS_GROUPS.FAILED || []).includes(task.status)) {
        failures.push({ ...task, date: day.date, dayOfWeek: day.dayOfWeek });
      }
    }
  }

  weekly.actionable = weekly.totalTasks - weekly.cancelled - weekly.reference;
  weekly.completionRate = weekly.actionable > 0 ? Math.round((weekly.completed + weekly.delayed) / weekly.actionable * 100) : 0;
  weekly.successRate = weekly.actionable > 0 ? Math.round(weekly.completed / weekly.actionable * 100) : 0;

  const timeSlotAnalysis = Object.entries(slotStats).map(([name, s]) => ({
    name, label: s.label,
    total: s.total,
    completed: s.completed,
    rate: s.total > 0 ? Math.round(s.completed / s.total * 100) : 0,
  })).sort((a, b) => b.rate - a.rate);

  const habitAnalysis = Object.entries(habitTracker).map(([name, entries]) => {
    const done = entries.filter(e => doneStatuses.includes(e.status)).length;
    return {
      name,
      entries,
      total: entries.length,
      completed: done,
      rate: entries.length > 0 ? Math.round(done / entries.length * 100) : 0,
    };
  });

  const gapAnalysis = {
    dailyGaps: dailyComparisons.map(d => ({
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      totalGapMinutes: d.gaps.totalGapMinutes,
      warningCount: d.gaps.warnings.length,
      warnings: d.gaps.warnings,
    })),
    weeklyTotalGapMinutes: dailyComparisons.reduce((sum, d) => sum + d.gaps.totalGapMinutes, 0),
    weeklyWarningCount: dailyComparisons.reduce((sum, d) => sum + d.gaps.warnings.length, 0),
  };

  const { getGrade } = getConfig();
  const scoredDays = dailyComparisons.filter(d => d.score != null);
  const weeklyScore = scoredDays.length > 0
    ? Math.round(scoredDays.reduce((sum, d) => sum + d.score.total, 0) / scoredDays.length)
    : 0;

  const weeklyScoreItems = {};
  if (scoredDays.length > 0) {
    for (const key of Object.keys(scoredDays[0].score.items)) {
      const avg = Math.round(scoredDays.reduce((sum, d) => sum + d.score.items[key].score, 0) / scoredDays.length);
      weeklyScoreItems[key] = { ...scoredDays[0].score.items[key], score: avg };
    }
  }

  const bestDay = scoredDays.length > 0 ? scoredDays.reduce((a, b) => a.score.total > b.score.total ? a : b) : null;
  const worstDay = scoredDays.length > 0 ? scoredDays.reduce((a, b) => a.score.total < b.score.total ? a : b) : null;

  const scoreAnalysis = {
    weeklyScore,
    weeklyGrade: getGrade(weeklyScore),
    weeklyScoreItems,
    bestDay: bestDay ? { date: bestDay.date, dayOfWeek: bestDay.dayOfWeek, score: bestDay.score.total } : null,
    worstDay: worstDay ? { date: worstDay.date, dayOfWeek: worstDay.dayOfWeek, score: worstDay.score.total } : null,
  };

  return {
    weekly,
    dailyComparisons,
    timeSlotAnalysis,
    habitAnalysis,
    delays,
    failures,
    gapAnalysis,
    scoreAnalysis,
  };
}

module.exports = { compareDayPlanVsExecution, aggregateWeeklyStats };
