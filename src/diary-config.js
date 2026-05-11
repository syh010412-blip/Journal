const fs = require(‘fs’);
const path = require(‘path’);

const CONFIG_PATH = path.join(__dirname, ‘..’, ‘diary-config.txt’);

function parseConfigFile() {
const raw = fs.readFileSync(CONFIG_PATH, ‘utf8’);
const sections = {};
let currentSection = null;
let currentLines = [];
for (const line of raw.split(’\n’)) {
const trimmed = line.trim();
if (!trimmed || trimmed.startsWith(’#’)) continue;
const m = trimmed.match(/^[(.+)]$/);
if (m) {
if (currentSection) sections[currentSection] = currentLines;
currentSection = m[1];
currentLines = [];
} else if (currentSection) {
currentLines.push(trimmed);
}
}
if (currentSection) sections[currentSection] = currentLines;
return sections;
}

function parseKV(lines) {
const r = {};
for (const line of lines) {
const idx = line.indexOf(’=’);
if (idx < 0) continue;
r[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}
return r;
}

function parseList(val) {
return val ? val.split(’,’).map(s => s.trim()).filter(Boolean) : [];
}

function loadDiaryConfig() {
const sections = parseConfigFile();

const dbRaw = parseKV(sections[‘DB 설정’] || []);
const DIARY_DB_ID = dbRaw[‘일기_DB_ID’] || process.env.NOTION_DIARY_DB_ID;
let REPORT_DB_ID = dbRaw[‘리포트_DB_ID’] || process.env.NOTION_DIARY_REPORT_DB_ID || ‘’;

// 감정 키워드
const ekRaw = parseKV(sections[‘감정 키워드’] || []);
const EMOTION_KEYWORDS = {
positive: parseList(ekRaw[‘긍정’]),
negative: parseList(ekRaw[‘부정’]),
neutral:  parseList(ekRaw[‘중립’]),
};

// 주제 키워드
const topicRaw = sections[‘주제 키워드’] || [];
const TOPIC_KEYWORDS = {};
for (const line of topicRaw) {
const idx = line.indexOf(’=’);
if (idx < 0) continue;
TOPIC_KEYWORDS[line.slice(0, idx).trim()] = parseList(line.slice(idx + 1));
}

const ANALYSIS_FOCUS = (sections[‘분석 관점’] || []).filter(Boolean);
const ANALYSIS_STYLE = parseKV(sections[‘분석 스타일’] || []);

const outRaw = parseKV(sections[‘출력 설정’] || []);
const OUTPUT = {
includeBody: (outRaw[‘본문_읽기’] || ‘true’) === ‘true’,
bodyMaxLen: parseInt(outRaw[‘본문_최대길이’] || ‘300’, 10),
keywordCount: parseInt(outRaw[‘키워드_개수’] || ‘20’, 10),
};

const DAY_NAMES = [‘일’, ‘월’, ‘화’, ‘수’, ‘목’, ‘금’, ‘토’];

// 텍스트에서 감정 방향 추론
function classifyEmotionFromText(text) {
if (!text) return ‘중립’;
const t = text;
let pos = 0, neg = 0;
for (const kw of EMOTION_KEYWORDS.positive) if (t.includes(kw)) pos++;
for (const kw of EMOTION_KEYWORDS.negative) if (t.includes(kw)) neg++;
if (pos === 0 && neg === 0) return ‘중립’;
if (pos > neg) return ‘긍정’;
if (neg > pos) return ‘부정’;
return ‘중립’;
}

// 텍스트에서 주제 분류
function classifyTopics(text) {
if (!text) return [];
const found = [];
for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
if (keywords.some(kw => text.includes(kw))) found.push(topic);
}
return found;
}

// 리포트 DB ID를 config에 저장
function saveReportDbId(id) {
const raw = fs.readFileSync(CONFIG_PATH, ‘utf8’);
const updated = raw.replace(/^(리포트_DB_ID\s*=\s*).*$/m, `$1${id}`);
fs.writeFileSync(CONFIG_PATH, updated, ‘utf8’);
console.log(’[diary-config] 리포트 DB ID 저장:’, id);
}

return {
DIARY_DB_ID, REPORT_DB_ID,
EMOTION_KEYWORDS, TOPIC_KEYWORDS,
ANALYSIS_FOCUS, ANALYSIS_STYLE, OUTPUT, DAY_NAMES,
classifyEmotionFromText, classifyTopics, saveReportDbId,
};
}

let _cached = null;
function getDiaryConfig() {
if (!_cached) _cached = loadDiaryConfig();
return _cached;
}

module.exports = { getDiaryConfig };
