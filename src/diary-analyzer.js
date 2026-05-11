require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { getDiaryConfig } = require('./diary-config');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt(stats) {
const { ANALYSIS_FOCUS, ANALYSIS_STYLE } = getDiaryConfig();
const recCount = parseInt(ANALYSIS_STYLE['추천 개수'] || '5', 10);

// 일별 요약 (Comment 위주, 본문 앞부분 보조)
const entrySummary = stats.entries.map(e => {
const body = e.bodyText ? ` / 본문:"${e.bodyText.slice(0, 80).replace(/\n/g, ' ')}..."` : '';
return `  ${e.dateStr}(${e.dayOfWeek}) [${e.emotionDirection}] 주제:[${e.topics.join(',')||'-'}] Comment:"${e.comment}"${body}`;
}).join('\n');

// 월별 요약
const monthlySummary = stats.monthlyStats.map(m =>
`  ${m.ym}: ${m.count}개, 주요감정:${m.dominantEmotion} (긍정${m.direction['긍정']} 부정${m.direction['부정']} 중립${m.direction['중립']})`
).join('\n');

// 요일별
const daySummary = stats.dayStats.filter(d => d.count > 0).map(d =>
`  ${d.dayOfWeek}요일: ${d.count}건 (긍정${d['긍정']} 부정${d['부정']} 중립${d['중립']})`
).join('\n');

// 주제 빈도
const topicSummary = Object.entries(stats.topicFreq).map(([t, c]) => `${t}:${c}회`).join(', ');

// 자주 쓰는 키워드
const kwSummary = stats.topKeywords.slice(0, 15).map(k => `${k.word}(${k.count})`).join(', ');

const focusSection = ANALYSIS_FOCUS.length > 0
? `\n## 분석 포인트\n${ANALYSIS_FOCUS.map(f => `- ${f}`).join('\n')}\n`
: '';

return `아래는 개인 일기 데이터입니다. 분석하여 JSON을 출력하세요.
${focusSection}

## 전체 현황

- 기간: ${stats.dateRange?.start} ~ ${stats.dateRange?.end}
- 총 일기: ${stats.total}개 (기록률 약 ${stats.writingRate}%)
- 감정 분포: 긍정 ${stats.directionCount['긍정']}개, 부정 ${stats.directionCount['부정']}개, 중립 ${stats.directionCount['중립']}개

## 월별 현황

${monthlySummary}

## 요일별 현황

${daySummary}

## 자주 등장한 주제

${topicSummary || '없음'}

## 자주 쓴 단어

${kwSummary}

## 일별 상세 (Comment + 본문 요약)

${entrySummary}

## 출력 JSON (유효한 JSON만, 마크다운 코드블록 없이)

{
"overallSummary": "전체 기간 총평 3~4문장 (감정 흐름, 기록 습관, 주요 심리 패턴)",
"recordingHabit": {
"rate": "${stats.writingRate}%",
"insight": "기록 습관에 대한 평가 1~2문장",
"recommendation": "기록 습관 개선 제안"
},
"emotionAnalysis": {
"overallTone": "긍정/부정/혼재 중 하나와 근거",
"positivePattern": "긍정 감정이 자주 등장한 상황이나 맥락",
"negativePattern": "부정 감정이 자주 등장한 상황이나 맥락",
"insight": "감정 패턴에서 발견한 심리적 특성 2~3문장"
},
"weekdayPattern": {
"bestDay": { "dayOfWeek": "요일", "reason": "이 요일에 긍정 감정이 많은 이유 추정" },
"hardDay": { "dayOfWeek": "요일", "reason": "이 요일에 힘든 이유 추정" },
"insight": "요일 패턴 총평"
},
"topicAnalysis": {
"mainTopics": ["자주 등장한 주제1", "주제2", "주제3"],
"insight": "주요 관심사/생활 영역 분석 2문장"
},
"monthlyTrend": [
{ "ym": "YYYY-MM", "summary": "이 달의 감정 흐름 한줄 요약", "highlight": "이 달의 인상적인 패턴" }
],
"growthPoints": {
"strengths": "일기에서 드러나는 심리적 강점이나 긍정적 변화",
"challenges": "반복적으로 어려움이 보이는 영역",
"insight": "전반적인 자기이해 포인트 (격려와 통찰 위주)"
},
"recommendations": [
${Array.from({ length: recCount }, (_, i) => `"자기돌봄 또는 생활 개선 구체적 제안 ${i + 1}"`).join(',\n    ')}
]
}`;
}

async function analyzeDiaryData(stats) {
const { ANALYSIS_STYLE } = getDiaryConfig();
const tone = ANALYSIS_STYLE['말투'] || '~해요/~합니다';
const emphasis = ANALYSIS_STYLE['강조'] || '성장과 자기이해 위주';

console.log('[diary-analyzer] Claude API 분석 중…');

const message = await client.messages.create({
model: 'claude-sonnet-4-6',
max_tokens: 4000,
system: `당신은 따뜻하고 통찰력 있는 일기 분석 코치입니다. 개인 일기 데이터를 분석하여 감정 패턴, 심리적 경향, 성장 포인트를 발견해 줍니다. 반드시 유효한 JSON만 출력하세요. 마크다운 코드블록 없이. 한국어로. ${emphasis}. ${tone} 체 사용.`,
messages: [{ role: 'user', content: buildPrompt(stats) }],
});

let text = message.content[0].text.trim()
.replace(/^`json\n?/, '').replace(/\n?`$/, '').trim();
const s = text.indexOf('{'), e = text.lastIndexOf('}');
if (s !== -1 && e !== -1) text = text.slice(s, e + 1);

try {
const result = JSON.parse(text);
console.log('[diary-analyzer] 분석 완료');
return result;
} catch {
const result = JSON.parse(text.replace(/[\x00-\x1F\x7F]/g, ' '));
console.log('[diary-analyzer] 분석 완료');
return result;
}
}

module.exports = { analyzeDiaryData };
