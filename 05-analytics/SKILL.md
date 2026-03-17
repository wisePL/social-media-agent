# Agent 05 — Analytics (성과 분석 + 개선 루프)

## 역할
발행된 콘텐츠의 성과를 수집·분석하고, 다음 공지 개선에 반영합니다.
- Twitter/X 트윗 성과 데이터 수집
- Discord 반응 데이터 수집
- 노션 페이지에 성과 리포트 기록
- 패턴 분석 및 개선 제안 생성
- Status를 **Done**으로 업데이트

---

## 트리거 조건

### 자동 트리거
발행 후 24시간이 지난 LIVE 상태 페이지 자동 분석.

```
tool: create_scheduled_task
taskId: analytics-[page_id 앞 8자리]
description: "[공지 제목] 성과 분석"
# 발행 시간 + 24시간 후
fireAt: [publish_datetime + 24h ISO-8601]
prompt: "05-analytics/SKILL.md 실행. notion_page_id=[page_id], twitter_tweet_id=[id]"
```

### 수동 트리거
- "성과 분석해줘", "이번 공지 어떻게 됐어?"
- "지난 [기간] 공지 전체 분석해줘"

---

## 수집할 지표

### Twitter/X 지표
```
tweet_id 기준 GET /2/tweets/:id 으로 조회:
```

| 지표 | API 필드 | 의미 |
|------|----------|------|
| Impressions | public_metrics.impression_count | 노출 횟수 |
| Likes | public_metrics.like_count | 좋아요 |
| Retweets | public_metrics.retweet_count | 리트윗 |
| Replies | public_metrics.reply_count | 댓글 수 |
| Quotes | public_metrics.quote_count | 인용 수 |
| Engagement Rate | (likes+RT+replies) / impressions × 100 | 참여율 |
| Link Clicks | non_public_metrics.url_link_clicks | 링크 클릭 (권한 필요) |

### Discord 지표 (웹훅 방식 제한적)
Discord 웹훅으로 보낸 메시지는 API로 반응을 조회하기 어려움.
다음 방법 중 선택:

**방법 A: Discord Bot 연동 (권장)**
```
Discord Bot Token 필요 (별도 설정)
GET /channels/{channel_id}/messages/{message_id}
reactions 필드에서 이모지별 count 조회
```

**방법 B: 수동 입력**
담당자가 발행 24시간 후 노션 페이지에 Discord 반응 수 직접 기입.

**방법 C: 주관적 평가**
게시글 체감 반응(댓글 수, 멘션 수 등)을 담당자가 기입.

수집 지표:
| 지표 | 측정 방법 |
|------|-----------|
| 반응 (이모지) | Bot API 또는 수동 |
| 댓글/스레드 수 | Bot API 또는 수동 |
| 도달 멤버 수 | 수동 추정 |

---

## 워크플로우

### Step 1 — 기존 데이터 확인
```
tool: notion-fetch
id: [notion_page_id]
```
LIVE 상태 + 발행 로그에서 tweet_id, discord_message_id 추출.

### Step 2 — Twitter 데이터 수집
```bash
curl "https://api.twitter.com/2/tweets/[tweet_id]?tweet.fields=public_metrics,non_public_metrics,created_at" \
  -H "Authorization: Bearer [TWITTER_BEARER_TOKEN]"
```

응답에서 다음 추출:
```json
{
  "data": {
    "public_metrics": {
      "retweet_count": N,
      "reply_count": N,
      "like_count": N,
      "quote_count": N,
      "impression_count": N
    }
  }
}
```

Engagement Rate = (likes + retweets + replies + quotes) / impressions × 100

### Step 3 — 벤치마크 비교

마케팅 캘린더에서 최근 5개 LIVE/Done 포스트 조회:
```
tool: notion-query-data-source (또는 notion-search)
collection: 2bfed889-905f-8105-9313-000bb0f90cb5
filter: Status = "Done" OR Status = "LIVE"
limit: 5
```

평균 성과와 비교하여 이번 포스트 성과 평가.

**Twitter 업계 벤치마크 (Web3/Gaming):**
| 지표 | 평균 | 좋음 | 매우 좋음 |
|------|------|------|----------|
| Engagement Rate | 0.5-1% | 1-2% | 2%+ |
| Impressions | 기준값 대비 | +20% | +50% |
| RT/Like 비율 | 1:5 | 1:3 | 1:1 |

### Step 4 — 개선 인사이트 생성

다음 분석 프레임으로 인사이트 도출:

**1. 내용 분석**
- 어떤 포인트가 반응을 끌었는가? (RT/인용 확인)
- 어떤 부분이 반응이 낮았는가?

**2. 타이밍 분석**
- 발행 시간대가 적절했는가? (Web3/Gaming 최적 시간: UTC 14:00-18:00 = KST 23:00-03:00)
- 경쟁 포스트와 타이밍이 겹쳤는가?

**3. 포맷 분석**
- 이미지 첨부 여부와 반응 상관관계
- Thread vs 단일 트윗 성과 차이
- 해시태그 효과

**4. 카피 분석**
- 첫 줄(Hook)의 임팩트
- CTA 클릭률 (링크 클릭 데이터 있는 경우)
- 이모지/포맷의 가독성

### Step 5 — 성과 리포트 작성

노션 페이지 하단에 성과 리포트 섹션 추가:

```markdown
---
## 📊 성과 리포트 ([분석 날짜])

### Twitter 성과
| 지표 | 결과 | 벤치마크 대비 |
|------|------|--------------|
| 노출 (Impressions) | [N] | [+/-N%] |
| 좋아요 | [N] | |
| 리트윗 | [N] | |
| 댓글 | [N] | |
| Engagement Rate | [N%] | [평균: N%] |

**트위터 링크:** [URL]

---

### Discord 성과
| 지표 | 결과 |
|------|------|
| 이모지 반응 수 | [N] |
| 스레드 댓글 수 | [N] |
| 주요 반응 이모지 | [👍 N, 🔥 N, ...] |

---

### 🔍 인사이트

**잘 된 점 ✅**
- [인사이트 1]
- [인사이트 2]

**개선 필요 ⚠️**
- [개선사항 1]
- [개선사항 2]

**다음 공지 적용 사항 💡**
- [ ] [액션 아이템 1]
- [ ] [액션 아이템 2]
- [ ] [액션 아이템 3]

---
*분석 기준 시각: [publish + 24h]*
```

`notion-update-page` 툴로 위 내용을 페이지 하단에 추가.

### Step 6 — 분석 완료 처리
```
Status는 LIVE 유지 (별도 Done 상태 없음)
노션 페이지 하단 성과 리포트 섹션 추가로 완료 표시
```

### Step 7 — 결과 보고

```
📊 성과 분석 완료

📌 [공지 제목]
⏰ 발행: [datetime KST] → 분석: [datetime KST]

🐦 Twitter 성과:
  • 노출: [N] | 좋아요: [N] | RT: [N]
  • Engagement Rate: [N%] (벤치마크 대비 [+/-N%])

💬 Discord 성과:
  • 반응: [N] | 댓글: [N]

🔑 핵심 인사이트:
  [상위 1-2개 인사이트]

💡 다음 공지 개선 포인트:
  [상위 1-2개 액션 아이템]

🔄 Status: Done
📄 노션: [URL]
```

---

## 월간 종합 리포트 기능

매월 첫 번째 월요일에 자동으로 월간 리포트 생성 (optional 스케줄 설정):

```
분석 대상: 지난 달 Status = "Done"인 모든 페이지
생성 내용:
  1. 총 발행 건수
  2. 채널별 평균 성과
  3. 최고/최저 성과 게시물
  4. 공지 유형별 효과 비교
  5. 다음 달 전략 제안
```

월간 리포트는 마케팅 캘린더 DB 상위 페이지(V8 Marketing Strategy)에 새 페이지로 저장.

---

## 개선 루프 메모리 (Self-Improvement Loop)

### Step A — 개별 공지 인사이트 저장
분석 완료 후 `memory/marketing-insights.md`에 누적 저장:

```markdown
## [날짜] [공지 제목]
- 유형: [announcement_type]
- 채널: [channels]
- 프레임워크: [PAS/BAB/4Us/Hook-Story-Offer]
- 발행 시간: [KST]
- Engagement Rate: [N%] / 벤치마크 대비 [+/-N%p]
- Impressions: [N]
- RT/Like 비율: [1:N]
- 이미지 포함: [Y/N]
- 최고 반응 요소: [설명]
- 개선 필요: [설명]
- 훅 유형: [수치/반전/금지/질문/진술]
```

### Step B — 주간 A/B 테스트 분석 (매주 월요일 자동 실행)

#### A/B 가설 프레임워크

단순 비교가 아닌 **가설 기반 분석**으로 실행 가능한 인사이트 도출:

```
가설 구조:
"[변수]를 [A]에서 [B]로 바꾸면, [지표]가 [방향]할 것이다.
왜냐하면 [심리/알고리즘 근거]."

예시:
"훅 패턴을 '질문형'에서 '수치형'으로 바꾸면,
Engagement Rate가 올라갈 것이다.
왜냐하면 수치는 구체성을 높여 스크롤을 멈추게 하기 때문."
```

**테스트 가능한 변수 목록:**

| 변수 | 테스트 A | 테스트 B | 측정 지표 |
|------|---------|---------|---------|
| 훅 패턴 | 수치형 | 반전형 | Engagement Rate |
| 카피 프레임워크 | PAS | BAB | RT/Like 비율 |
| 발행 시간 | 09-11시 KST | 21-23시 KST | Impressions |
| 이미지 포함 | 있음 | 없음 | Click-through |
| CTA 위치 | 트윗 끝 | 트윗 중간 | Link clicks |
| 해시태그 수 | 2개 | 4개 | Reach |
| Thread vs 단일 | 7-tweet thread | 단일 트윗 | Bookmark rate |

**최소 샘플 기준:**
- 동일 변수 비교는 **최소 5개 이상** 데이터 필요 (신뢰도 확보)
- 5개 미만이면 "경향성 관찰" 수준으로만 기록, 확정 결론 금지
- 계절/이벤트 효과 교란 변수 명시 (예: "이 주간은 ETH Denver 영향")



`marketing-insights.md` 데이터로 가설 프레임워크 기반 A/B 분석 수행:

```
1. 프레임워크별 평균 Engagement Rate 비교
   PAS: N% / BAB: N% / 4Us: N% / Hook-Story-Offer: N%
   → 공지 유형별 최고 성과 프레임워크 확정

2. 훅 패턴별 성과 비교
   수치훅: N% / 반전훅: N% / 금지훅: N% / 질문훅: N% / 진술훅: N%
   → 현재 Verse8 오디언스에게 가장 효과적인 훅 패턴 확정

3. 발행 시간대별 성과
   09-11시: N% / 21-23시: N% / 01-03시: N%
   → 최적 시간대 업데이트

4. 이미지 포함 여부 효과
   이미지 있음 평균: N% / 없음 평균: N%
```

### Step B-2 — 주간 리포트 전송 (Step B 분석 완료 후)

분석 완료 후 **Slack 팀 채널**(`SLACK_TEAM_CHANNEL`)에 리포트 전송:

```
tool: slack_send_message
channel: SLACK_TEAM_CHANNEL
text: |
  📊 *Verse Eight Weekly Marketing Report* ([MM/DD] - [MM/DD])

  📣 Posts: [N] this week | [±N vs last week]
  Avg Engagement Rate: [N%] ([±N%p vs benchmark])

  🏆 *Best Post*
  "[Title]" — Eng.Rate [N%] | RT [N] | Impressions [N]
  Hook: [pattern] | Framework: [name] | Time: [KST]

  📉 *Needs Improvement*
  "[Title]" — Eng.Rate [N%]
  Why: [1-line analysis]

  💡 *Top 3 Actions for Next Week*
  1. [action item]
  2. [action item]
  3. [action item]

  📄 Full report: https://www.notion.so/326ed889905f8113aed3e45747acc14a
```

**리포트 후 Notion 업데이트 (2곳):**

**A. 대시보드 Weekly Summary 업데이트**
```
tool: notion-update-page
page_id: 326ed889-905f-8113-aed3-e45747acc14a  ← Marketing Ops Dashboard

→ "Weekly Summary" 테이블 업데이트:
  Posts Published: [N] / Avg Engagement Rate: [N%]
  Best Post: [title + eng rate] / Worst Post: [title + eng rate]
→ "Top 3 Improvements for Next Week" 텍스트 교체
→ "Agent Health" 05 analytics 행: Last Run = [현재 KST], Status = ✅
```

**B. Weekly Reports Archive에 이번 주 서브페이지 생성 (아카이브)**
```
tool: notion-create-pages
parent.page_id: 326ed889-905f-816e-acac-f15f3c3ed4d4  ← Weekly Reports Archive

title: "Week of [MM/DD/YYYY]"
content:
  ## Summary
  Period: [MM/DD]-[MM/DD] | Posts: [N] | Avg Eng. Rate: [N%]

  ## A/B Analysis
  [프레임워크/훅/시간대/이미지 분석 전문]

  ## Top 3 Actions for Next Week
  1. / 2. / 3.

  ## Raw Data
  [이번 주 marketing-insights.md 데이터]
```

---

### Step C — 월간 Few-Shot 자동 업데이트 (매월 1일)

**02-copy-writer/SKILL.md의 "Few-Shot 고성과 예시" 섹션을 자동 갱신:**

```
tool: Edit
file: 02-copy-writer/SKILL.md
섹션: "## Few-Shot 고성과 예시"

교체 내용:
### 📈 고성과 패턴 (상위 3개, Engagement Rate 순)
1. [공지 제목] ([날짜]) — [프레임워크]
   카피: "[트윗 전문]"
   성과: 노출 [N] | 참여율 [N%] | RT [N]
   패턴: [핵심 성공 요소]

2. ...

### 📉 저성과 반례 (하위 2개, 피해야 할 패턴)
- "[카피 앞부분...]" → 노출 [N], 참여율 [N%]
  문제점: [분석]

### 💡 현재 적용 중인 개선 인사이트
- [공지 유형]에는 [프레임워크]가 [N%p] 더 효과적 (N개 샘플 기준)
- 최적 발행 시간: [KST] (지난 30일 데이터 기준)
- 이미지 포함 시 평균 [N%p] 성과 차이
```

### Step D — 월간 Meta-Prompting 제안 (매월 1일, Step C 이후)

성과 데이터 기반으로 `02-copy-writer/SKILL.md`의 Constitution 또는 규칙 업데이트 **제안** 생성:

```
"지난 30일 데이터를 바탕으로 현재 Constitution의
어떤 원칙이 실제 성과와 일치/불일치하는지 분석하고,
SKILL.md 업데이트 제안 3가지를 작성하라.
단, Verse8 브랜드 가이드 절대 원칙(SAY/DON'T SAY)은 변경 금지."
```

→ 제안 내용을 Slack DM(`SLACK_NOTIFICATION_CHANNEL`)으로 전송, 팀 승인 후 수동 적용.
(자동 적용 아님 — 브랜드 가이드 변경은 반드시 사람이 검토)

---

## 오류 처리

| 오류 상황 | 처리 방법 |
|-----------|-----------|
| Twitter API 데이터 없음 | 24시간 더 대기 후 재시도 |
| tweet_id 없음 | 발행 로그에서 수동 입력 요청 |
| Discord 데이터 없음 | "N/A (수동 측정 필요)" 표시 |
| 비교 데이터 부족 | 베이스라인 쌓일 때까지 절대값만 기록 |
