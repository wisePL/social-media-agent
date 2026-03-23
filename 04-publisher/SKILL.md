# Agent 04 — Publisher (발행 에이전트)

## 역할
지정된 시간에 승인된 콘텐츠를 소셜 미디어에 자동 발행합니다.
- 노션 페이지에서 최종 카피와 이미지 확인
- Twitter/X에 트윗 발행
- Discord의 목적에 맞는 채널에 공지 발행
- 노션 Status를 **LIVE**로 업데이트 (최종 상태 — Done 없음)
- 발행 타임스탬프와 게시 URL 기록

---

## 트리거 조건

### 자동 트리거 (스케줄드 태스크)
`scheduled-tasks`로 등록된 타임스탬프에 자동 실행.

```
tool: create_scheduled_task
taskId: publish-[page_id 앞 8자리]
fireAt: [publish_datetime ISO-8601]
prompt: "04-publisher/SKILL.md 실행. notion_page_id=[page_id]"
```

### 수동 트리거
- "지금 발행해줘", "이거 바로 올려줘"
- "[노션 URL] 발행 실행"

---

## 사전 조건 (발행 전 체크)

**다음 조건이 모두 충족되어야 발행합니다:**

1. ✅ 노션 Status가 **READY**인가?
2. ✅ `Tweet` 또는 `Tweet (1/n)` callout에 내용이 있는가?
3. ✅ Discord Announcement callout에 내용이 있는가?
4. ✅ 이미지는 각 Tweet callout 블록 안에 첨부된 것 사용 (없으면 텍스트만 발행 — 정상)
5. ✅ 발행 채널(Twitter/Discord)이 설정되어 있는가?

**조건 미충족 시:** 발행을 중단하고 담당자에게 알림.

---

## 환경 설정 (운영자 사전 설정 필요)

```bash
# Twitter/X API (OAuth 1.0a User Context)
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=

# Discord Webhook (단일 채널 — #major-announcement)
DISCORD_WEBHOOK_ANNOUNCEMENTS=

# Discord Webhook (테스트 채널 — 페이지 제목에 "Test" 포함 시 자동 사용)
DISCORD_WEBHOOK_TEST=
```

---

## 워크플로우

### Step 1 — 노션 페이지 읽기
```
tool: notion-fetch
id: [notion_page_id]
```

다음 내용 추출:
- `status`: READY 여부 확인
- `discord_content`: Discord Announcement callout 내용
- `tags`: 채널 결정용
- `date`: 발행 예정 시간

**Tweet 형식 감지:**
- 노션 페이지에서 callout 블록 제목 확인
- `Tweet (1/n)` 형식 callout 존재 → **Thread 모드**
- `Tweet` callout 1개만 존재 → **단일 트윗 모드**

**Thread 모드:** `Tweet (1/n)`, `Tweet (2/n)` ... `Tweet (n/n)` 순서대로 추출
- 각 callout의 텍스트 추출
- 각 callout 블록 안에 첨부된 이미지 확인 (있으면 해당 트윗에 첨부)

**단일 트윗 모드:** `Tweet` callout 1개
- 텍스트 추출
- callout 안 첨부 이미지 확인

### Step 2 — Status 검증

Status가 READY가 아닌 경우:
```
⛔ 발행 불가: 현재 Status = [현재 상태]
   READY 상태로 변경 후 다시 시도해주세요.
   노션: [URL]
```
**프로세스 중단.**

### Step 3 — Twitter/X 발행

기본적으로 항상 실행. (@Verse_Eight 계정으로 항상 발행)

---

#### 단일 트윗 모드

**이미지 있는 경우 (callout에 첨부된 이미지):**
```bash
# 1. 이미지 업로드
POST https://upload.twitter.com/1.1/media/upload.json
  media: [callout 첨부 이미지]

# 2. 트윗 발행
POST https://api.twitter.com/2/tweets
  {
    "text": "[tweet_content]",
    "media": {"media_ids": ["[media_id]"]}
  }
```

**텍스트만 (callout에 이미지 없음):**
```bash
POST https://api.twitter.com/2/tweets
  { "text": "[tweet_content]" }
```

---

#### Thread 모드

`Tweet (1/n)` ~ `Tweet (n/n)` callout을 순서대로 순차 발행.
각 callout의 이미지 첨부 여부를 개별 확인.

```bash
# --- Tweet (1/n) ---
# 이미지 있으면 먼저 업로드
POST https://upload.twitter.com/1.1/media/upload.json → media_id_1

# 첫 트윗 발행 (reply 없음)
POST https://api.twitter.com/2/tweets
  {
    "text": "[Tweet (1/n) 내용]",
    "media": {"media_ids": ["[media_id_1]"]}   ← 이미지 없으면 media 필드 생략
  }
→ 응답: tweet_id_1

# --- Tweet (2/n) ---
POST https://upload.twitter.com/1.1/media/upload.json → media_id_2  ← 이미지 있는 경우만

POST https://api.twitter.com/2/tweets
  {
    "text": "[Tweet (2/n) 내용]",
    "reply": {"in_reply_to_tweet_id": "[tweet_id_1]"},
    "media": {"media_ids": ["[media_id_2]"]}   ← 이미지 없으면 생략
  }
→ 응답: tweet_id_2

# --- Tweet (n/n) --- 동일 패턴 반복, 항상 직전 tweet_id에 reply
```

> ⚠️ **순서 엄수:** 반드시 (1/n) → (2/n) → (n/n) 순으로 발행. 다음 트윗은 직전 응답의 tweet_id를 사용.

---

#### curl 형식 예시 (Bash 실행용)
```bash
# 단일 트윗 (텍스트만)
curl -X POST "https://api.twitter.com/2/tweets" \
  -H "Authorization: OAuth ..." \
  -H "Content-Type: application/json" \
  -d '{"text": "[tweet_content]"}'

# Thread 두 번째 트윗
curl -X POST "https://api.twitter.com/2/tweets" \
  -H "Authorization: OAuth ..." \
  -H "Content-Type: application/json" \
  -d '{"text": "[tweet2]", "reply": {"in_reply_to_tweet_id": "[tweet_id_1]"}}'
```

#### 발행 결과 저장
```
twitter_tweet_id: [첫 번째 tweet_id — thread의 경우 1/n 트윗 ID]
twitter_url: https://x.com/Verse_Eight/status/[tweet_id_1]
twitter_thread_ids: [tweet_id_1, tweet_id_2, ...] ← thread인 경우만
```

### Step 4 — Discord 발행

기본적으로 항상 실행.

#### 채널 결정 (우선순위 순)
| 조건 | 사용 웹훅 | 비고 |
|------|-----------|------|
| 페이지 제목에 "Test" 포함 | DISCORD_WEBHOOK_TEST | **테스트 채널 — 최우선** |
| `community` tag | DISCORD_WEBHOOK_COMMUNITY | 커뮤니티 일반 |
| `partners` tag | DISCORD_WEBHOOK_PARTNERS | 파트너 전용 |
| `broadcast` tag | DISCORD_WEBHOOK_ANNOUNCEMENTS | 전체 공지 |
| `X AMA` tag | DISCORD_WEBHOOK_AMA | AMA 이벤트 |
| 기본값 | DISCORD_WEBHOOK_ANNOUNCEMENTS | 기본 공지 채널 |

#### Discord Webhook 발행 (plain text only)
> ⚠️ embed 형식 사용 금지. `content` 필드에 plain text만 전송.

**이미지 없는 경우:**
```bash
curl -X POST "[DISCORD_WEBHOOK_URL]" \
  -H "Content-Type: application/json" \
  -d '{"content": "[discord_content]"}'
```

**이미지 있는 경우 — 파일 첨부:**
```bash
curl -X POST "[DISCORD_WEBHOOK_URL]" \
  -F 'payload_json={"content": "[discord_content]"}' \
  -F "file=@[image_file]"
```

#### 발행 결과 저장
```
discord_message_id: [응답에서 추출]
discord_channel: [사용된 채널명]
```

### Step 5 — 노션 Status 업데이트

```
tool: notion-update-page
page_id: [page_id]
Status: "LIVE"
```

**추가로 노션 페이지 하단에 발행 로그 추가:**
```markdown
---
**📊 발행 로그**
- **발행 시각:** [실제 발행 시간 KST]
- **트위터:** [twitter_url]
- **디스코드:** [discord_channel] (Message ID: [discord_message_id])
```

### Step 6 — 알림 전송 + 대시보드 업데이트

발행 완료 후 **두 가지** 액션을 병렬 실행:

#### A. Slack 팀 채널 알림
```bash
# .env에서 토큰 로드
source .env

curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{
    \"channel\": \"$SLACK_TEAM_CHANNEL\",
    \"text\": \"🚀 *[공지 제목]* published!\n\n🐦 Twitter: [twitter_url]\n💬 Discord: #major-announcement\n\n⚡ *First 1-hour boost actions:*\n→ Reply to every comment immediately\n→ Ask team to RT\n→ Share in relevant communities\n\nRT × 20 = 1 Like (algorithm weight)\nFirst hour determines 60% of total reach.\"
  }"
```

오류 발생 시 개인 DM(`SLACK_NOTIFICATION_CHANNEL`)에도 동일한 curl로 전송:
```bash
curl -s -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"channel\": \"$SLACK_NOTIFICATION_CHANNEL\", \"text\": \"⛔ 발행 오류: [오류 내용]\"}"
```

#### B. Notion 대시보드 로그 업데이트
발행 로그를 Marketing Ops Dashboard의 "Recent Publish Log" 테이블에 추가:

```
tool: notion-fetch
id: NOTION_DASHBOARD_PAGE_ID (326ed889-905f-8113-aed3-e45747acc14a)
→ "Recent Publish Log" 테이블 블록 찾기

tool: notion-update-page (또는 patch-block-children)
→ 테이블에 행 추가:
  | [날짜 KST] | [공지 제목] | [twitter_url] | ✅ | ✅ | TBD (analytics 후 채워짐) |
```

#### C. 대시보드 Agent Health 업데이트
```
"04 publisher" 행의 Last Run → [현재 시각 KST], Status → ✅
```

### Step 7 — 결과 보고

```
🚀 발행 완료!

📌 [공지 제목]
⏰ 발행 시각: [datetime KST]

🐦 Twitter: [twitter_url]
💬 Discord: #major-announcement — 발행 완료

🔄 노션 Status: LIVE
📄 노션: [URL]

⚡ 첫 1시간 전략 알림이 Slack으로 전송되었습니다.
➡️  24시간 후 Analytics 에이전트가 성과를 분석합니다.
```

---

## 스케줄 등록 방법

콘텐츠 플래너 완료 후 자동 발행을 예약할 때:

```
tool: create_scheduled_task
taskId: publish-[짧은 식별자]
description: "[공지 제목] 발행"
fireAt: [publish_datetime ISO-8601 with timezone]
prompt: |
  04-publisher/SKILL.md 에이전트를 실행합니다.

  notion_page_id: [page_id]
  notion_page_url: [url]

  사전 조건 확인 후 Twitter와 Discord에 발행하고,
  노션 Status를 LIVE로 업데이트하세요.
```

---

## 발행 취소 / 일정 변경

### 발행 취소
```
tool: update_scheduled_task
taskId: [taskId]
enabled: false
```

### 발행 시간 변경
```
tool: update_scheduled_task
taskId: [taskId]
fireAt: [새로운 시간 ISO-8601]
```

사용자에게 알릴 때: "scheduled-tasks에서 `publish-[id]` 태스크를 수정하거나 비활성화하세요."

---

## 오류 처리 및 롤백

| 오류 상황 | 처리 방법 |
|-----------|-----------|
| Twitter API 인증 실패 | Slack 알림 + 수동 발행 가이드 전송 |
| Discord Webhook 실패 | 재시도 2회 (30초 간격), 실패 시 Slack 알림 |
| 노션 Status ≠ READY | 발행 중단, 상세 확인 요청 |
| 이미지 URL 깨짐 | 텍스트만 발행 후 Slack 알림 |
| Rate limit 초과 | 5분 후 자동 재시도 |
| Twitter 성공 + Discord 실패 | **롤백 없음** — Discord만 재시도, Twitter 삭제하지 않음 |
| 양쪽 모두 실패 | 노션 Status를 READY 유지, 재발행 가능하도록 보존 |

**오류 발생 시 Slack 알림 형식:**
```
⚠️ 발행 오류: [공지 제목]
채널: [실패한 채널]
오류: [에러 메시지]
노션: [URL]
→ 수동 발행이 필요합니다. /announce-publish 실행
```

---

## 핸드오프 (다음 에이전트)

발행 24-48시간 후 05-analytics 에이전트에 전달:
- `notion_page_id`: 노션 페이지 ID
- `twitter_tweet_id`: 트윗 ID
- `discord_message_id`: 디스코드 메시지 ID
- `publish_datetime`: 발행 시각
