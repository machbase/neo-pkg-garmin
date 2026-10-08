// 날짜·시각 도우미. 모두 neo 서버의 시간대(OS 시간대)를 따른다.
// DB 도 같은 시간대로 'YYYY-MM-DD HH24:MI:SS' 문자열을 읽고, 가민의 "하루" 도 사용자의 현지 날짜다.
// 그래서 neo 를 띄운 컴퓨터의 OS 시간대가 가민 계정의 시간대와 같다고 본다.
// TZ 환경변수로 neo 의 시간대만 바꿔 띄우는 것은 안 된다 — 기존 데이터 폴더로 OS 와 다른 TZ 를 주면 neo 가 시작하지 않았다 (8.7.1, MACHCLI-ERR-483).
// (jsh 단독 실행의 Date 는 TZ 를 따르고 서머타임도 계산한다 — test/test_days.js)
const p2 = (n) => (n < 10 ? "0" : "") + n

function ymdOf(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) }

/** 오늘에서 offsetDays 전의 현지 날짜 "YYYY-MM-DD". 서머타임이 바뀌는 날도 하루씩 센다 */
function ymd(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() - (offsetDays || 0))
  return ymdOf(d)
}

/** "YYYY-MM-DD" 의 현지 자정 (ms) — 일별 지표의 시각 */
function midnight(day) {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime()
}

/** ms → 현지 "YYYY-MM-DD HH:MM:SS" (SQL 의 to_date 에 넘긴다) */
function text(ms) {
  const d = new Date(ms)
  return ymdOf(d) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds())
}

/** 현지 "YYYY-MM-DD HH:MM:SS" → ms */
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ""))
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN
}

/** 가민 활동의 시작 시각 (ms). startTimeGMT(UTC) 를 쓰고, 없으면 startTimeLocal 을 서버 시간대로 읽는다 */
function activityStart(a) {
  const gmt = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(a.startTimeGMT || ""))
  return gmt ? Date.parse(gmt[1] + "T" + gmt[2] + "Z") : parseLocal(a.startTimeLocal)
}

/** 가민 활동의 날짜 — 가민이 정한 그 사람의 현지 날짜 (startTimeLocal 앞 10자) */
function activityDay(a) { return String(a.startTimeLocal || "").slice(0, 10) }

module.exports = { ymd, ymdOf, midnight, text, parseLocal, activityStart, activityDay }
