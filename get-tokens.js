#!/usr/bin/env node
/**
 * Verse8 OAuth Token Helper
 * LinkedIn + Meta (Facebook/Instagram) 액세스 토큰 발급 도우미
 *
 * Usage:
 *   node get-tokens.js meta      ← Facebook + Instagram 토큰 발급
 *   node get-tokens.js linkedin  ← LinkedIn 토큰 발급
 *   node get-tokens.js all       ← 둘 다
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ENV_PATH = path.resolve(__dirname, '.env');
const env = {};
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const idx = t.indexOf('=');
    if (idx < 0) return;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  });
}

const REDIRECT_URI = 'http://localhost:3000/callback';

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function waitForCallback(port = 3000) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const url   = new URL(request.url, `http://localhost:${port}`);
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(error
        ? `<h2>오류: ${error}</h2>`
        : `<h2>인증 완료! 이 탭을 닫고 터미널로 돌아오세요.</h2>`
      );
      server.close();
      resolve({ code, error });
    });
    server.listen(port);
  });
}

function saveToEnv(key, value) {
  if (!fs.existsSync(ENV_PATH)) return;
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^(${key}=).*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content);
  console.log(`  -> .env 저장: ${key}`);
}

async function getMeta() {
  const appId     = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  if (!appId || !appSecret) { console.error('META_APP_ID / META_APP_SECRET 없음'); return; }

  const scopes = encodeURIComponent([
    'pages_read_engagement','pages_show_list','business_management',
    'instagram_content_publish','instagram_manage_insights',
  ].join(','));

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code`;

  console.log('\n[Meta OAuth]');
  console.log('브라우저에서 아래 URL을 여세요:\n');
  console.log(authUrl + '\n');
  console.log('승인 후 localhost:3000/callback 으로 리다이렉트됩니다...\n');

  const { code, error } = await waitForCallback(3000);
  if (error || !code) { console.error('인증 실패:', error); return; }

  console.log('토큰 교환 중...');

  const shortR = await req({ hostname: 'graph.facebook.com', path: `/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${code}`, method: 'GET' });
  if (shortR.status >= 400) { console.error('토큰 교환 실패:', shortR.raw.slice(0,300)); return; }

  const shortToken = shortR.body.access_token;
  const ltR = await req({ hostname: 'graph.facebook.com', path: `/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`, method: 'GET' });
  const longToken = ltR.body.access_token || shortToken;
  console.log('Long-lived token 발급 완료 (60일)\n');

  const pagesR = await req({ hostname: 'graph.facebook.com', path: `/v19.0/me/accounts?access_token=${longToken}`, method: 'GET' });
  if (!pagesR.body?.data?.length) { console.log('관리 중인 Facebook 페이지 없음'); return; }

  for (const page of pagesR.body.data) {
    console.log(`\n페이지: ${page.name}`);
    console.log(`  FACEBOOK_PAGE_ID=${page.id}`);
    console.log(`  FACEBOOK_PAGE_ACCESS_TOKEN=${page.access_token}`);
    saveToEnv('FACEBOOK_PAGE_ID', page.id);
    saveToEnv('FACEBOOK_PAGE_ACCESS_TOKEN', page.access_token);

    const igR = await req({ hostname: 'graph.facebook.com', path: `/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`, method: 'GET' });
    if (igR.body?.instagram_business_account?.id) {
      console.log(`  INSTAGRAM_BUSINESS_ACCOUNT_ID=${igR.body.instagram_business_account.id}`);
      saveToEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', igR.body.instagram_business_account.id);
    } else {
      console.log('  Instagram Business Account 없음 (Instagram에서 Facebook 페이지 연결 필요)');
    }
  }
}

async function getLinkedIn() {
  const clientId     = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) { console.error('LINKEDIN credentials 없음'); return; }

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent('w_organization_social r_basicprofile')}`;

  console.log('\n[LinkedIn OAuth]');
  console.log('브라우저에서 아래 URL을 여세요:\n');
  console.log(authUrl + '\n');

  const { code, error } = await waitForCallback(3000);
  if (error || !code) { console.error('인증 실패:', error); return; }

  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, client_secret: clientSecret }).toString();
  const r = await req({ hostname: 'www.linkedin.com', path: '/oauth/v2/accessToken', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, body);
  if (r.status >= 400) { console.error('토큰 교환 실패:', r.raw.slice(0,300)); return; }

  const { access_token, expires_in } = r.body;
  console.log(`LinkedIn Token 발급 완료 (${Math.floor(expires_in/86400)}일)`);
  saveToEnv('LINKEDIN_ACCESS_TOKEN', access_token);
}

async function main() {
  const target = process.argv[2] || 'meta';
  if (target === 'meta'     || target === 'all') await getMeta();
  if (target === 'linkedin' || target === 'all') await getLinkedIn();
  console.log('\n완료. .env 업데이트됨.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
