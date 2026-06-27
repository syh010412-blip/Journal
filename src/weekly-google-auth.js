require('dotenv').config();

const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');
const { exec } = require('child_process');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

function loadCredentials() {
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || '/Users/parkhanyong/credentials.json';
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const { client_id, client_secret } = raw.installed || raw.web;
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

function loadToken(oauth2) {
  const tokenPath = process.env.GOOGLE_TOKEN_PATH || '/Users/parkhanyong/token.json';
  if (!fs.existsSync(tokenPath)) return false;
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const scopes = token.scopes || token.scope?.split(' ') || [];
  const hasCalendar = scopes.some(s => s.includes('calendar'));
  if (!hasCalendar) return false;
  oauth2.setCredentials({
    access_token: token.token || token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.expiry_date || (token.expiry ? new Date(token.expiry).getTime() : undefined),
    token_type: token.token_type || 'Bearer',
    scope: SCOPES.join(' '),
  });
  return true;
}

function saveToken(oauth2) {
  const tokenPath = process.env.GOOGLE_TOKEN_PATH || '/Users/parkhanyong/token.json';
  const creds = oauth2.credentials;
  const data = {
    token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_uri: 'https://oauth2.googleapis.com/token',
    client_id: oauth2._clientId,
    client_secret: oauth2._clientSecret,
    scopes: SCOPES,
    expiry: creds.expiry_date ? new Date(creds.expiry_date).toISOString() : undefined,
  };
  fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2));
  console.log('[auth] 토큰 저장 완료:', tokenPath);
}

async function exchangeCode(code) {
  const oauth2 = loadCredentials();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  saveToken(oauth2);
  return oauth2;
}

async function authorize() {
  const oauth2 = loadCredentials();
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n[auth] 아래 링크를 브라우저에서 열어 Google 계정으로 로그인하세요:\n');
  console.log(authUrl);
  console.log('\n[auth] 로그인 후 브라우저 주소창에 표시된 URL에서');
  console.log('[auth] code= 뒤의 값을 복사해 GOOGLE_AUTH_CODE 환경변수로 설정하세요.');
  console.log('[auth] 예: GOOGLE_AUTH_CODE=4/0AX... node src/weekly-google-auth.js\n');

  // GOOGLE_AUTH_CODE 환경변수가 설정되어 있으면 바로 교환
  const manualCode = process.env.GOOGLE_AUTH_CODE;
  if (manualCode) {
    console.log('[auth] GOOGLE_AUTH_CODE로 토큰 교환 중...');
    return exchangeCode(manualCode);
  }

  // 로컬 서버로 리다이렉트 자동 수신 (브라우저와 같은 머신에서 실행 시)
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      if (!code) { res.writeHead(400); res.end('No code'); return; }
      try {
        const authed = await exchangeCode(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>인증 완료! 이 탭을 닫아도 됩니다.</h1>');
        server.close();
        resolve(authed);
      } catch (err) {
        res.writeHead(500); res.end('Token error');
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`[auth] 로컬 서버 대기 중 (http://localhost:${REDIRECT_PORT})...`);
    });
  });
}

async function getCalendarClient() {
  const oauth2 = loadCredentials();
  if (loadToken(oauth2)) {
    const creds = oauth2.credentials;
    if (creds.expiry_date && creds.expiry_date < Date.now()) {
      console.log('[auth] 토큰 갱신 중...');
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      saveToken(oauth2);
    }
    return google.calendar({ version: 'v3', auth: oauth2 });
  }
  const authed = await authorize();
  return google.calendar({ version: 'v3', auth: authed });
}

if (require.main === module) {
  authorize()
    .then(() => { console.log('[auth] Google Calendar 인증 완료!'); process.exit(0); })
    .catch(err => { console.error('[auth] 인증 실패:', err.message); process.exit(1); });
}

module.exports = { getCalendarClient };
