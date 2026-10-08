// 시간대 시험 — days.js 가 neo 서버의 시간대(TZ)를 따르는지 본다. 가민·DB 를 부르지 않는다.
//   machbase-neo jsh test/test_days.js                         (저장소 맨 위에서)
//   TZ=America/New_York machbase-neo jsh test/test_days.js     (서머타임이 있는 곳 — Linux·macOS)
const fs = require("@jsh/fs")
const SELF = fs.resolveAbsPath(String(require("@jsh/process").argv[1]))
const ROOT = SELF.split("/").slice(0, -2).join("/")
const days = require(ROOT + "/cgi-bin/src/days.js")

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("  실패:", what) } }
const off = -new Date(2026, 0, 15).getTimezoneOffset()   // 1월의 UTC 와의 차 (분)
console.log("시간대 : UTC" + (off >= 0 ? "+" : "") + off / 60 + " (1월), 7월 " + (-new Date(2026, 6, 15).getTimezoneOffset() / 60))

console.log("1) 현지 자정과 문자열이 서로 맞는다")
ok(days.text(days.midnight("2026-03-08")) === "2026-03-08 00:00:00", "자정 → 문자열 (뉴욕 서머타임 시작일)")
ok(days.text(days.midnight("2026-11-01")) === "2026-11-01 00:00:00", "자정 → 문자열 (뉴욕 서머타임 끝나는 날)")
ok(days.parseLocal("2026-10-07 18:30:05") === new Date(2026, 9, 7, 18, 30, 5).getTime(), "현지 문자열 → ms")
ok(days.midnight("2026-01-01") === Date.UTC(2026, 0, 1) - off * 60e3, "자정이 시간대만큼 UTC 와 어긋난다")

console.log("2) 어제·오늘")
const now = new Date()
ok(days.ymd(0) === days.ymdOf(now), "오늘은 현지 날짜")
const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
ok(days.ymd(1) === days.ymdOf(y), "어제")
ok(days.ymd(365) < days.ymd(1), "1년 전")

console.log("3) 가민 활동 — 시작 시각은 GMT 로, 날짜는 가민의 현지 날짜로")
const a = { startTimeLocal: "2026-10-06 07:03:12", startTimeGMT: "2026-10-05 22:03:12" }   // 서울에서 아침 7시에 뛴 러닝
ok(days.activityStart(a) === Date.UTC(2026, 9, 5, 22, 3, 12), "GMT 가 있으면 서버 시간대와 상관없이 같은 순간")
ok(days.activityDay(a) === "2026-10-06", "날짜는 가민이 정한 현지 날짜")
const b = { startTimeLocal: "2026-10-06 07:03:12" }
ok(days.activityStart(b) === new Date(2026, 9, 6, 7, 3, 12).getTime(), "GMT 가 없으면 현지 시각을 서버 시간대로")
ok(!days.activityStart({}), "시각이 없으면 NaN")

console.log("")
console.log("통과 " + pass + " / 실패 " + fail)
if (fail) require("@jsh/process").exit(1)
