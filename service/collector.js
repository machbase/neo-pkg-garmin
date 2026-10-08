// 상주 수집기 (JSH). scripts/install.js 가 neo 서비스 neo-pkg-garmin-svc 로 등록한다.
//
//   1시간마다 : 어제·오늘을 다시 본다 (시계 동기화가 늦어도 어제치를 채운다)
//   과거 채우기 : 아직 안 받은 과거(최대 1년)가 있으면 15초에 하루씩 받는다 — 로그인 직후 1년치가 약 2시간에 찬다.
//                 가민이 429 로 막으면 바로 멈추고 1시간 뒤 이어 간다
//   토큰이 없으면 : 1분마다 확인하며 기다린다 — 로그인 화면에서 토큰을 만들면 곧 수집을 시작한다
//   상태 : data/status.json 에 쓴다 (사이드 패널이 cgi-bin/api/status 로 읽는다)
//
// 이 파일은 cgi-bin 밖에 둔다. cgi-bin 안에 두면 HTTP 요청 한 번에 수집기가 하나 더 뜬다 (coin-collector 와 같은 이유).
// 서비스 stop 은 SIGKILL 이라 종료 훅이 돌지 않는다. 하루치 수집 도중에 멈추면 그 날은 다음 tick 에 다시 받는다.
const fs = require("@jsh/fs")
const process = require("@jsh/process")
// jsh 의 require 는 상대 경로를 진입 스크립트 기준으로 풀지 못한다 (./ ../ 모두 "Invalid module" — 8.7.1 실측).
// 패키지 루트를 이 파일 위치에서 계산해 절대 경로로 부른다. src 안의 모듈끼리는 ./x.js 로 부를 수 있다.
const SELF = require("@jsh/fs").resolveAbsPath(String(require("@jsh/process").argv[1]))
const ROOT = SELF.split("/").slice(0, -2).join("/")
const src = (m) => require(ROOT + "/cgi-bin/src/" + m)
const collect = src("collector.js")
const schema = src("schema.js")
const days = src("days.js")
const token = src("token.js")
const paths = src("paths.js")

const EVERY_MS = 60 * 60 * 1000      // 1시간마다 어제·오늘
const WAIT_LOGIN_MS = 60 * 1000      // 토큰이 없을 때 다시 볼 간격
const CATCHUP_GAP_MS = 15 * 1000     // 과거 채우기 : 하루 받고 쉬는 시간
const BACKFILL_DAYS = 365            // 최대 1년까지 거슬러 간다

// 가민의 하루는 사용자의 현지 날짜다. neo 서버의 시간대로 센다 (days.js)
const ymd = days.ymd

const status = { state: "starting", startedAt: new Date().toISOString(), lastTick: null, lastOk: null, backfilled: 0, pastDay: null, error: null }
function writeStatus(patch) {
  Object.assign(status, patch || {}, { updatedAt: new Date().toISOString() })
  try { fs.mkdir(paths.DATA_DIR) } catch (e) { /* 이미 있다 */ }
  try { fs.writeFile(paths.STATUS, JSON.stringify(status)) } catch (e) { console.log("상태 파일을 못 썼다:", String(e)) }
}

let timer = null
function schedule(fn, ms) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(fn, ms)
  writeStatus({ nextTick: new Date(Date.now() + ms).toISOString() })
}

let back = 2                          // 과거 채우기 커서 (며칠 전). 받은 날은 collector 가 건너뛴다
let caughtUp = false                  // 1년을 한 번 다 훑었다. 수집기가 다시 뜨거나 새로 로그인하면 다시 훑는다
function limited(since) { return collect.limits.at >= since }

// 하루치 수집이 예외를 던지면(토큰 갱신 실패 · 가민 401·429 · 적재 실패) 바로 멈추고 1시간 뒤 다시 한다.
// 실패한 날은 "받음" 으로 적지 않으므로 다음에 다시 받는다
function failed(e, since) {
  if (limited(since)) return rateLimited()
  console.log("수집 실패:", String(e))
  writeStatus({ state: "error", error: String(e && e.message || e).slice(0, 300) })
  schedule(tick, EVERY_MS)
}

function tick() {
  if (!token.read()) {
    caughtUp = false
    writeStatus({ state: "waiting_login" })
    schedule(tick, WAIT_LOGIN_MS)
    return
  }
  const stamp = new Date().toISOString().slice(0, 19)
  const t0 = Date.now()
  writeStatus({ state: "collecting", lastTick: stamp })
  try {
    // 어제와 오늘은 항상 다시 본다. 오늘은 계속 쌓이는 중이고, 어제도 시계가 늦게 동기화하면 뒤늦게 채워진다.
    // 이미 들어간 시각은 거른다
    collect.run(ymd(1), { force: true })
    collect.run(ymd(0), { force: true })
  } catch (e) {
    return failed(e, t0)
  }
  writeStatus({ state: "idle", lastOk: stamp, error: null })
  if (caughtUp) { schedule(tick, EVERY_MS); return }
  back = 2
  catchUp()
}

// 아직 안 받은 과거 하루를 받고 15초 쉰다. 받은 날은 DB 만 보고 건너뛴다 (가민을 부르지 않는다).
// 1년을 다 훑으면 그 뒤로는 1시간마다 어제·오늘만 본다
function catchUp() {
  if (!token.read()) { schedule(tick, WAIT_LOGIN_MS); return }
  const t0 = Date.now()
  try {
    while (back <= BACKFILL_DAYS) {
      const day = ymd(back++)
      if (collect.run(day, { force: false })) {
        writeStatus({ state: "catching_up", backfilled: status.backfilled + 1, pastDay: day, lastOk: new Date().toISOString().slice(0, 19) })
        schedule(catchUp, CATCHUP_GAP_MS)
        return
      }
    }
  } catch (e) {
    return failed(e, t0)              // 1시간 뒤 tick 이 2일 전부터 다시 훑는다 — 받은 날은 DB 만 본다
  }
  caughtUp = true
  writeStatus({ state: "idle", pastDay: null })
  schedule(tick, EVERY_MS)
}

function rateLimited() {
  console.log("가민이 요청을 막았다 (429) — 1시간 뒤 이어 간다")
  writeStatus({ state: "rate_limited", error: "Garmin limited requests (HTTP 429); resuming in an hour" })
  schedule(tick, EVERY_MS)
}

console.log("가민 수집기 시작 — " + (EVERY_MS / 60000) + "분마다 · 패키지 " + paths.ROOT)
const s = schema.ensure()
if (s.failed.length) console.log("!! 테이블을 못 만들었다:", JSON.stringify(s.failed))
writeStatus({ state: "starting" })
tick()
process.watchSignal(function () { console.log("종료 신호. 수집기를 멈춥니다."); process.exit(0) })
