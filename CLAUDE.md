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

## OMC 사용법 (oh-my-claudecode)
```
team: 공지 파이프라인 실행 [공지 내용]
ralph: 발행이 실패한 경우 자동 재시도
autopilot: ORCHESTRATOR.md 기반 완전 자동 파이프라인
```

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
```
