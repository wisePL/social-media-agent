#!/bin/bash
# Verse8 자동 발행 크론 스크립트
# GCP VM crontab:
# 30분마다 발행 체크: */30 * * * * /home/wise1/marketing-agents/check-and-publish.sh >> /home/wise1/agent.log 2>&1
# 30분마다 댓글 감지: 7,37 * * * * cd /home/wise1/marketing-agents && claude --print "00-comment-watcher/SKILL.md를 읽고 미처리 댓글 커맨드를 스캔해서 실행하라." >> /home/wise1/agent.log 2>&1

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SCHED_FILE="$DIR/scheduled-publishes.json"
PUBLISH_SCRIPT="$DIR/04-publisher/publish.js"

if [ ! -f "$SCHED_FILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] scheduled-publishes.json not found, skipping"
  exit 0
fi

NOW=$(date -u +%s)

# jq 없을 경우 node로 파싱
node - "$SCHED_FILE" "$NOW" "$PUBLISH_SCRIPT" "$DIR" << 'EOF'
const fs = require('fs');
const { execSync } = require('child_process');
const [,, schedFile, nowStr, publishScript, dir] = process.argv;

const now = parseInt(nowStr) * 1000;
const sched = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
let updated = false;

for (const entry of sched.schedules) {
  if (entry.status !== 'pending') continue;

  const publishAt = new Date(entry.publishAt).getTime();
  // 발행 시간이 지났고 2시간 이내인 경우 (놓친 발행 방지)
  const diff = now - publishAt;
  if (diff < 0 || diff > 2 * 3600 * 1000) continue;

  console.log(`[${new Date().toISOString()}] Publishing: ${entry.title} (${entry.pageId})`);

  try {
    execSync(`node "${publishScript}" --page-id=${entry.pageId}`, {
      cwd: dir,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000, // 5분 타임아웃
    });
    entry.status = 'published';
    entry.publishedAt = new Date().toISOString();
    updated = true;
    console.log(`[${new Date().toISOString()}] ✅ Published: ${entry.title}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Failed: ${entry.title}: ${e.message}`);
    entry.status = 'failed';
    entry.failedAt = new Date().toISOString();
    entry.error = e.message;
    updated = true;
  }
}

if (updated) {
  fs.writeFileSync(schedFile, JSON.stringify(sched, null, 2));
}
EOF

echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-and-publish done"
