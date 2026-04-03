# Marketing Agent System — Claude Context

## 이 디렉토리에 대하여
Verse Eight / Planetarium 마케팅팀의 공지 자동화 파이프라인입니다.
Claude Code가 이 폴더에서 열릴 때 아래 지침을 자동으로 따릅니다.

## 에이전트 파일 위치
```
ORCHESTRATOR.md              ← 전체 파이프라인 진입점
01-content-planner/SKILL.md  ← 노션 페이지 생성
02-copy-writer/SKILL.md      ← 카피 작성 (브랜드 가이드 포함)
03-image-guide/SKILL.md      ← 이미지 브리프
04-publisher/SKILL.md        ← 발행
05-analytics/SKILL.md        ← 성과 분석
```

## 자동 컨텍스트 로딩
공지 관련 작업 시작 시 반드시 다음을 먼저 읽습니다:
1. 해당 에이전트의 SKILL.md
2. `02-copy-writer/SKILL.md` 내 브랜드 바이블 섹션 (카피 작성 시)

## 핵심 상수
```
NOTION_DATASOURCE_ID   = "2bfed889-905f-8105-9313-000bb0f90cb5"
NOTION_TEMPLATE_ID     = "2bfed889-905f-8100-af78-c527d8069f47"
NOTION_CALENDAR_DB     = "https://www.notion.so/2bfed889905f815f8954dfec194f8a2c"
NOTION_CALENDAR_DB_ID  = "2bfed889-905f-815f-8954-dfec194f8a2c"  ← API query 용
NOTION_DASHBOARD_PAGE  = "https://www.notion.so/326ed889905f8113aed3e45747acc14a"
TWITTER_HANDLE         = "@Verse_Eight"
DISCORD_SERVER         = "discord.gg/verse8-official"
SLACK_TEAM_CHANNEL     = "C09FWFU4ZQB"  ← 팀 공유 채널 (주간 리포트 + 발행 알림)
```

## 브랜드 핵심 원칙 (항상 준수)
- Verse8 = AI-native creation layer (NOT "AI game maker")
- 게임 = 첫 번째 버티컬일 뿐
- 토크노믹스/$V → 팀 확인 전 언급 금지
- 브랜드 톤: Playful builder, fast & witty, slightly degen

## 슬래시 커맨드
```
/announce           ← 전체 파이프라인 시작
/announce-status    ← 현황 조회
/announce-copy      ← 카피만 수정
/announce-publish   ← 수동 즉시 발행
/announce-analytics ← 성과 분석
```

## 자동화 인프라 (GCP VM: verse8-agent, us-central1-a)
```
00-comment-watcher           → 7,37 * * * *  (30분마다 댓글 커맨드 감지)
check-and-publish.sh         → */30 * * * *  (예약 발행 체크)
check-and-analyze.sh post    → */30 * * * *  (발행 24h 후 포스트 분석)
weekly analytics report      → 0 0 * * 1     (매주 월 09:00 KST)
monthly Few-Shot update      → 0 1 1 * *     (매월 1일 10:00 KST)
git pull                     → */10 * * * *  (코드 최신화)
```
> ⚠️ `create_scheduled_task` MCP 절대 사용 금지 — 세션 종료 시 태스크 소멸
> 로컬 Claude Code를 켜지 않아도 /start, /copy, /publish 등 노션 댓글 커맨드는 자동 처리됩니다.

## 노션 커맨드 규칙
- 모든 커맨드는 `/`으로 시작 (예: `/copy`, `/publish`, `/start`)
- `@`는 사용하지 않음 — 노션 멘션과 충돌
- BOT 회신 식별: `✅ [BOT]`, `⏳ [BOT]`, `⛔ [BOT]`, `❓ [BOT]` 로 시작

## 노션 페이지 Callout 포맷 규칙
**Callout 안에는 실제 카피(copy)만 작성. 가이드 문구 절대 넣지 않음.**

```
📋 Task Details    ← 공지 배경/목적/핵심 메시지 (사람이 작성)
🐦 Tweet (Web3)    ← AI가 트위터 카피 작성
📱 Instagram       ← AI가 인스타 카피 작성
👥 Facebook        ← AI가 페이스북 카피 작성
💼 LinkedIn        ← AI가 링크드인 카피 작성
💬 Discord         ← AI가 디스코드 카피 작성
🎨 Graphic Request ← AI가 디자이너용 브리프 작성
🖼️ Design Output   ← 디자이너가 완성 파일 링크 첨부
```

- **Tweet 2 (`🐦 Tweet 2`)는 AI가 스레드가 필요하다고 판단할 때만 추가** — 템플릿에 고정 슬롯 없음
- 각 callout 안의 paragraph는 송출할 copy만 (설명/가이드 문구 포함 금지)
- publish.js가 다음 패턴을 자동 필터링(스킵)하므로 Notion에도 넣지 말 것:
  - `← 카피를`, `카피를 여기에`, `Web3 degen 타겟 |`, `해시태그 금지`
  - `link in bio CTA`, `마크다운 활용`, `캐주얼 톤 |`, `전문적 톤 |`
  - `설명형 1-3문단`, `데이터·트랙션 중심`

## 자동 발행 조건 (check-and-publish.sh)
- Status = `READY` **AND** Date 필드에 **날짜+시간** 모두 설정된 경우만 발행
- **날짜만 있는 경우 (예: `2026-04-07`) → READY여도 자동 발행 안 함**
- 발행 window: 예약 시간 기준 ±35분 이내만 처리
- 과거 페이지 재발행 방지: window를 벗어난 경우 스킵

## 환경 변수 (.env 파일 위치: 이 폴더)
```
TWITTER_API_KEY            ← Twitter OAuth 1.0a
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_SECRET
TWITTER_BEARER_TOKEN
DISCORD_WEBHOOK_ANNOUNCEMENTS  ← #major-announcement 단일 채널
SLACK_BOT_TOKEN            ← xoxb- 봇 토큰 (DM + 팀 채널 알림용)
SLACK_APP_TOKEN            ← xapp- 앱 레벨 토큰
SLACK_USER_ID              ← 알림 수신자 User ID (개인 DM)
SLACK_NOTIFICATION_CHANNEL ← 개인 DM 채널 (파이프라인 오류 알림)
SLACK_TEAM_CHANNEL         ← 팀 공유 채널 (발행 완료 + 주간 리포트)
NOTION_DASHBOARD_PAGE_ID   ← Marketing Ops Dashboard 페이지 ID
FACEBOOK_PAGE_ACCESS_TOKEN ← Meta 시스템 유저 영구 토큰 (자동으로 Page token 교환)
```
