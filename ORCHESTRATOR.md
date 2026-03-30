# ORCHESTRATOR — Marketing Agent 총괄

## 역할
마케팅 공지 파이프라인의 5개 에이전트를 순서대로 조율합니다.
사용자는 이 파일 하나로 전체 워크플로우를 시작할 수 있습니다.

---

## 에이전트 파이프라인

```
사용자 입력
    │
    ▼
[01] Content Planner ──── 노션 페이지 생성, Status: In progress
    │
    ▼
[02] Copy Writer ──────── 트윗 + 디스코드 카피, Status: Copy Done | Design WIP
    │
    ▼
[03] Image Guide ─────── 그래픽 요청서 작성 (Graphic Request 업데이트)
    │                              │
    │                              └─ 🛑 PAUSE: 디자이너 작업 대기
    │                                         담당자가 Status → READY 변경
    ▼
[04] Publisher ───────── 자동 발행 (Twitter + Discord), Status: LIVE
    │
    ▼
[05] Analytics ───────── 24h 후 성과 분석, Status: Done
    │
    └─ 개선 인사이트 → 다음 공지에 반영 (루프)
```

---

## 시작 방법

### 전체 파이프라인 실행

사용자 입력 형식:
```
공지 제목: [제목]
내용 요약: [2-3문장]
주요 포인트: [항목들]
발행 시간: [날짜/시간 KST]
채널: [twitter / discord / 둘다]
디스코드 채널: [announcements / community / partners]
담당자: [이름]
디자이너: [이름]
```

오케스트레이터는 이 정보를 받아 01→02→03 순서로 즉시 실행하고,
04(발행)는 스케줄 등록, 05(분석)는 발행 후 24h 스케줄 등록합니다.

---

## 실행 프로토콜

### Phase 1: 즉시 실행 (01-02-03 연속 실행)

```
[01 Content Planner 실행]
  ↓ 노션 페이지 생성 완료
  ↓ notion_page_id, notion_page_url 획득

[02 Copy Writer 실행]
  ↓ 트윗 카피 작성
  ↓ 디스코드 카피 작성
  ↓ 노션 업데이트

[03 Image Guide 실행]
  ↓ 그래픽 요청서 작성
  ↓ 노션 Graphic Request 업데이트
  ↓ 파이프라인 일시 정지
```

### Phase 2: 스케줄 등록 (자동)

`scheduled-publishes.json` 에 항목 추가 (Claude 세션 종료 후에도 유지됨):

```json
{
  "pageId": "[notion_page_id]",
  "title": "[title]",
  "publishAt": "[publish_datetime ISO]",
  "status": "pending"
}
```

**방법:** `scheduled-publishes.json` 파일을 읽어 schedules 배열에 위 항목을 추가하고 저장.
GCP VM의 `check-and-publish.sh` (매시 정각 cron)이 이 파일을 읽어 시간이 된 항목을 자동 발행.

> ⚠️ **절대 create_scheduled_task MCP 도구를 사용하지 않는다.**
> Claude 세션 기반 scheduled task는 세션 종료 시 사라진다.

### Phase 3: 디자이너 대기 및 승인

```
담당자 액션 필요:
  1. 디자이너가 Design output 섹션에 이미지 업로드
  2. 담당자가 내용 검토
  3. Status: Approval → READY 로 변경
  → 04 Publisher가 예약 시간에 자동 발행
```

---

## 상황별 처리 가이드

### A. 발행 시간 변경이 필요할 때
```
사용자: "발행 시간을 [새 시간]으로 바꿔줘"

오케스트레이터:
1. scheduled-publishes.json 에서 pageId 일치 항목 찾기
2. entry.publishAt = [새 시간 ISO] 로 업데이트
3. entry.status = "pending" 으로 복구 (cancelled였으면)
4. 노션 페이지 Date 필드도 업데이트
```

### B. 발행 취소
```
사용자: "취소해줘"

오케스트레이터:
1. scheduled-publishes.json 에서 pageId 일치 항목의 status = "cancelled"
2. 노션 Status → CANCELLED
```

### C. 카피만 수정 (이미 작성된 경우)
```
사용자: "[노션 URL] 트윗 다시 써줘"

오케스트레이터: 02-copy-writer만 호출
```

### D. 긴급 즉시 발행
```
사용자: "지금 바로 올려줘"

오케스트레이터:
1. 노션 Status 확인 (READY 여부)
2. READY면 04-publisher 즉시 실행
3. READY 아니면: "Status가 [현재상태]입니다. READY로 변경 후 발행하겠습니다"
```

### E. 개별 에이전트 재실행
```
사용자: "[노션 URL] 이미지 가이드만 다시 써줘"
→ 03-image-guide만 호출

사용자: "지난 공지 성과 분석해줘"
→ 05-analytics만 호출
```

---

## 전체 실행 예시

**입력:**
```
공지 제목: Season 2 패치노트 공개
내용: 시즌2 업데이트로 신규 캐릭터 3종, 밸런스 패치, 새 게임모드 추가
주요 포인트: 신규 캐릭터 Void, Asha, Rex 추가 / 무기 밸런스 20종 패치 / 배틀로얄 모드 신규 출시
발행: 2026-03-20 18:00 KST
채널: 트위터 + 디스코드 (#announcements)
```

**오케스트레이터 실행 순서:**

```
1. [01] 노션 페이지 생성
   → https://www.notion.so/[page-id]
   → Status: In progress

2. [02] 카피 작성
   트윗: "Season 2 is LIVE. 🎮
          🆕 3 New Characters: Void, Asha, Rex
          ⚔️ 20 Balance Patches
          🔥 Battle Royale mode is HERE
          Full patch notes 👇 [링크]
          #Verse8 #Season2 #Web3Gaming"

   디스코드 공지: "# 📣 Season 2 패치노트 공개
                   시즌2가 시작됩니다!..."
   → Status: Copy Done | Design WIP

3. [03] 이미지 가이드
   → Graphic Request callout 업데이트
   → 파이프라인 일시 정지 (디자이너 대기)

4. 스케줄 등록:
   → publish-[id]: 2026-03-20 18:00 KST
   → analytics-[id]: 2026-03-21 18:00 KST

5. [담당자 승인 후] [04] 자동 발행
   → 트위터 발행 완료
   → 디스코드 #announcements 발행 완료
   → Status: LIVE

6. [24h 후] [05] 성과 분석
   → 성과 리포트 노션 업데이트
   → Status: Done
```

---

## 스케줄 관리

현재 등록된 발행 일정 확인:
```
scheduled-publishes.json 파일 읽기
→ status: "pending" 항목들이 발행 예정 목록
→ GCP VM check-and-publish.sh (매시 정각)이 자동 실행
```

---

## 에러 시 에스컬레이션

에이전트 중 하나가 실패하면:
1. 실패한 에이전트와 오류 내용을 명확히 알림
2. 이전 단계까지의 결과물(노션 URL)은 보존
3. 실패한 에이전트만 재시도 가능하도록 안내
4. 수동 처리 방법 제시

---

## 핵심 레퍼런스

| 항목 | 값 |
|------|-----|
| 노션 데이터소스 | `2bfed889-905f-8105-9313-000bb0f90cb5` |
| 노션 템플릿 ID | `2bfed889-905f-8100-af78-c527d8069f47` |
| 마케팅 캘린더 DB | `https://www.notion.so/2bfed889905f815f8954dfec194f8a2c` |
| Twitter | @Verse_Eight |
| Discord | discord.gg/verse8-official |

**에이전트 파일:**
- `01-content-planner/SKILL.md`
- `02-copy-writer/SKILL.md`
- `03-image-guide/SKILL.md`
- `04-publisher/SKILL.md`
- `05-analytics/SKILL.md`
