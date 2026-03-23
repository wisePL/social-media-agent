# Verse Eight / Planetarium — Marketing Agent System

## 개요

마케팅팀의 공지 발행 파이프라인을 5개의 전문 에이전트로 자동화하는 시스템입니다.
각 에이전트는 독립적으로 호출하거나, ORCHESTRATOR가 전체 파이프라인을 조율합니다.

---

## 에이전트 구성

```
marketing-agents/
├── ORCHESTRATOR.md           ← 전체 파이프라인 조율 (마스터)
├── 01-content-planner/
│   └── SKILL.md              ← Notion 템플릿 생성 + 스케줄 등록
├── 02-copy-writer/
│   └── SKILL.md              ← 트위터/디스코드 카피 작성
├── 03-image-guide/
│   └── SKILL.md              ← 디자이너용 이미지 가이드 작성
├── 04-publisher/
│   └── SKILL.md              ← 지정 시간에 소셜 미디어 발행
└── 05-analytics/
    └── SKILL.md              ← 성과 분석 + 개선 루프
```

---

## Notion 핵심 정보

| 항목 | 값 |
|------|-----|
| 마케팅 캘린더 DB | `https://www.notion.so/2bfed889905f815f8954dfec194f8a2c` |
| 공지 템플릿 ID | `2bfed889-905f-8100-af78-c527d8069f47` |
| 데이터소스 ID | `2bfed889-905f-8105-9313-000bb0f90cb5` |

### 템플릿 섹션 (callout 순서)
1. **Task Details** — 공지 기본 정보 (내부용)
2. **Tweet** — 단일 트윗 카피 (최종본) *또는* **Tweet (1/n) ~ Tweet (n/n)** — Thread 형식
3. **Discord Announcement** — 디스코드 카피 (최종본)
4. **Graphic Request** — 디자이너에게 전달할 이미지 브리프
5. **Design output** — 디자이너 결과물 보관용 (발행에는 미사용)

> 📌 **이미지 배치:** 발행에 사용할 이미지는 `Tweet` 또는 각 `Tweet (n/n)` callout 블록 **안에 직접 삽입**해야 합니다.
> callout에 이미지가 없으면 텍스트만 발행됩니다.

### Status 워크플로우
```
Not started
  → In progress          (콘텐츠 플래너 완료)
  → Copy Done | Design WIP   (카피라이터 완료, 디자인 진행 중)
  → Approval             (검수 요청)
  → READY                (발행 승인 완료)
  → LIVE                 (발행됨)
  → Done                 (분석 완료)
```

### Tags 목록
`Verse8 twitter` | `Vibe Twitter` | `X Community` | `discord` | `community` | `broadcast` | `task` | `partners` | `creator` | `X AMA` | `blogs`

---

## 소셜 미디어 계정

| 플랫폼 | 계정 |
|--------|------|
| Twitter/X | [@Verse_Eight](https://x.com/Verse_Eight) |
| Discord | discord.gg/verse8-official |

---

## 사전 설정 필요 항목 (운영자 설정)

### 환경 변수 / 설정값
```
TWITTER_BEARER_TOKEN       — Twitter API v2 Bearer Token
TWITTER_API_KEY            — Twitter API Key
TWITTER_API_SECRET         — Twitter API Secret
TWITTER_ACCESS_TOKEN       — Twitter Access Token
TWITTER_ACCESS_SECRET      — Twitter Access Token Secret
DISCORD_WEBHOOK_ANNOUNCE   — #announcements 채널 웹훅 URL
DISCORD_WEBHOOK_COMMUNITY  — #general 또는 커뮤니티 채널 웹훅 URL
DISCORD_WEBHOOK_PARTNERS   — 파트너 채널 웹훅 URL (있는 경우)
```

### Discord 웹훅 설정 방법
1. Discord 서버 채널 우클릭 → 채널 편집
2. 연동 탭 → 웹훅 → 새 웹훅 생성
3. 웹훅 URL 복사 후 위 환경변수에 저장

### Twitter/X API 설정
1. [developer.x.com](https://developer.x.com) 에서 앱 생성
2. OAuth 2.0 (User Context) 또는 OAuth 1.0a 설정
3. `tweet.write` 권한 필요

---

## 에이전트 호출 방법

### 전체 파이프라인 (권장)
```
ORCHESTRATOR.md 를 컨텍스트로 제공 후:
"[공지 내용]을 발행해줘. 발행 시간: [날짜/시간], 채널: [트위터/디스코드/둘다]"
```

### 개별 에이전트 호출
```
# 노션 엔트리만 생성
01-content-planner/SKILL.md → "신규 패치노트 공지 노션 페이지 만들어줘"

# 카피만 수정
02-copy-writer/SKILL.md → "[노션 페이지 URL] 카피 다시 작성해줘"

# 성과 분석
05-analytics/SKILL.md → "지난주 발행된 공지 성과 분석해줘"
```
