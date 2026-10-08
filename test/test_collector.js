// 수집 시험 — 가민과 DB 를 부르지 않는다. garmin_auth · token · store 의 함수를 가짜로 바꿔 끼운다.
//   machbase-neo jsh test/test_collector.js   (저장소 맨 위에서)
// 실패하면 예외를 던지고 그 날을 "받음" 으로 적지 않는지, 받은 날은 토큰도 건드리지 않는지 본다.
const fs = require("@jsh/fs")
const SELF = fs.resolveAbsPath(String(require("@jsh/process").argv[1]))
const ROOT = SELF.split("/").slice(0, -2).join("/")
const src = (m) => require(ROOT + "/cgi-bin/src/" + m)
const g = src("garmin_auth.js")
const auth = src("token.js")
const store = src("store.js")
const collect = src("collector.js")

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("  실패:", what) } }
const throws = (fn) => { try { fn(); return null } catch (e) { return String(e && e.message || e) } }

// 가짜 DB — 무엇을 불렀는지 센다
let calls = {}
const count = (k) => { calls[k] = (calls[k] || 0) + 1 }
let synced = false, writeStatus = 200
store.isSynced = () => { count("isSynced"); return synced }
store.lastTimes = () => ({})
store.ensureTag = () => {}
store.dailyValues = () => ({})
store.deleteDaily = () => {}
store.timesIn = () => ({})
store.writeMetric = (rows) => { count("writeMetric"); return { status: writeStatus, loaded: rows.length } }
store.clearSpans = () => {}
store.writeSpan = (spans) => spans.length
store.markSynced = (src, day, n, status) => { count("markSynced:" + status) }

// 가짜 토큰
let token = { access: "a", refreshed: false }, renewStatus = 200
auth.ensureToken = () => { count("ensureToken"); return token }
auth.lastStatus = () => renewStatus

// 가짜 가민 — 경로 일부 → [상태, 본문]
const DAY = "2026-10-06", T = Date.parse(DAY + "T09:00:00Z")
let answers = {}
const normal = () => ({
  socialProfile: [200, { displayName: "x" }],
  dailyHeartRate: [200, { heartRateValues: [[T, 60], [T + 120e3, 62]], restingHeartRate: 55 }],
  dailyStress: [200, { stressValuesArray: [[T, 20]], bodyBatteryValuesArray: [[T, "MEASURED", 80]] }],
  "steps/daily": [200, [{ totalSteps: 1234 }]],
  dailySleepData: [200, {}],
  "search/activities": [200, []],
})
g.call = (method, url) => {
  const key = Object.keys(answers).filter((k) => url.indexOf(k) >= 0)[0]
  const a = key ? answers[key] : [404, null]
  return { statusCode: a[0], json: () => a[1], string: () => JSON.stringify(a[1]) }
}
function reset() { calls = {}; synced = false; writeStatus = 200; token = { access: "a", refreshed: false }; renewStatus = 200; answers = normal(); collect.limits.at = 0 }

console.log("1) 받은 날은 DB 만 보고 건너뛴다 — 토큰·가민을 건드리지 않는다")
reset(); synced = true
ok(collect.run(DAY, { force: false }) === false, "false 를 돌려준다")
ok(!calls.ensureToken, "토큰을 건드리지 않는다")

console.log("2) 토큰 갱신이 실패하면 예외 — 다음 날로 넘어가며 가민을 계속 부르지 않게")
reset(); token = null; renewStatus = 401
let m = throws(() => collect.run(DAY, { force: false }))
ok(m && /Sign in again/.test(m), "다시 로그인 안내: " + m)
ok(!calls["markSynced:ok"], "받음으로 적지 않는다")

console.log("3) 토큰 갱신이 429 면 예외 + 수집기가 쉬도록 표시")
reset(); token = null; renewStatus = 429
const t3 = Date.now()
ok(throws(() => collect.run(DAY, { force: true })) !== null, "예외")
ok(collect.limits.at >= t3, "limits.at 이 찍힌다 (수집기가 rate_limited 로 쉰다)")

console.log("4) 가민이 401 로 거절하면 예외 — 다시 로그인 안내")
reset(); answers.socialProfile = [401, null]
m = throws(() => collect.run(DAY, { force: true }))
ok(m && /HTTP 401/.test(m) && /Sign in again/.test(m), "401 안내: " + m)

console.log("5) 도중에 429 면 받은 것은 넣되 \"받음\" 으로 적지 않는다")
reset(); answers.dailyStress = [429, null]
const t5 = Date.now()
m = throws(() => collect.run(DAY, { force: false }))
ok(m && /429/.test(m), "429 예외: " + m)
ok(calls.writeMetric === 1, "받은 심박·걸음은 넣는다")
ok(!calls["markSynced:ok"], "받음으로 적지 않는다 — 다음에 다시 받는다")
ok(collect.limits.at >= t5, "limits.at")

console.log("6) DB 적재가 실패하면 예외")
reset(); writeStatus = 500
m = throws(() => collect.run(DAY, { force: false }))
ok(m && /HTTP 500/.test(m), "적재 실패 예외: " + m)
ok(!calls["markSynced:ok"], "받음으로 적지 않는다")

console.log("7) 정상이면 true, 받음으로 한 번 적는다")
reset()
ok(collect.run(DAY, { force: false }) === true, "true")
ok(calls["markSynced:ok"] === 1, "받음 1번")

console.log("")
console.log("통과 " + pass + " / 실패 " + fail)
if (fail) require("@jsh/process").exit(1)
