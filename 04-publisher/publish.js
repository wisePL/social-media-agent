#!/usr/bin/env node
/**
 * Verse8 Standalone Publisher
 * Claude 세션 없이 독립 실행 가능한 발행 스크립트
 *
 * Usage:
 *   node publish.js --page-id=<notion_page_id>
 *
 * .env 필수:
 *   NOTION_TOKEN
 *   TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 *   DISCORD_WEBHOOK_ANNOUNCEMENTS
 *   SLACK_BOT_TOKEN, SLACK_TEAM_CHANNEL, SLACK_NOTIFICATION_CHANNEL
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── .env 로드 ─────────────────────────────────────────────────────────────────
const ENV_PATH = path.resolve(__dirname, '../.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx < 0) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
}

// ── 인자 파싱 ─────────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach(a => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  args[k] = v.join('=');
});
const PAGE_ID = args['page-id'];
if (!PAGE_ID) { console.error('Usage: node publish.js --page-id=<id>'); process.exit(1); }

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function httpreq(options, body) {
  return new Promise((resolve, reject) => {
    const mod = (options.protocol === 'http:') ? http : https;
    const req = mod.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body)));
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeId(id) {
  const s = id.replace(/-/g, '');
  return [s.slice(0,8), s.slice(8,12), s.slice(12,16), s.slice(16,20), s.slice(20)].join('-');
}

// ── Notion API ────────────────────────────────────────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VER = '2022-06-28';

function notionHeaders(extra = {}) {
  return { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': NOTION_VER, 'Content-Type': 'application/json', ...extra };
}

async function notionGet(p) {
  const r = await httpreq({ hostname: 'api.notion.com', path: p, method: 'GET', headers: notionHeaders() });
  if (r.status >= 400) throw new Error(`Notion GET ${p}: ${r.status} ${r.raw.slice(0, 300)}`);
  return r.body;
}

async function notionPatch(p, body) {
  const b = JSON.stringify(body);
  const r = await httpreq({ hostname: 'api.notion.com', path: p, method: 'PATCH', headers: notionHeaders({ 'Content-Length': Buffer.byteLength(b) }) }, b);
  if (r.status >= 400) throw new Error(`Notion PATCH ${p}: ${r.status} ${r.raw.slice(0, 300)}`);
  return r.body;
}

// ── 페이지 + 카피 추출 ────────────────────────────────────────────────────────
async function fetchPage(pageId) {
  const id = normalizeId(pageId);
  const [page, blocks] = await Promise.all([
    notionGet(`/v1/pages/${id}`),
    notionGet(`/v1/blocks/${id}/children?page_size=100`),
  ]);

  const status = page.properties?.Status?.status?.name || '';
  const title = (page.properties?.Name?.title || []).map(t => t.plain_text).join('');

  const allBlocks = blocks.results || [];

  // ── 섹션 파싱 ──────────────────────────────────────────────────────────────
  // 지원 구조 A: callout 블록 (has_children=true) → 자식 블록에서 내용 추출
  // 지원 구조 B: quote/callout 헤딩 + flat 형제 블록 (구버전 호환)
  // Tweet 스레드: "Tweet" 포함 heading 순서대로 tweetSections 배열에 누적
  const NON_TWEET_KEYS = ['Instagram', 'Facebook', 'LinkedIn', 'Discord'];
  const sections = {};       // channelKey → { siblingBlocks:[], calloutBlock:null }
  const tweetSections = [];  // [{ siblingBlocks:[], calloutBlock:null }, ...]

  let currentKey = null;
  let currentTweetIdx = -1;

  for (const b of allBlocks) {
    let headingText = null;
    if (b.type === 'quote') {
      headingText = (b.quote?.rich_text || []).map(t => t.plain_text).join('').trim();
    } else if (b.type === 'callout') {
      headingText = (b.callout?.rich_text || []).map(t => t.plain_text).join('').trim();
    }

    if (headingText !== null) {
      if (headingText.includes('Tweet')) {
        // 새 트윗 섹션 추가 (스레드 순서 유지)
        const sec = { siblingBlocks: [], calloutBlock: null };
        if (b.type === 'callout' && b.has_children) sec.calloutBlock = b;
        tweetSections.push(sec);
        currentTweetIdx = tweetSections.length - 1;
        currentKey = '__tweet__';
        continue;
      }
      const matchedKey = NON_TWEET_KEYS.find(k => headingText.includes(k));
      if (matchedKey) {
        currentKey = matchedKey;
        currentTweetIdx = -1;
        if (!sections[currentKey]) sections[currentKey] = { siblingBlocks: [], calloutBlock: null };
        if (b.type === 'callout' && b.has_children) sections[currentKey].calloutBlock = b;
        continue;
      }
      // 비채널 헤딩 → 섹션 종료
      currentKey = null;
      currentTweetIdx = -1;
    }

    if (b.type === 'divider') { currentKey = null; currentTweetIdx = -1; continue; }

    if (currentKey === '__tweet__' && currentTweetIdx >= 0) {
      tweetSections[currentTweetIdx].siblingBlocks.push(b);
    } else if (currentKey && currentKey !== '__tweet__') {
      sections[currentKey].siblingBlocks.push(b);
    }
  }

  console.log('   tweets:', tweetSections.length, '| sections:', Object.keys(sections));

  // ── 섹션 내용 추출 ─────────────────────────────────────────────────────────
  async function extractFromSection(section) {
    if (!section) return null;

    let childBlocks = section.siblingBlocks;
    if (section.calloutBlock) {
      const ch = await notionGet(`/v1/blocks/${section.calloutBlock.id}/children?page_size=50`);
      childBlocks = ch.results || [];
    }
    if (!childBlocks.length) return null;

    let text = '';
    let mediaUrl = null;
    let mediaType = null;

    // 노션 템플릿 가이드 문구 패턴 (실제 copy가 아닌 지시 텍스트)
    const GUIDE_PATTERNS = [
      /← 카피를/,
      /카피를 여기에/,
      /타겟\s*\|.*자↓/,
      /해시태그 금지/,
      /link in bio CTA/i,
      /마크다운 활용/,
      /선택사항\)/,
      /^Web3 degen 타겟/,
      /설명형 1-3문단/,
      /데이터·트랙션 중심/,
      /캐주얼 톤\s*\|/,
      /전문적 톤\s*\|/,
    ];

    for (const c of childBlocks) {
      if (c.type === 'paragraph') {
        const t = (c.paragraph?.rich_text || []).map(r => {
          if (r.type === 'text') return r.text.content;
          if (r.href) return r.href;
          return r.plain_text || '';
        }).join('');
        const trimmed = t.trim();
        // 가이드/지시 문구는 스킵
        if (!trimmed || GUIDE_PATTERNS.some(p => p.test(trimmed))) continue;
        text += (text ? '\n' : '') + trimmed;
      }
      if (c.type === 'image') {
        mediaUrl = c.image?.file?.url || c.image?.external?.url;
        mediaType = 'image';
      }
      if (c.type === 'video') {
        mediaUrl = c.video?.file?.url || c.video?.external?.url;
        mediaType = 'video';
      }
      if (c.type === 'bookmark' && c.bookmark?.url) {
        if (!text.includes(c.bookmark.url)) text += (text ? '\n' : '') + c.bookmark.url;
      }
    }
    return (text || mediaUrl) ? { text, mediaUrl, mediaType } : null;
  }

  const [tweetContentsRaw, discordContent, instagramContent, facebookContent, linkedinContent] = await Promise.all([
    Promise.all(tweetSections.map(extractFromSection)),
    extractFromSection(sections['Discord']),
    extractFromSection(sections['Instagram']),
    extractFromSection(sections['Facebook']),
    extractFromSection(sections['LinkedIn']),
  ]);

  // null 필터링 (내용 없는 트윗 제거)
  const tweetContents = tweetContentsRaw.filter(Boolean);

  console.log('   tweet(s):', tweetContents.length, '| discord:', !!discordContent?.text, '| ig:', !!instagramContent?.text, '| fb:', !!facebookContent?.text, '| li:', !!linkedinContent?.text);

  return { id, title, status, tweetContents, discordContent, instagramContent, facebookContent, linkedinContent };
}

// ── 미디어 다운로드 ───────────────────────────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close(); return get(res.headers.location);
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve({ contentType: res.headers['content-type'] || 'application/octet-stream' });
        });
      }).on('error', e => { fs.unlink(dest, () => {}); reject(e); });
    };
    get(url);
  });
}

// ── Twitter OAuth 1.0a ────────────────────────────────────────────────────────
function oauthHeader(method, url, extra = {}) {
  const { TWITTER_API_KEY: ck, TWITTER_API_SECRET: cs, TWITTER_ACCESS_TOKEN: at, TWITTER_ACCESS_SECRET: ats } = process.env;
  const enc = s => encodeURIComponent(String(s));
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const params = { oauth_consumer_key: ck, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts, oauth_token: at, oauth_version: '1.0', ...extra };
  const base = `${method}&${enc(url)}&${enc(Object.entries(params).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${enc(k)}=${enc(v)}`).join('&'))}`;
  const sig = crypto.createHmac('sha1', `${enc(cs)}&${enc(ats)}`).update(base).digest('base64');
  params.oauth_signature = sig;
  return 'OAuth ' + Object.entries(params).filter(([k])=>k.startsWith('oauth_')).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${enc(k)}="${enc(v)}"`).join(', ');
}

// ── Twitter: 이미지 업로드 ────────────────────────────────────────────────────
async function uploadImage(filePath, contentType) {
  const data = fs.readFileSync(filePath);
  const boundary = 'V8Boundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const r = await httpreq({
    hostname: 'upload.twitter.com', path: '/1.1/media/upload.json', method: 'POST',
    headers: { Authorization: oauthHeader('POST', url), 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
  }, body);
  if (r.status >= 400) throw new Error(`Twitter image upload: ${r.raw.slice(0,300)}`);
  return r.body.media_id_string;
}

// ── Twitter: 동영상 청크 업로드 ───────────────────────────────────────────────
async function uploadVideo(filePath) {
  const data = fs.readFileSync(filePath);
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';

  // INIT
  const initBody = `command=INIT&total_bytes=${data.length}&media_type=video%2Fmp4&media_category=tweet_video`;
  const initR = await httpreq({
    hostname: 'upload.twitter.com', path: '/1.1/media/upload.json', method: 'POST',
    headers: { Authorization: oauthHeader('POST', uploadUrl), 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(initBody) },
  }, initBody);
  if (initR.status >= 400) throw new Error(`Video INIT: ${initR.raw.slice(0,300)}`);
  const mediaId = initR.body.media_id_string;

  // APPEND (5MB chunks)
  const CHUNK = 5 * 1024 * 1024;
  for (let i = 0, seg = 0; i < data.length; i += CHUNK, seg++) {
    const chunk = data.slice(i, i + CHUNK);
    const boundary = 'V8Chunk' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"\r\n\r\n`),
      chunk,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await httpreq({
      hostname: 'upload.twitter.com', path: '/1.1/media/upload.json', method: 'POST',
      headers: { Authorization: oauthHeader('POST', uploadUrl), 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, body);
    if (r.status >= 400) throw new Error(`Video APPEND seg${seg}: ${r.raw.slice(0,300)}`);
    console.log(`  chunk ${seg+1} uploaded`);
  }

  // FINALIZE
  const finBody = `command=FINALIZE&media_id=${mediaId}`;
  const finR = await httpreq({
    hostname: 'upload.twitter.com', path: '/1.1/media/upload.json', method: 'POST',
    headers: { Authorization: oauthHeader('POST', uploadUrl), 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(finBody) },
  }, finBody);
  if (finR.status >= 400) throw new Error(`Video FINALIZE: ${finR.raw.slice(0,300)}`);

  // 처리 완료 대기
  let proc = finR.body.processing_info;
  while (proc && proc.state !== 'succeeded') {
    if (proc.state === 'failed') throw new Error('Video processing failed');
    const wait = (proc.check_after_secs || 5) * 1000;
    console.log(`  processing... ${proc.state} (${wait/1000}s)`);
    await sleep(wait);
    const stR = await httpreq({
      hostname: 'upload.twitter.com', path: `/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`, method: 'GET',
      headers: { Authorization: oauthHeader('GET', `${uploadUrl}?command=STATUS&media_id=${mediaId}`) },
    });
    proc = stR.body.processing_info;
  }
  return mediaId;
}

// ── Twitter: 트윗 발행 ────────────────────────────────────────────────────────
async function postTweet(text, mediaId, replyTo) {
  const body = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const url = 'https://api.twitter.com/2/tweets';
  const b = JSON.stringify(body);
  const r = await httpreq({
    hostname: 'api.twitter.com', path: '/2/tweets', method: 'POST',
    headers: { Authorization: oauthHeader('POST', url), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
  }, b);
  if (r.status >= 400) throw new Error(`Tweet post: ${r.raw.slice(0,300)}`);
  return r.body.data.id;
}

// ── Discord ───────────────────────────────────────────────────────────────────
async function postDiscord(content, imagePath) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_ANNOUNCEMENTS;
  if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_ANNOUNCEMENTS not set');
  const u = new URL(webhookUrl);

  if (imagePath) {
    const imgData = fs.readFileSync(imagePath);
    const boundary = 'V8Discord' + Date.now();
    const payloadJson = JSON.stringify({ content });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n\r\n${payloadJson}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imgData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await httpreq({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, body);
    if (r.status >= 400) throw new Error(`Discord post: ${r.raw.slice(0,300)}`);
  } else {
    const b = JSON.stringify({ content });
    const r = await httpreq({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, b);
    if (r.status >= 400) throw new Error(`Discord post: ${r.raw.slice(0,300)}`);
  }
}

// ── Slack ─────────────────────────────────────────────────────────────────────
async function slackPost(channel, text) {
  const b = JSON.stringify({ channel, text });
  await httpreq({
    hostname: 'slack.com', path: '/api/chat.postMessage', method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) },
  }, b);
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────
async function linkedinRegisterImageUpload(authorUrn, token) {
  const body = JSON.stringify({
    registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      owner: authorUrn,
      serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
    },
  });
  const r = await httpreq({
    hostname: 'api.linkedin.com', path: '/v2/assets?action=registerUpload', method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (r.status >= 400) throw new Error(`LinkedIn registerUpload: ${r.raw.slice(0, 300)}`);
  const uploadUrl = r.body.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const asset = r.body.value.asset;
  return { uploadUrl, asset };
}

async function postLinkedIn(text, imageFilePath) {
  const authorUrn = process.env.LINKEDIN_ORGANIZATION_URN;
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!authorUrn || !token) throw new Error('LINKEDIN_ACCESS_TOKEN / LINKEDIN_ORGANIZATION_URN not set');

  let mediaCategory = 'NONE';
  let mediaArray;
  if (imageFilePath) {
    console.log('   LinkedIn image upload...');
    const { uploadUrl, asset } = await linkedinRegisterImageUpload(authorUrn, token);
    const imgData = fs.readFileSync(imageFilePath);
    const u = new URL(uploadUrl);
    await httpreq({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': imgData.length } }, imgData);
    mediaCategory = 'IMAGE';
    mediaArray = [{ status: 'READY', media: asset }];
  }

  const postBody = JSON.stringify({
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: mediaCategory,
        ...(mediaArray ? { media: mediaArray } : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  });
  const r = await httpreq({
    hostname: 'api.linkedin.com', path: '/v2/ugcPosts', method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Length': Buffer.byteLength(postBody) },
  }, postBody);
  if (r.status >= 400) throw new Error(`LinkedIn post: ${r.raw.slice(0, 300)}`);
  return String(r.headers['x-restli-id'] || r.body?.id || '');
}

// ── Facebook ──────────────────────────────────────────────────────────────────
// 시스템 유저 토큰 → Page Access Token 자동 교환
async function getFacebookPageToken(pageId, token) {
  const r = await httpreq({
    hostname: 'graph.facebook.com',
    path: `/v19.0/${pageId}?fields=access_token`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status >= 400 || !r.body?.access_token) return token; // 교환 실패 시 원본 사용
  return r.body.access_token;
}

async function postFacebook(text, imageUrl) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const rawToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !rawToken) throw new Error('FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN not set');

  // 시스템 유저 토큰인 경우 Page Access Token으로 교환
  const token = await getFacebookPageToken(pageId, rawToken);

  const p     = imageUrl ? `/v19.0/${pageId}/photos` : `/v19.0/${pageId}/feed`;
  const bodyObj = imageUrl
    ? { caption: text, url: imageUrl, access_token: token }
    : { message: text, access_token: token };
  const b = JSON.stringify(bodyObj);
  const r = await httpreq({
    hostname: 'graph.facebook.com', path: p, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) },
  }, b);
  if (r.status >= 400) throw new Error(`Facebook post: ${r.raw.slice(0, 300)}`);
  return String(r.body?.post_id || r.body?.id || '');
}

// ── Instagram ─────────────────────────────────────────────────────────────────
async function postInstagram(caption, imageUrl) {
  const igId    = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const rawToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!igId || !rawToken) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID / FACEBOOK_PAGE_ACCESS_TOKEN not set');
  // 시스템 유저 토큰인 경우 Page Access Token으로 교환
  const token = await getFacebookPageToken(process.env.FACEBOOK_PAGE_ID, rawToken);
  if (!imageUrl) { console.log('   Instagram skipped (이미지 없음 — 필수)'); return null; }

  // Step 1: Create media container
  const cb = JSON.stringify({ image_url: imageUrl, caption, access_token: token });
  const cr = await httpreq({
    hostname: 'graph.facebook.com', path: `/v19.0/${igId}/media`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cb) },
  }, cb);
  if (cr.status >= 400) throw new Error(`Instagram media create: ${cr.raw.slice(0, 300)}`);
  const containerId = cr.body.id;
  console.log(`   container: ${containerId}`);
  await sleep(2000);

  // Step 2: Publish
  const pb = JSON.stringify({ creation_id: containerId, access_token: token });
  const pr = await httpreq({
    hostname: 'graph.facebook.com', path: `/v19.0/${igId}/media_publish`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pb) },
  }, pb);
  if (pr.status >= 400) throw new Error(`Instagram publish: ${pr.raw.slice(0, 300)}`);
  return String(pr.body?.id || '');
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Verse8 Publisher — ${PAGE_ID}`);

  if (!NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN not set in .env');
    process.exit(1);
  }

  // 1. Notion 페이지 가져오기
  console.log('📄 Fetching page...');
  const { id, title, status, tweetContents, discordContent, instagramContent, facebookContent, linkedinContent } = await fetchPage(PAGE_ID);
  console.log(`   "${title}" | Status: ${status}`);

  if (status !== 'READY') {
    console.error(`❌ Status is "${status}" (READY 필요)`);
    process.exit(1);
  }

  const tmpFiles = [];

  // 2. Twitter
  console.log('\n🐦 Twitter...');
  let twitterUrl = null;
  try {
    let lastId = null;
    for (let i = 0; i < tweetContents.length; i++) {
      const tc = tweetContents[i];
      if (!tc?.text) continue;

      let mediaId = null;
      if (tc.mediaUrl) {
        const tmp = `/tmp/v8media_${Date.now()}`;
        tmpFiles.push(tmp);
        console.log(`   media download (${tc.mediaType})...`);
        await download(tc.mediaUrl, tmp);
        if (tc.mediaType === 'video') {
          console.log('   video upload (chunked)...');
          mediaId = await uploadVideo(tmp);
        } else {
          mediaId = await uploadImage(tmp, 'image/jpeg');
        }
        console.log(`   media_id: ${mediaId}`);
      }

      const tweetId = await postTweet(tc.text, mediaId, lastId);
      if (i === 0) twitterUrl = `https://x.com/Verse_Eight/status/${tweetId}`;
      lastId = tweetId;
      console.log(`   tweet ${i+1}: ${tweetId}`);
    }
  } catch (e) {
    console.error(`❌ Twitter: ${e.message}`);
    await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⚠️ 발행 오류 [Twitter]: ${title}\n${e.message}`);
  }

  // 3. Discord
  console.log('\n💬 Discord...');
  try {
    if (discordContent?.text) {
      let imageTmp = null;
      if (discordContent.mediaUrl && discordContent.mediaType === 'image') {
        imageTmp = `/tmp/v8discord_${Date.now()}`;
        tmpFiles.push(imageTmp);
        await download(discordContent.mediaUrl, imageTmp);
      }
      await postDiscord(discordContent.text, imageTmp);
      console.log('   posted ✅');
    }
  } catch (e) {
    console.error(`❌ Discord: ${e.message}`);
    try { await sleep(5000); await postDiscord(discordContent?.text || ''); } catch {}
    await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⚠️ 발행 오류 [Discord]: ${title}\n${e.message}`);
  }

  // 4. LinkedIn
  let linkedinPostId = null;
  if (linkedinContent?.text && process.env.LINKEDIN_ACCESS_TOKEN) {
    console.log('\n💼 LinkedIn...');
    try {
      let imageTmp = null;
      if (linkedinContent.mediaUrl && linkedinContent.mediaType === 'image') {
        imageTmp = `/tmp/v8li_${Date.now()}`;
        tmpFiles.push(imageTmp);
        await download(linkedinContent.mediaUrl, imageTmp);
      }
      linkedinPostId = await postLinkedIn(linkedinContent.text, imageTmp);
      console.log(`   posted ✅ ${linkedinPostId}`);
    } catch (e) {
      console.error(`❌ LinkedIn: ${e.message}`);
      await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⚠️ 발행 오류 [LinkedIn]: ${title}\n${e.message}`);
    }
  } else if (linkedinContent?.text) {
    console.log('\n💼 LinkedIn skipped (LINKEDIN_ACCESS_TOKEN not set)');
  }

  // 5. Facebook
  let facebookPostId = null;
  if (facebookContent?.text && process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    console.log('\n📘 Facebook...');
    try {
      const imageUrl = facebookContent.mediaUrl || null;
      facebookPostId = await postFacebook(facebookContent.text, imageUrl);
      console.log(`   posted ✅ ${facebookPostId}`);
    } catch (e) {
      console.error(`❌ Facebook: ${e.message}`);
      await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⚠️ 발행 오류 [Facebook]: ${title}\n${e.message}`);
    }
  } else if (facebookContent?.text) {
    console.log('\n📘 Facebook skipped (FACEBOOK_PAGE_ACCESS_TOKEN not set)');
  }

  // 6. Instagram
  let instagramMediaId = null;
  if (instagramContent?.text && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    console.log('\n📸 Instagram...');
    try {
      const imageUrl = instagramContent.mediaUrl || null;
      instagramMediaId = await postInstagram(instagramContent.text, imageUrl);
      if (instagramMediaId) console.log(`   posted ✅ ${instagramMediaId}`);
    } catch (e) {
      console.error(`❌ Instagram: ${e.message}`);
      await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⚠️ 발행 오류 [Instagram]: ${title}\n${e.message}`);
    }
  } else if (instagramContent?.text) {
    console.log('\n📸 Instagram skipped (INSTAGRAM_BUSINESS_ACCOUNT_ID not set)');
  }

  // 7. Notion → LIVE
  console.log('\n📋 Notion → LIVE...');
  await notionPatch(`/v1/pages/${id}`, { properties: { Status: { status: { name: 'LIVE' } } } });
  console.log('   updated ✅');

  // 8. scheduled-publishes.json 업데이트
  const schedPath = path.resolve(__dirname, '../scheduled-publishes.json');
  if (fs.existsSync(schedPath)) {
    try {
      const sched = JSON.parse(fs.readFileSync(schedPath, 'utf8'));
      const entry = sched.schedules.find(s => s.pageId.replace(/-/g,'') === PAGE_ID.replace(/-/g,''));
      if (entry) {
        entry.status = 'published';
        entry.publishedAt = new Date().toISOString();
        entry.twitterUrl = twitterUrl;
        if (linkedinPostId)   entry.linkedinPostId   = linkedinPostId;
        if (facebookPostId)   entry.facebookPostId   = facebookPostId;
        if (instagramMediaId) entry.instagramMediaId = instagramMediaId;
        entry.analyticsStatus = 'pending';
      }
      fs.writeFileSync(schedPath, JSON.stringify(sched, null, 2));
    } catch (e) { console.warn('scheduled-publishes.json update skipped:', e.message); }
  }

  // 9. Slack 팀 알림
  const kst = new Date(Date.now() + 9*3600000).toISOString().replace('T',' ').slice(0,16) + ' KST';
  const publishedChannels = [
    twitterUrl       ? `🐦 Twitter: ${twitterUrl}` : null,
    discordContent?.text ? `💬 Discord: #major-announcement` : null,
    linkedinPostId   ? `💼 LinkedIn: 게시 완료` : null,
    facebookPostId   ? `📘 Facebook: 게시 완료` : null,
    instagramMediaId ? `📸 Instagram: 게시 완료` : null,
  ].filter(Boolean);
  await slackPost(process.env.SLACK_TEAM_CHANNEL, [
    `🚀 *${title}* 발행 완료!`,
    '',
    ...publishedChannels,
    `⏰ ${kst}`,
    '',
    `⚡ *First Hour Actions:*`,
    `→ 댓글 즉시 답변 | 팀 RT 요청 | 관련 커뮤니티 공유`,
  ].join('\n'));
  console.log('   Slack ✅');

  // 임시 파일 정리
  tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });

  console.log(`\n✅ Done: ${title}`);
  if (twitterUrl) console.log(`   ${twitterUrl}`);
}

main().catch(async e => {
  console.error('❌ Fatal:', e.message);
  try { await slackPost(process.env.SLACK_NOTIFICATION_CHANNEL, `⛔ 발행 치명 오류: ${PAGE_ID}\n${e.message}`); } catch {}
  process.exit(1);
});
