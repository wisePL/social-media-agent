# Agent 00 — Comment Watcher (노션 댓글 커맨드 인터페이스)

## 역할
노션 마케팅 캘린더의 모든 페이지 댓글을 스캔합니다.
`@` 커맨드를 감지하면 해당 에이전트를 즉시 실행하고, 댓글 스레드에 결과를 회신합니다.

**이것이 파이프라인의 "트리거 레이어"입니다.**
담당자는 Claude Code 없이, 노션 앱에서 댓글만 달면 에이전트가 실행됩니다.

---

## 지원 커맨드

| 노션 댓글 | 실행 에이전트 | 설명 |
|-----------|--------------|------|
| `/copy` | 02-copy-writer | 트윗 + 디스코드 카피 작성/재작성 |
| `/guide` | 03-image-guide | 디자이너용 그래픽 요청서 작성 |
| `/publish` | 04-publisher | 즉시 발행 (Status = READY 필요) |
| `/analyze` | 05-analytics | 이 공지의 성과 분석 즉시 실행 (ad-hoc) |
| `/reschedule 2026-03-20 18:00` | ORCHESTRATOR | 발행 시간 변경 |
| `/cancel` | ORCHESTRATOR | 발행 취소, Status → CANCELLED |
| `/status` | - | 현재 파이프라인 상태 요약을 댓글로 회신 |
| `/start [내용]` | 01→02→03 | 새 공지 파이프라인 전체 시작 |

### 커맨드 작성 규칙 (노션에서)
- 반드시 `/`으로 시작
- 대소문자 구분 없음 (`/COPY` = `/copy`)
- 추가 텍스트 포함 가능: `/copy 톤을 더 캐주얼하게 바꿔줘`
- 이미 처리된 댓글은 재처리하지 않음 (봇 회신이 있으면 스킵)

---

## 워크플로우

### Step 1 — 최근 페이지 목록 조회
노션 마케팅 캘린더에서 Status가 **LIVE가 아닌** 모든 페이지를 조회합니다.

```
tool: notion-search
query: ""  (빈 쿼리 = 전체)
filter: { "property": "object", "value": "page" }
```

또는 DB에서 직접 조회:
```
tool: notion-fetch
id: collection://2bfed889-905f-8105-9313-000bb0f90cb5
```

Status가 LIVE인 페이지는 생략 (발행 완료됨).

### Step 2 — 각 페이지 댓글 조회

각 페이지에 대해:
```
tool: notion-get-comments
page_id: [page_id]
include_all_blocks: false
include_resolved: false
```

### Step 3 — 미처리 커맨드 감지

각 discussion thread의 댓글 목록을 **시간 순서대로** 순회하여:

1. `/`으로 시작하는 댓글을 찾는다 → 이것이 커맨드 후보
2. 해당 커맨드 댓글의 **이후 시간(datetime)에** `[BOT]` 회신이 있는가?
   - 봇 회신 식별: `✅ [BOT]`, `⏳ [BOT]`, `⛔ [BOT]`, `❓ [BOT]` 로 시작
   - 해당 커맨드 **이후**에 봇 회신이 있으면 → 이미 처리됨, 스킵
   - 해당 커맨드 **이후**에 봇 회신이 없으면 → 미처리, 실행 대상

> ⚠️ **핵심: thread 전체가 아닌 커맨드별로 판단한다.**
> 같은 thread에 `/copy` → 봇회신 → `/publish` 순서로 달린 경우,
> `/copy`는 봇 회신이 이후에 있으므로 스킵, `/publish`는 봇 회신이 없으므로 실행.

미처리 커맨드만 처리 목록에 추가. **가장 최근 미처리 커맨드를 우선 처리.**

### Step 4 — 커맨드 파싱

```python
command_text = comment.text.strip().lower()

if command_text.startswith("/copy"):
    agent = "02-copy-writer"
    extra_instruction = command_text[5:].strip()  # "/copy" 이후 텍스트

elif command_text.startswith("/guide"):
    agent = "03-image-guide"

elif command_text.startswith("/publish"):
    agent = "04-publisher"

elif command_text.startswith("/analyze"):
    agent = "05-analytics"

elif command_text.startswith("/cancel"):
    action = "cancel"

elif command_text.startswith("/reschedule"):
    action = "reschedule"
    new_time = command_text[11:].strip()  # 날짜/시간 파싱

elif command_text.startswith("/status"):
    action = "status_report"

elif command_text.startswith("/start"):
    agent = "full_pipeline"
    content = command_text[6:].strip()

else:
    # 알 수 없는 커맨드 → 도움말 회신
    action = "unknown"
```

### Step 5 — 즉시 "접수" 댓글 달기

에이전트 실행 **전에** 댓글 스레드에 접수 확인 회신:

```
tool: notion-create-comment
page_id: [page_id]
discussion_id: [comment의 discussion_id]
rich_text: [{"text": {"content": "⏳ [BOT] @[커맨드] 접수됨 — 처리 중..."}}]
```

### Step 6 — 에이전트 실행

해당 SKILL.md를 읽고 에이전트 지침에 따라 실행.

**커맨드별 실행 방법:**

#### `/copy [추가지시]`
```
02-copy-writer/SKILL.md 지침을 따릅니다.
notion_page_url = [해당 페이지 URL]
extra_instruction = [추가 텍스트, 있는 경우]
```

#### `/guide`
```
03-image-guide/SKILL.md 지침을 따릅니다.
notion_page_url = [해당 페이지 URL]
```

#### `/publish`
```
04-publisher/SKILL.md 지침을 따릅니다.
notion_page_id = [page_id]
⚠️ Status != READY 이면 실행하지 않고 오류 회신
```

#### `/analyze`
```
05-analytics/SKILL.md 지침을 따릅니다.
notion_page_id = [page_id]
```

#### `/reschedule [datetime]`
```
1. 노션 페이지 fetch → 현재 Status 확인
2. scheduled-publishes.json 에서 pageId 일치하는 항목 찾기
   → 없으면 ⛔ 오류 회신 ("스케줄된 발행 항목이 없습니다")
3. entry.publishAt = [새 시간 ISO], entry.status = "pending" 으로 업데이트
4. 노션 Date 필드 업데이트
5. Status 처리:
   - 현재 Status = CANCELLED  → READY 로 복구 (발행 재예약)
   - 현재 Status = READY       → 유지 (시간만 변경)
   - 현재 Status = In progress → 유지 (일정만 업데이트)
   - 현재 Status = LIVE        → ⛔ 오류 회신 ("이미 발행된 공지입니다")
```

#### `/cancel`
```
1. scheduled-publishes.json 에서 pageId 일치하는 entry.status = "cancelled" 로 변경
2. 노션 Status → CANCELLED
3. 회신 메시지에 복구 방법 안내:
   "다시 예약하려면 /reschedule [날짜시간] 커맨드를 사용하세요.
    Status가 자동으로 READY로 복구됩니다."
```

#### `/status`
```
노션 페이지 fetch → 현재 Status, 발행 예정 시간, 스케줄 태스크 상태 요약
```

#### `/start [내용]`
```
ORCHESTRATOR.md 지침을 따라 전체 파이프라인 시작.
입력 내용 = 공지 기초 정보
해당 페이지에 새 공지 내용이 없으면 사용자에게 추가 정보 요청 댓글 달기
```

### Step 7 — 결과 댓글 달기

성공 시:
```
tool: notion-create-comment
page_id: [page_id]
discussion_id: [원본 커맨드의 discussion_id]
rich_text: 아래 형식
```

**성공 회신 형식:**
```
✅ [BOT] @[커맨드] 완료

[결과 요약]
예: 트윗 작성 완료 (243/280자)
예: 발행 완료 — twitter.com/Verse_Eight/status/[id]
예: 발행 [날짜 KST]로 변경됨

🔄 Status: [현재 Status]
```

**실패 / 조건 미충족 회신 형식:**
```
⛔ [BOT] @[커맨드] 실행 불가

이유: [구체적인 이유]
예: Status가 READY가 아닙니다 (현재: Copy Done | Design WIP)
예: 스케줄된 발행 태스크가 없습니다

필요한 액션: [담당자가 해야 할 것]
```

**알 수 없는 커맨드 회신:**
```
❓ [BOT] 알 수 없는 커맨드입니다.

사용 가능한 커맨드:
/copy — 카피 작성/재작성
/guide — 이미지 가이드 작성
/publish — 즉시 발행 (READY 필요)
/analyze — 이 공지 성과 분석 (ad-hoc)
/reschedule [날짜시간] — 발행 시간 변경
/cancel — 발행 취소
/status — 현재 상태 요약
/start [내용] — 새 공지 파이프라인 시작

주간 분석 리포트는 매주 월요일 09:00 KST 자동 실행됩니다.
```

---

## 폴링 스케줄

이 에이전트는 **30분마다** 자동 실행됩니다:
```
cron: 7,37 * * * *
```

실행 시간이 짧을수록 좋습니다. 새 커맨드가 없으면 즉시 종료.

---

## 처리 효율화

### 스캔 대상 최소화
- Status = "Done" 또는 "CANCELLED"인 페이지는 스캔 생략
- `createdTime`이 30일 이상 된 페이지는 스캔 생략
- 최근 7일 이내 생성/수정된 페이지 우선 스캔

### 봇 회신 감지
댓글 텍스트가 다음으로 시작하면 봇 회신으로 판단:
- `✅ [BOT]`
- `⏳ [BOT]`
- `⛔ [BOT]`
- `❓ [BOT]`

### 커맨드 처리 판단 기준 (중복 처리 방지)
- `/`으로 시작하는 댓글 = 커맨드 후보
- 해당 커맨드 댓글의 datetime **이후**에 봇 회신이 존재하면 → 이미 처리됨, 스킵
- thread 전체에 봇 회신이 있어도, **새 `/` 커맨드가 봇 회신보다 더 최신이면 → 실행**

---

## 오류 처리

| 오류 상황 | 처리 방법 |
|-----------|-----------|
| 노션 페이지 접근 불가 | 스킵, 다음 페이지 계속 |
| 에이전트 실행 실패 | ⛔ 회신 달고 계속 |
| 스케줄드 태스크 없음 | /reschedule//cancel 시 오류 회신 |
| 댓글 달기 실패 | 무시하고 계속 |

---

## 파일 경로
```
marketing-agents/
├── 00-comment-watcher/SKILL.md  ← 이 파일
└── [다른 에이전트들]
```
