#!/usr/bin/env node
/**
 * fix-template.js
 * TEMPLATE 페이지를 채널별 callout 블록 구조로 복원
 *
 * Usage: node fix-template.js
 */

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

const TOKEN    = env.NOTION_TOKEN;
const TEMPLATE_ID = '2bfed889-905f-8100-af78-c527d8069f47';
const VER      = '2022-06-28';

function notionReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : undefined;
    const r = https.request({
      hostname: 'api.notion.com', path: p, method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': VER,
        'Content-Type': 'application/json',
        ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function callout(emoji, heading, bodyLines = []) {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: `${emoji} ${heading}` } }],
      icon: { type: 'emoji', emoji },
      color: 'gray_background',
      children: bodyLines.map(line => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      })),
    },
  };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function heading3(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function bulletItem(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

async function main() {
  console.log('📄 TEMPLATE callout 구조 복원 시작...\n');

  // 1. 기존 블록 목록 가져오기
  const res = await notionReq('GET', `/v1/blocks/${TEMPLATE_ID}/children?page_size=100`);
  if (res.status >= 400) {
    console.error('블록 목록 가져오기 실패:', res.body);
    process.exit(1);
  }

  const existing = res.body.results || [];
  console.log(`기존 블록 ${existing.length}개 삭제 중...`);

  // 2. 기존 블록 아카이브 (삭제)
  for (const b of existing) {
    await notionReq('PATCH', `/v1/blocks/${b.id}`, { archived: true });
    await sleep(200);
  }
  console.log('  삭제 완료\n');

  // 3. 새 callout 구조 추가
  const newBlocks = [
    // Task Details
    callout('📋', 'Task Details — 이 공지의 배경, 목적, 핵심 메시지를 여기에 작성하세요.', [
      '(예: 어떤 이벤트인지, 언제인지, 무엇을 알려야 하는지, 특별히 강조할 점)',
    ]),

    divider(),

    // ── 채널 섹션 헤딩 ──
    heading3('📢 Channel Copy'),

    // Twitter — 단일 트윗
    callout('🐦', 'Tweet (Web3)', [
      'Web3 degen 타겟 | 280자↓ | 해시태그 금지',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    // Twitter Thread (선택) — 트윗 2
    callout('🐦', 'Tweet 2 (Web3)', [
      '스레드 두 번째 트윗 (선택사항)',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    // Instagram
    callout('📱', 'Instagram (Web2)', [
      '캐주얼 톤 | 150자↓ | 해시태그 5-10개 | link in bio CTA',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    // Facebook
    callout('👥', 'Facebook (Web2)', [
      '설명형 1-3문단 | 링크 직접 포함 | 질문으로 끝내기',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    // LinkedIn
    callout('💼', 'LinkedIn (B2B)', [
      '데이터·트랙션 중심 | 전문적 톤 | 3-5문단',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    // Discord
    callout('💬', 'Discord Announcement (Community)', [
      '마크다운 활용 | @everyone 마지막에',
      '',
      '← 카피를 여기에 작성하세요',
    ]),

    divider(),

    // Graphic Request
    callout('🎨', 'Graphic Request', [
      '디자이너에게 전달할 이미지 브리프를 여기에 작성하세요.',
      '',
      '채널별 사이즈 (같은 크리에이티브, 비율만 변경):',
      '• Twitter / Discord: 1600×900px (16:9)',
      '• Instagram Feed: 1080×1080px (1:1) 또는 1080×1350px (4:5 권장)',
      '• Instagram Story: 1080×1920px (9:16)',
      '• Facebook / LinkedIn: 1200×630px (1.91:1)',
    ]),

    // Design Output
    callout('🖼️', 'Design Output', [
      '완성된 이미지 링크 또는 파일을 여기에 첨부하세요.',
    ]),
  ];

  console.log(`새 블록 ${newBlocks.length}개 추가 중...`);

  // Notion API: 한 번에 최대 100개 children 추가 가능
  const addRes = await notionReq('PATCH', `/v1/blocks/${TEMPLATE_ID}/children`, {
    children: newBlocks,
  });

  if (addRes.status >= 400) {
    console.error('블록 추가 실패:', JSON.stringify(addRes.body, null, 2).slice(0, 500));
    process.exit(1);
  }

  console.log('  추가 완료 ✅\n');
  console.log('✅ TEMPLATE callout 구조 복원 완료!');
  console.log('   Tweet + Tweet 2 (스레드) + Instagram + Facebook + LinkedIn + Discord');
}

main().catch(e => { console.error(e); process.exit(1); });
