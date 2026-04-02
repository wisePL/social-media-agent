#!/bin/bash
# Verse8 자동 발행 크론 스크립트
# GCP VM crontab:
# */30 * * * * /home/wise1/marketing-agents/check-and-publish.sh >> /home/wise1/agent.log 2>&1

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLISH_SCRIPT="$DIR/04-publisher/publish.js"
SCHED_FILE="$DIR/scheduled-publishes.json"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-and-publish start"

# .env 에서 NOTION_TOKEN 읽기
NOTION_TOKEN=$(grep '^NOTION_TOKEN=' "$DIR/.env" | cut -d'=' -f2- | tr -d '[:space:]')
NOTION_CALENDAR_DB="2bfed889-905f-8105-9313-000bb0f90cb5"

if [ -z "$NOTION_TOKEN" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ NOTION_TOKEN not found in .env"
  exit 1
fi

# Step 1: Notion에서 READY 페이지 직접 스캔 + 발행
node - "$NOTION_TOKEN" "$NOTION_CALENDAR_DB" "$PUBLISH_SCRIPT" "$DIR" "$SCHED_FILE" << 'EOF'
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [,, token, dbId, publishScript, dir, schedFile] = process.argv;

function notionPost(p, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.notion.com', path: p, method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(b);
    req.end();
  });
}

async function main() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // READY 상태이고 날짜가 오늘 이하인 페이지 조회
  const res = await notionPost(`/v1/databases/${dbId}/query`, {
    filter: {
      and: [
        { property: 'Status', status: { equals: 'READY' } },
        { property: 'Date', date: { on_or_before: today } },
      ]
    }
  });

  const pages = res.results || [];
  console.log(`[${new Date().toISOString()}] READY pages found: ${pages.length}`);

  for (const page of pages) {
    const pageId = page.id.replace(/-/g, '');
    const title = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || pageId;
    console.log(`[${new Date().toISOString()}] Publishing: "${title}" (${pageId})`);

    try {
      execSync(`node "${publishScript}" --page-id=${pageId}`, {
        cwd: dir,
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      });
      console.log(`[${new Date().toISOString()}] ✅ Done: "${title}"`);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] ❌ Failed: "${title}": ${e.message}`);
    }
  }

  // Step 2: scheduled-publishes.json pending 항목도 병행 처리 (기존 방식 유지)
  if (!fs.existsSync(schedFile)) return;
  const now = Date.now();
  const sched = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
  let updated = false;

  for (const entry of sched.schedules) {
    if (entry.status !== 'pending') continue;
    const publishAt = new Date(entry.publishAt).getTime();
    const diff = now - publishAt;
    if (diff < 0 || diff > 2 * 3600 * 1000) continue;

    console.log(`[${new Date().toISOString()}] [sched] Publishing: ${entry.title}`);
    try {
      execSync(`node "${publishScript}" --page-id=${entry.pageId}`, {
        cwd: dir, stdio: 'inherit', timeout: 5 * 60 * 1000,
      });
      entry.status = 'published';
      entry.publishedAt = new Date().toISOString();
      updated = true;
    } catch (e) {
      entry.status = 'failed';
      entry.failedAt = new Date().toISOString();
      entry.error = e.message;
      updated = true;
    }
  }

  if (updated) fs.writeFileSync(schedFile, JSON.stringify(sched, null, 2));
}

main().catch(e => {
  console.error(`[${new Date().toISOString()}] ❌ Fatal: ${e.message}`);
  process.exit(1);
});
EOF

echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-and-publish done"
