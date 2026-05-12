const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function createOAuthClient() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = creds.installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function getAuthClient() {
  const oAuth2Client = createOAuthClient();

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return oAuth2Client;
  }

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  throw new Error('Google 인증 토큰이 없습니다. 먼저 node src/gcal-auth.js 를 실행해서 인증하세요.');
}

async function authorize() {
  const oAuth2Client = createOAuthClient();
  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

  console.log('\n아래 URL을 브라우저에서 열어 Google 계정으로 로그인하세요:\n');
  console.log(authUrl);
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise(resolve => rl.question('인증 후 표시된 코드를 여기에 붙여넣으세요: ', resolve));
  rl.close();

  const { tokens } = await oAuth2Client.getToken(code.trim());
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('\n✅ 토큰이 저장되었습니다:', TOKEN_PATH);
  if (tokens.refresh_token) {
    console.log('\n📋 GitHub Actions에서 쓸 GOOGLE_REFRESH_TOKEN 값:');
    console.log(tokens.refresh_token);
  }
}

if (require.main === module) {
  authorize().catch(console.error);
}

module.exports = { getAuthClient };
