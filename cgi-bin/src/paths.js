// 경로와 설정을 한곳에서 정한다.
//
// 패키지로 설치되면 neo 파일 루트의 public/neo-pkg-garmin/ 에 풀린다 (jsh 안에서는 /work/public/neo-pkg-garmin).
//   토큰 : cgi-bin/conf.d/token.json  — cgi-bin 아래 일반 파일은 HTTP 로 열리지 않는다 (/public/<패키지>/ 의 다른 파일은 열린다)
//   상태 : data/status.json            — 수집기가 쓰고 화면이 읽는다
const fs = require("@jsh/fs")
const process = require("@jsh/process")

/** 패키지 루트. 실행 파일이 cgi-bin 아래(CGI)든 service/·scripts/·test/ 아래든 같은 곳을 가리킨다. */
function packageRoot() {
  // jsh 를 직접 띄우면 argv[1] 이 상대 경로다. 상대 경로는 stat 이 못 찾으므로 절대 경로로 바꾼다
  const script = fs.resolveAbsPath(String((process.argv && process.argv[1]) || ""))
  const at = script.lastIndexOf("/cgi-bin/")
  if (at >= 0) return script.slice(0, at)
  const parts = script.split("/")
  parts.splice(-2, 2)                      // .../<root>/<dir>/<file>.js -> .../<root>
  return parts.join("/") || "."
}

// stat 은 없는 파일에 예외를 던진다
function exists(p) {
  try { fs.stat(p); return true } catch (e) { return false }
}

const ROOT = packageRoot()
const CONF_DIR = ROOT + "/cgi-bin/conf.d"
const DATA_DIR = ROOT + "/data"

const TOKEN = CONF_DIR + "/token.json"
const STATUS = DATA_DIR + "/status.json"

function readJson(p) {
  try { return JSON.parse(Buffer.from(fs.readFile(p)).toString("utf8")) } catch (e) { return null }
}

/**
 * neo 의 HTTP 주소. 적재·질의를 neo 의 HTTP API 로 한다 (store.js).
 *   1) cgi-bin/conf.d/neo.json 의 { "url": … } — 다른 neo 에 쌓고 싶을 때만 만든다
 *   2) /proc/share/ports.json — 이 스크립트를 띄운 neo 자신 (CGI · 서비스 · pkg run 에서 보인다, 8.7.1 실측)
 *      포트를 고정해 두면 다른 포트로 띄운 neo 에 설치했을 때 같은 머신의 다른 서버에 쓴다 (coin-collector 도 같은 경고)
 *   3) 직접 띄운 jsh(시험)에는 /proc/share 가 없다 — 기본 포트 5654
 */
function neoUrl() {
  const c = readJson(ROOT + "/cgi-bin/conf.d/neo.json")
  if (c && c.url) return c.url
  const p = readJson("/proc/share/ports.json")
  const tcp = p && (p.http || []).filter(function (u) { return /^tcp:\/\//.test(u) })[0]
  if (tcp) return "http://" + tcp.slice(6).replace(/^0\.0\.0\.0:/, "127.0.0.1:")
  return "http://127.0.0.1:5654"
}

module.exports = { ROOT, CONF_DIR, DATA_DIR, TOKEN, STATUS, neoUrl, readJson, exists }
