const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '분析기준.txt');

function parseConfigFile() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const sections = {};
  let currentSection = null;
  let currentLines = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (currentSection) sections[currentSection] = currentLines;
      currentSection = sectionMatch[1];
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(trimmed);
    }
  }
  if (currentSection) sections[currentSection] = currentLines;
  return sections;
}

function parseKV(lines) {
  const result = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function parseList(val) {
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function loadConfig() {
  const sections = parseConfigFile();

  const calRaw = parseKV(sections['구글 캘린더'] || []);
  const CALENDAR_INCLUDE = calRaw['포함'] ? parseList(calRaw['포함']) : [];
  const CALENDAR_EXCLUDE = calRaw['제외'] ? parseList(calRaw['제외']) : [];

  const statusGroupsRaw = parseKV(sections['상태 분류'] || []);
  const GROUP_NAME_MAP = {
    '완료': 'COMPLETED', '지연 완료': 'DELAYED', '진행 중': 'IN_PROGRESS',
    '실패': 'FAILED', '취소': 'CANCELLED', '미진행': 'PENDING', '참고': 'REFERENCE',
    '성공': 'COMPLETED', '부분 완료': 'PARTIAL',
  };
  const STATUS_GROUPS = {};
  for (const [k, v] of Object.entries(statusGroupsRaw)) {
    const groupKey = GROUP_NAME_MAP[k] || k;
    STATUS_GROUPS[groupKey] = parseList(v);
  }

  const STATUS_MEANINGS = parseKV(sections['상태 의미'] || []);
  const STATUS_EMOJI = parseKV(sections['상태 이모지'] || []);

  const STATUS_TO_GROUP = {};
  for (const [group, statuses] of Object.entries(STATUS_GROUPS)) {
    for (const s of statuses) STATUS_TO_GROUP[s] = group;
  }

  const habitLine = (sections['습관 목록'] || []).join(', ');
  const KNOWN_HABITS = parseList(habitLine);

  const timeSlotsRaw = parseKV(sections['시간대'] || []);
  const TIME_SLOTS = Object.entries(timeSlotsRaw).map(([name, range]) => {
    const [startStr, endStr] = range.split('~').map(s => parseInt(s.trim(), 10));
    return { name, label: range.trim(), start: startStr, end: endStr };
  });

  const gradeRaw = parseKV(sections['등급 기준'] || []);
  const GRADE_THRESHOLDS = Object.entries(gradeRaw)
    .map(([grade, min]) => ({ grade, min: parseInt(min, 10) }))
    .sort((a, b) => b.min - a.min);

  const weightsRaw = parseKV(sections['점수 가중치'] || []);
  const SCORE_WEIGHTS = {
    completionRate: parseInt(weightsRaw['완료율'] || '25', 10),
    planAdherence: parseInt(weightsRaw['계획 이행'] || '25', 10),
    gapEfficiency: parseInt(weightsRaw['공백 효율'] || '15', 10),
    planExecAlignment: parseInt(weightsRaw['계획-실행 일치'] || '15', 10),
    totalExecTime: parseInt(weightsRaw['총 실행 시간'] || '20', 10),
  };

  const scoreSettingsRaw = parseKV(sections['점수 설정'] || []);
  const SCORE_SETTINGS = {
    targetExecHours: parseFloat(scoreSettingsRaw['목표 실행 시간'] || '8'),
    timeDiffToleranceMin: parseInt(scoreSettingsRaw['시간 차이 허용'] || '30', 10),
    gapTolerancePct: parseInt(scoreSettingsRaw['공백 허용 비율'] || '10', 10),
  };

  const gapRaw = parseKV(sections['공백 시간'] || []);
  function parseHHMM(str) {
    const [h, m] = (str || '0:00').split(':').map(Number);
    return h + (m || 0) / 60;
  }
  const GAP_CONFIG = {
    warningMinutes: parseInt(gapRaw['경고 기준'] || '60', 10),
    activeStart: parseHHMM(gapRaw['활동 시작'] || '09:00'),
    activeEnd: parseHHMM(gapRaw['활동 종료'] || '23:00'),
  };

  const ANALYSIS_FOCUS = (sections['분析 관점'] || []).filter(Boolean);
  const ANALYSIS_STYLE = parseKV(sections['분析 스타일'] || []);

  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  function getTimeSlot(hour) {
    return TIME_SLOTS.find(s =>
      s.start <= s.end ? (hour >= s.start && hour < s.end) : (hour >= s.start || hour < s.end)
    ) || TIME_SLOTS[TIME_SLOTS.length - 1];
  }

  function getGrade(rate) {
    for (const { grade, min } of GRADE_THRESHOLDS) {
      if (rate >= min) return grade;
    }
    return 'F';
  }

  return {
    CALENDAR_INCLUDE, CALENDAR_EXCLUDE,
    STATUS_GROUPS, STATUS_MEANINGS, STATUS_EMOJI, STATUS_TO_GROUP,
    KNOWN_HABITS, TIME_SLOTS, DAY_NAMES,
    GRADE_THRESHOLDS, SCORE_WEIGHTS, SCORE_SETTINGS, GAP_CONFIG, ANALYSIS_FOCUS, ANALYSIS_STYLE,
    getTimeSlot, getGrade,
  };
}

let _cached = null;
function getConfig() {
  if (!_cached) _cached = loadConfig();
  return _cached;
}

module.exports = { getConfig };
