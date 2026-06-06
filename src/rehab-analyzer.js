require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildRehabPrompt(stats) {
  const { totalSessions, totalDays, dateRange, avgPain, painTrend, firstAvg, secondAvg, topExercises, dayStats, dailyPainTrend } = stats;

  const exerciseSummary = topExercises.slice(0, 10)
    .map(e => `  ${e.name}: ${e.count}회`)
    .join('\n') || '  (기록 없음)';

  const daySummary = dayStats.filter(d => d.count > 0)
    .map(d => `  ${d.dayOfWeek}요일: ${d.count}회 세션${d.avgPain !== null ? `, 평균 통증 ${d.avgPain}` : ''}`)
    .join('\n');

  const dailySummary = dailyPainTrend.slice(-14)
    .map(d => `  ${d.dateStr}(${d.dayOfWeek}) 세션${d.sessionCount}회 통증:${d.avgPain ?? '-'} [${d.exercises.join(', ')}]`)
    .join('\n');

  const trendDesc = painTrend === '개선' ? `통증 감소 (초반 평균 ${firstAvg} → 후반 평균 ${secondAvg})`
    : painTrend === '악화' ? `통증 증가 (초반 평균 ${firstAvg} → 후반 평균 ${secondAvg})`
    : painTrend === '유지' ? `통증 유지 (초반 평균 ${firstAvg} → 후반 평균 ${secondAvg})`
    : '데이터 부족';

  return `아래는 개인 재활 기록 데이터입니다. 분석하여 JSON을 출력하세요.

## 전체 현황

- 기간: ${dateRange?.start} ~ ${dateRange?.end}
- 총 세션 수: ${totalSessions}회 (운동한 날: ${totalDays}일)
- 평균 통증 레벨: ${avgPain ?? '데이터 없음'} / 10
- 통증 추이: ${trendDesc}

## 자주 한 운동 (상위 10개)

${exerciseSummary}

## 요일별 패턴

${daySummary || '  (데이터 없음)'}

## 최근 14일 일별 기록

${dailySummary || '  (데이터 없음)'}

## 출력 JSON (유효한 JSON만, 마크다운 코드블록 없이)

{
  "overallSummary": "전체 재활 진행 총평 3~4문장 (통증 추이, 운동 패턴, 회복 상태)",
  "painAnalysis": {
    "currentLevel": "현재 통증 수준 평가 (낮음/보통/높음 + 근거)",
    "trend": "통증 추이 분석 (개선/악화/유지의 이유 추정)",
    "insight": "통증 패턴에서 발견한 주요 특징 2문장"
  },
  "exercisePattern": {
    "mainExercises": ["주요 운동 1", "주요 운동 2", "주요 운동 3"],
    "consistency": "운동 일관성 평가 (규칙적/불규칙, 빈도 평가)",
    "insight": "운동 구성의 특징과 재활 측면에서의 분석 2문장"
  },
  "weekdayPattern": {
    "activeDays": "운동이 많은 요일 패턴 분석",
    "restDays": "휴식 패턴 분석",
    "insight": "요일별 패턴 총평"
  },
  "recoveryProgress": {
    "status": "회복 진행 상태 (초기/진행중/후기/유지)",
    "positivePoints": "잘 되고 있는 부분 (구체적)",
    "concerns": "주의가 필요한 부분 또는 개선 여지",
    "insight": "전반적인 회복 경과 평가 2문장"
  },
  "recommendations": [
    "구체적이고 실천 가능한 재활 개선 제안 1",
    "구체적이고 실천 가능한 재활 개선 제안 2",
    "구체적이고 실천 가능한 재활 개선 제안 3",
    "구체적이고 실천 가능한 재활 개선 제안 4",
    "구체적이고 실천 가능한 재활 개선 제안 5"
  ]
}`;
}

async function analyzeRehabData(stats) {
  console.log('[rehab-analyzer] Claude API 분석 중…');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: '당신은 전문 재활 트레이너이자 물리치료 코치입니다. 재활 운동 기록 데이터를 분석하여 회복 진행 상황, 통증 패턴, 운동 일관성을 평가하고 실질적인 개선 방향을 제시합니다. 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이. 한국어로. 따뜻하고 전문적인 톤.',
    messages: [{ role: 'user', content: buildRehabPrompt(stats) }],
  });

  let text = message.content[0].text.trim()
    .replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e !== -1) text = text.slice(s, e + 1);

  try {
    const result = JSON.parse(text);
    console.log('[rehab-analyzer] 분석 완료');
    return result;
  } catch {
    const result = JSON.parse(text.replace(/[\x00-\x1F\x7F]/g, ' '));
    console.log('[rehab-analyzer] 분석 완료');
    return result;
  }
}

module.exports = { analyzeRehabData };
