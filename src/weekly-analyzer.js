require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { getConfig } = require('./weekly-config');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt() {
  const { ANALYSIS_STYLE } = getConfig();
  const tone = ANALYSIS_STYLE['말투'] || '~해요/~합니다';
  const emphasis = ANALYSIS_STYLE['강조'] || '구체적이고 실행 가능한 조언 위주';

  return `당신은 개인 생산성 코치입니다. 한국 사용자의 주간 계획 대비 실행 데이터를 분석하여 인사이트를 제공합니다.
반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이.
한국어로 응답하세요. ${emphasis}.
${tone} 체를 사용하세요.`;
}

function buildPrompt(weeklyData) {
  const { ANALYSIS_FOCUS, ANALYSIS_STYLE, GRADE_THRESHOLDS, GAP_CONFIG, STATUS_MEANINGS } = getConfig();
  const { weekly, dailyComparisons, timeSlotAnalysis, habitAnalysis, delays, failures, gapAnalysis, scoreAnalysis } = weeklyData;

  const dailySummary = dailyComparisons.map(d => {
    const taskList = d.tasks.map(t => {
      const time = t.startTime ? `${t.startTime.slice(11, 16)}~${(t.endTime || '').slice(11, 16)}` : '';
      return `    [${t.status}] ${time} ${t.title}`;
    }).join('\n');
    return `  ${d.dayOfWeek} ${d.date} (완료율 ${d.stats.completionRate}%, ${d.stats.totalTasks}건)\n${taskList}`;
  }).join('\n\n');

  const slotSummary = timeSlotAnalysis.map(s =>
    `  ${s.name}(${s.label}): ${s.rate}% (${s.completed}/${s.total})`
  ).join('\n');

  const habitSummary = habitAnalysis.map(h => {
    const days = h.entries.map(e => `${e.dayOfWeek}:${e.status}`).join(', ');
    return `  ${h.name}: ${h.rate}% (${h.completed}/${h.total}) [${days}]`;
  }).join('\n');

  const delaySummary = delays.map(d =>
    `  ${d.dayOfWeek} ${d.date} ${d.startTime?.slice(11, 16) || ''} ${d.title}`
  ).join('\n');

  const failSummary = failures.map(f =>
    `  ${f.dayOfWeek} ${f.date} ${f.startTime?.slice(11, 16) || ''} ${f.title}`
  ).join('\n');

  const focusSection = ANALYSIS_FOCUS.length > 0
    ? `\n## 분析 시 특별히 주목할 포인트\n${ANALYSIS_FOCUS.map(f => `- ${f}`).join('\n')}\n`
    : '';

  const gradeSection = GRADE_THRESHOLDS.length > 0
    ? `\n## 등급 기준\n${GRADE_THRESHOLDS.map(g => `- ${g.grade}: ${g.min}% 이상`).join('\n')}\n`
    : '';

  const recCount = parseInt(ANALYSIS_STYLE['추천 개수'] || '5', 10);
  const summaryLength = ANALYSIS_STYLE['분량'] || '주간 총평 2~3문장, 일별 평가 각 1문장';

  const meaningEntries = Object.entries(STATUS_MEANINGS);
  const meaningSection = meaningEntries.length > 0
    ? `\n## 상태별 의미 (분析 시 참고)\n${meaningEntries.map(([k, v]) => `- [${k}]: ${v}`).join('\n')}\n`
    : '';

  return `아래 주간 데이터를 분析하여 JSON으로 출력하세요.
${meaningSection}${focusSection}${gradeSection}
## 분량 기준
${summaryLength}

## 주간 총계
- 총 할 일: ${weekly.totalTasks}건 (실행 대상: ${weekly.totalTasks - weekly.cancelled - weekly.reference}건)
- 완료: ${weekly.completed}건, 지연완료: ${weekly.delayed}건, 진행중: ${weekly.inProgress}건, 실패: ${weekly.failed}건, 취소: ${weekly.cancelled}건, 미진행: ${weekly.pending}건, 참고: ${weekly.reference}건
- 실행률(완료+지연완료)/(전체-취소-참고): ${weekly.completionRate}%, 당일 완료율: ${weekly.successRate}%

## 요일별 점수 (5개 항목 각 0~100점, 가중 평균 = 총점)
- 주간 평균: ${scoreAnalysis.weeklyScore}점 (등급: ${scoreAnalysis.weeklyGrade})
- Best: ${scoreAnalysis.bestDay ? `${scoreAnalysis.bestDay.dayOfWeek} ${scoreAnalysis.bestDay.date} (${scoreAnalysis.bestDay.score}점)` : '없음'}
- Worst: ${scoreAnalysis.worstDay ? `${scoreAnalysis.worstDay.dayOfWeek} ${scoreAnalysis.worstDay.date} (${scoreAnalysis.worstDay.score}점)` : '없음'}
${dailyComparisons.filter(d => d.score).map(d => {
  const s = d.score;
  const items = s.items;
  const execH = Math.floor(s.totalExecMinutes / 60);
  const execM = s.totalExecMinutes % 60;
  return `  ${d.dayOfWeek} ${d.date}: 총 ${s.total}점 [완료율:${items.completionRate.score} 계획이행:${items.planAdherence.score} 공백:${items.gapEfficiency.score} 일치:${items.planExecAlignment.score} 시간:${items.totalExecTime.score}(${execH}h${execM > 0 ? execM + 'm' : ''})]`;
}).join('\n')}

## 일별 상세
${dailySummary}

## 시간대별 완료율
${slotSummary}

## 습관 이행
${habitSummary}

## 지연 완료 항목 (이후 완료)
${delaySummary || '  없음'}

## 실패 항목 (못함)
${failSummary || '  없음'}

## 공백 시간 분析 (할 일 사이 빈 시간)
- 주간 총 공백: ${gapAnalysis.weeklyTotalGapMinutes}분, 경고(${GAP_CONFIG.warningMinutes}분 이상) ${gapAnalysis.weeklyWarningCount}건
${gapAnalysis.dailyGaps.map(d => {
    const warnDetail = d.warnings.length > 0
      ? d.warnings.map(w => `      ⚠️ ${w.from}~${w.to} (${w.minutes}분) "${w.afterTask}" → "${w.beforeTask}"`).join('\n')
      : '      공백 없음';
    return `  ${d.dayOfWeek} ${d.date}: 총 공백 ${d.totalGapMinutes}분, 경고 ${d.warningCount}건\n${warnDetail}`;
  }).join('\n')}

## 출력 JSON
{
  "weeklyOverview": "주간 총평",
  "overallGrade": "등급",
  "scoreInsight": "점수 분析 2~3문장",
  "dailyInsights": [
    { "date": "YYYY-MM-DD", "dayOfWeek": "월", "grade": "등급", "insight": "한줄 평가" }
  ],
  "timeSlotAnalysis": {
    "bestSlot": { "name": "시간대명", "rate": 92, "insight": "이유" },
    "worstSlot": { "name": "시간대명", "rate": 45, "insight": "이유" },
    "recommendation": "추천"
  },
  "habitReport": {
    "summary": "총평",
    "habits": [
      { "name": "습관명", "rate": 80, "streak": "패턴", "recommendation": "개선방안" }
    ]
  },
  "gapReport": {
    "summary": "총평",
    "worstDay": { "date": "날짜", "totalMinutes": 0, "insight": "원인" },
    "recommendation": "방안"
  },
  "patterns": {
    "delays": "지연 패턴",
    "failures": "실패 패턴",
    "gaps": "공백 패턴"
  },
  "nextWeekRecommendations": [
    ${Array.from({ length: recCount }, (_, i) => `"행동 지침 ${i + 1}"`).join(',\n    ')}
  ]
}`;
}

async function analyzeWeeklyData(weeklyData) {
  console.log('[analyzer] Claude API 分析 중...');
  const systemPrompt = buildSystemPrompt();
  const prompt = buildPrompt(weeklyData);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  let text = message.content[0].text.trim()
    .replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) text = text.slice(s, e + 1);

  try {
    const result = JSON.parse(text);
    console.log(`[analyzer] 分析 완료 (등급: ${result.overallGrade})`);
    return result;
  } catch {
    const result = JSON.parse(text.replace(/[\x00-\x1F\x7F]/g, ' '));
    console.log(`[analyzer] 分析 완료 (등급: ${result.overallGrade})`);
    return result;
  }
}

module.exports = { analyzeWeeklyData };
