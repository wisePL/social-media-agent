#!/usr/bin/env node
/**
 * Verse8 OAuth Token Helper
 * LinkedIn + Meta (Facebook/Instagram) 액세스 토큰 발급 도우미
 *
 * 사전 준비:
 *   LinkedIn Developer Portal → 앱 → Auth → Authorized redirect URLs 에 추가:
 *     http://localhost:3000/callback
 *   Meta for Developers → 앱 → Settings → Valid OAuth Redirect URIs 에 추가:
 *     http://localhost:3000/callback
 *
 * Usage:
 *   node get-tokens.js linkedin   ← LinkedIn만
 *   node get-tokens.js meta       ← Facebook + Instagram만
 *   node get-tokens.js            ← 둘 다
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── .env 로드 ─────────────────────────────────────────────────────────────────
const ENV_PATH = path.resolve(__dirname, '.env');
const env = {};
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx < 0) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key && val) env[key] = val;
  });
}

const REDIRECT_URI = 'http://localhost:3000/callback';
const enc = s => encodeURIComponent(s);

// ── HTTP 유틸 ─────────────────────────────────────────────────────────────────
function httpreq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── 로컬 콜백 서버 ─────────────────────────────────────────────────────────────
function waitForCallback(port = 3000) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(code
        ? '<h2>✅ 인증 완료! 이 탭을 닫고 터미널로 돌아오세요.</h2>'
        : `<h2>⛔ 오류: ${error}</h2><p>터미널을 확인하세요.</p>`);
      server.close();
      resolve({ code, error });
    });
    server.listen(port, () => {
      console.log(`  ✅ 로컬 서버 실행 중 (http://localhost:${port}/callback)`);
    });
  });
}

// ── .env 값 업데이트 ──────────────────────────────────────────────────────────
function saveToEnv(key, value) {
  if (!fs.existsSync(ENV_PATH)) { console.warn('  .env 파일 없음 — 토큰을 수동으로 저장하세요'); return; }
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^(${key}=).*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content);
  console.log(`  💾 .env에 ${key} 저장됨`);
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────
async function getLinkedInToken() {
  const clientId     = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientId.trim() === '') {
    console.error('❌ LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET 가 .env에 없습니다');
    return;
  }

  const scopes = ['w_organization_social', 'r_organization_social', 'r_basicprofile'];
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${enc(clientId)}&redirect_uri=${enc(REDIRECT_URI)}&scope=${enc(scopes.join(' '))}`;

  console.log('\n─────────────────────────────────────────');
  console.log('💼 LinkedIn Access Token 발급');
  console.log('─────────────────────────────────────────');
  console.log('\n① 아래 URL을 브라우저에서 여세요:\n');
  console.log('  ' + authUrl + '\n');
  console.log('② LinkedIn 로그인 → 권한 승인');
  console.log('③ http://localhost:3000/callback 으로 자동 이동됩니다\n');

  const { code, error } = await waitForCallback(3000);
  if (error || !code) { console.error('❌ 인증 실패:', error); return; }
  console.log(`  Authorization code: ${code.slice(0, 15)}...`);

  // 토큰 교환
  console.log('  Token 교환 중...');
  const body = `grant_type=authorization_code&code=${enc(code)}&redirect_uri=${enc(REDIRECT_URI)}&client_id=${enc(clientId)}&client_secret=${enc(clientSecret)}`;
  const r = await httpreq({
    hostname: 'www.linkedin.com', path: '/oauth/v2/accessToken', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);

  if (r.status >= 400) { console.error('❌ Token 교환 실패:', r.raw.slice(0, 300)); return; }
  const { access_token, expires_in, refresh_token } = r.body;
  const days = Math.floor((expires_in || 5184000) / 86400);

  console.log(`\n✅ LinkedIn Access Token 발급 완료! (유효기간: ${days}일)`);
  saveToEnv('LINKEDIN_ACCESS_TOKEN', access_token);
  if (refresh_token) saveToEnv('LINKEDIN_REFRESH_TOKEN', refresh_token);

  // 관리 조직 조회
  console.log('\n  조직 정보 조회 중...');
  try {
    const orgR = await httpreq({
      hostname: 'api.linkedin.com',
      path: '/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName)))',
      method: 'GET',
      headers: { Authorization: `Bearer ${access_token}`, 'X-Restli-Protocol-Version': '2.0.0' },
    });
    const elements = orgR.body?.elements || [];
    if (elements.length > 0) {
      console.log('\n  관리 중인 LinkedIn 조직:');
      for (const el of elements) {
        const org = el['organization~'];
        const urn = `urn:li:organization:${org.id}`;
        console.log(`    ${org.localizedName} → LINKEDIN_ORGANIZATION_URN=${urn}`);
        if (elements.length === 1) saveToEnv('LINKEDIN_ORGANIZATION_URN', urn);
      }
      if (elements.length > 1) console.log('\n  → 사용할 조직을 골라 .env에 LINKEDIN_ORGANIZATION_URN 수동 입력');
    } else {
      console.log('  조직 없음 — LinkedIn 회사 페이지 URL에서 ID를 직접 확인하세요');
      console.log('  예: linkedin.com/company/verse-eight → 숫자 ID 확인 후 LINKEDIN_ORGANIZATION_URN=urn:li:organization:XXXXX');
    }
  } catch (e) {
    console.warn('  조직 조회 실패 (권한 부족할 수 있음):', e.message);
  }
}

// ── Meta (Facebook + Instagram) ───────────────────────────────────────────────
async function getMetaToken() {
  const appId     = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  if (!appId || !appSecret) {
    console.error('❌ META_APP_ID / META_APP_SECRET 가 .env에 없습니다');
    return;
  }

  const scopes = [
    'pages_manage_posts', 'pages_read_engagement',
    'instagram_basic', 'instagram_content_publish',
    'pages_show_list', 'business_management',
  ].join(',');
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${enc(appId)}&redirect_uri=${enc(REDIRECT_URI)}&scope=${enc(scopes)}&response_type=code`;

  console.log('\n─────────────────────────────────────────');
  console.log('📘 Meta (Facebook + Instagram) Token 발급');
  console.log('─────────────────────────────────────────');
  console.log('\n① 아래 URL을 브라우저에서 여세요:\n');
  console.log('  ' + authUrl + '\n');
  console.log('② Facebook 로그인 → 권한 승인 (페이지 관리 권한 포함)');
  console.log('③ http://localhost:3000/callback 으로 자동 이동됩니다\n');

  const { code, error } = await waitForCallback(3000);
  if (error || !code) { console.error('❌ 인증 실패:', error); return; }
  console.log(`  Authorization code: ${code.slice(0, 15)}...`);

  // 단기 토큰 교환
  console.log('  Token 교환 중...');
  const shortR = await httpreq({
    hostname: 'graph.facebook.com',
    path: `/v19.0/oauth/access_token?client_id=${enc(appId)}&redirect_uri=${enc(REDIRECT_URI)}&client_secret=${enc(appSecret)}&code=${enc(code)}`,
    method: 'GET',
  });
  if (shortR.status >= 400) { console.error('❌ Token 교환 실패:', shortR.raw.slice(0, 300)); return; }
  const shortToken = shortR.body.access_token;

  // 장기 토큰 교환 (60일)
  const ltR = await httpreq({
    hostname: 'graph.facebook.com',
    path: `/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${enc(appId)}&client_secret=${enc(appSecret)}&fb_exchange_token=${enc(shortToken)}`,
    method: 'GET',
  });
  const longToken = ltR.body?.access_token || shortToken;
  const longExpiry = ltR.body?.expires_in ? Math.floor(ltR.body.expires_in / 86400) : 60;
  console.log(`\n✅ Meta User Token 발급 완료! (유효기간: ~${longExpiry}일)`);

  // 관리 페이지 목록
  console.log('\n  Facebook 페이지 조회 중...');
  const pagesR = await httpreq({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/accounts?access_token=${enc(longToken)}`,
    method: 'GET',
  });

  const pages = pagesR.body?.data || [];
  if (pages.length === 0) {
    console.log('  ⚠️ 관리 페이지 없음 — Facebook Business Page가 있어야 합니다');
    return;
  }

  console.log(`\n  관리 중인 Facebook 페이지 (${pages.length}개):`);
  for (const page of pages) {
    console.log(`\n  📄 ${page.name} (ID: ${page.id})`);
    console.log(`     Page Access Token: ${page.access_token.slice(0, 30)}...`);

    // Page 장기 토큰 교환
    const pageLtR = await httpreq({
      hostname: 'graph.facebook.com',
      path: `/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${enc(appId)}&client_secret=${enc(appSecret)}&fb_exchange_token=${enc(page.access_token)}`,
      method: 'GET',
    });
    const pageLongToken = pageLtR.body?.access_token || page.access_token;

    // Instagram Business Account 조회
    const igR = await httpreq({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${page.id}?fields=instagram_business_account&access_token=${enc(pageLongToken)}`,
      method: 'GET',
    });
    const igId = igR.body?.instagram_business_account?.id;

    if (pages.length === 1) {
      saveToEnv('FACEBOOK_PAGE_ID', page.id);
      saveToEnv('FACEBOOK_PAGE_ACCESS_TOKEN', pageLongToken);
      if (igId) {
        saveToEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', igId);
        console.log(`     Instagram Business ID: ${igId} ✅`);
      } else {
        console.log('     ⚠️ Instagram Business Account 없음 — 페이지에 Instagram 계정 연결 필요');
      }
    } else {
      console.log(`     FACEBOOK_PAGE_ID=${page.id}`);
      console.log(`     FACEBOOK_PAGE_ACCESS_TOKEN=${pageLongToken}`);
      if (igId) console.log(`     INSTAGRAM_BUSINESS_ACCOUNT_ID=${igId}`);
    }
  }

  if (pages.length > 1) {
    console.log('\n  → 사용할 페이지를 골라 .env에 수동 입력하세요');
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  const target = process.argv[2] || 'all';
  console.log('\n🔑 Verse8 OAuth Token Helper');
  console.log('사전 준비: 아래 두 곳에 redirect URI를 등록했는지 확인하세요');
  console.log('  LinkedIn Developer Portal → Auth → Redirect URLs: http://localhost:3000/callback');
  console.log('  Meta for Developers → App Settings → Valid OAuth Redirect URIs: http://localhost:3000/callback\n');

  if (target === 'linkedin' || target === 'all') await getLinkedInToken();
  if (target === 'meta'     || target === 'all') await getMetaToken();

  console.log('\n─────────────────────────────────────────');
  console.log('✅ 완료! .env 파일에 토큰이 저장되었습니다.');
  console.log('GCP VM에도 적용하려면:');
  console.log('  ssh wise1@136.115.203.93');
  console.log('  nano /home/wise1/marketing-agents/.env');
  console.log('─────────────────────────────────────────\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
