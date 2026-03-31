#!/bin/bash
# Verse8 자동 analytics 실행 스크립트
#
# GCP VM crontab:
#   개별 포스트 24h 분석 (30분마다):
#     */30 * * * * /home/wise1/marketing-agents/check-and-analyze.sh post >> /home/wise1/agent.log 2>&1
#
#   주간 A/B 리포트 (매주 월요일 09:00 KST = 00:00 UTC):
#     0 0 * * 1 cd /home/wise1/marketing-agents && claude --print "05-analytics/SKILL.md를 읽고 주간 A/B 분석 리포트를 생성하라. Step B와 Step B-2를 실행하라." >> /home/wise1/agent.log 2>&1
#
#   월간 Few-Shot + Meta-Prompting 제안 (매월 1일 10:00 KST = 01:00 UTC):
#     0 1 1 * * cd /home/wise1/marketing-agents && claude --print "05-analytics/SKILL.md를 읽고 월간 Few-Shot 업데이트(Step C)와 Meta-Prompting 제안(Step D)을 실행하라." >> /home/wise1/agent.log 2>&1

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SCHED_FILE="$DIR/scheduled-publishes.json"
MODE="${1:-post}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-and-analyze start (mode: $MODE)"

if [ "$MODE" = "post" ]; then
  if [ ! -f "$SCHED_FILE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] scheduled-publishes.json not found, skipping"
    exit 0
  fi

  NOW=$(date -u +%s)

  node - "$SCHED_FILE" "$NOW" "$DIR" << 'EOF'
const fs = require('fs');
const { execSync } = require('child_process');
const [,, schedFile, nowStr, dir] = process.argv;

const now = parseInt(nowStr) * 1000;
const sched = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
let updated = false;

for (const entry of sched.schedules) {
  if (entry.status !== 'published') continue;
  if (entry.analyticsStatus === 'done' || entry.analyticsStatus === 'failed') continue;

  const publishedAt = new Date(entry.publishedAt).getTime();
  const elapsed = now - publishedAt;
  const h24 = 24 * 3600 * 1000;
  const h48 = 48 * 3600 * 1000;

  // 발행 후 24h 이상 경과 & 48h 이내 (놓친 분석 방지)
  if (elapsed < h24 || elapsed > h48) continue;

  console.log(`[${new Date().toISOString()}] Analyzing: ${entry.title} (${entry.pageId})`);

  const twitterUrl = entry.twitterUrl || 'N/A';
  const prompt = `05-analytics/SKILL.md를 읽고 다음 포스트의 성과를 분석하라: notion_page_id=${entry.pageId}, twitter_url=${twitterUrl}`;

  try {
    execSync(`claude --print "${prompt.replace(/"/g, '\\"')}"`, {
      cwd: dir,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000, // 10분 타임아웃
    });
    entry.analyticsStatus = 'done';
    entry.analyzedAt = new Date().toISOString();
    updated = true;
    console.log(`[${new Date().toISOString()}] ✅ Analytics done: ${entry.title}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Analytics failed: ${entry.title}: ${e.message}`);
    entry.analyticsStatus = 'failed';
    entry.analyticsFailedAt = new Date().toISOString();
    updated = true;
  }
}

if (updated) {
  fs.writeFileSync(schedFile, JSON.stringify(sched, null, 2));
}
EOF

else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Unknown mode: $MODE (use: post)"
  echo "  Weekly/monthly analytics는 crontab에서 claude --print로 직접 실행됩니다."
  echo "  crontab -e 참고: 이 파일 상단 주석 확인"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-and-analyze done (mode: $MODE)"
