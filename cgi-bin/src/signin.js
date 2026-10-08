// 가민 로그인 — 앱 화면에서 받은 이메일·비밀번호로 토큰을 받는다.
//
//   비밀번호는 어디에도 저장하지 않고, 응답·로그에도 내보내지 않는다. 남는 것은 토큰(token.js) 뿐이다.
//   MFA 를 요구하면 가민 로그인 쿠키만 conf.d/signin-pending.json 에 5분 동안 두고, 코드를 받은 요청에서 이어 간다.
//   실패가 3번이면 15분, 가민이 429 로 막으면 2시간 로그인을 받지 않는다 — 반복 로그인이 계정 단위 차단을 부른다.
//
// 파일은 모두 cgi-bin/conf.d (HTTP 로 안 열린다, git·배포 아카이브 제외, 권한 600).
const fs = require("@jsh/fs")
const g = require("./garmin_auth.js")
const token = require("./token.js")
const paths = require("./paths.js")

const PENDING = paths.CONF_DIR + "/signin-pending.json"
const GUARD = paths.CONF_DIR + "/signin-guard.json"
const PENDING_TTL = 5 * 60 * 1000
const MAX_FAIL = 3
const LOCK_MS = 15 * 60 * 1000
const LOCK_429_MS = 2 * 60 * 60 * 1000

function write(p, o) {
  try { fs.mkdir(paths.CONF_DIR) } catch (e) { /* 이미 있다 */ }
  fs.writeFile(p, JSON.stringify(o))
  try { fs.chmod(p, 0o600) } catch (e) { /* 권한을 못 바꾸는 파일 시스템 */ }
}
function remove(p) { try { fs.remove(p) } catch (e) { /* 없다 */ } }

function guard() { return paths.readJson(GUARD) || { fails: 0, lockUntil: 0 } }
function lockedUntil() { const gd = guard(); return gd.lockUntil > Date.now() ? gd.lockUntil : 0 }

function failed(reason, message) {
  const gd = guard()
  gd.fails = (gd.fails || 0) + 1
  if (gd.fails >= MAX_FAIL) { gd.lockUntil = Date.now() + LOCK_MS; gd.fails = 0 }
  write(GUARD, gd)
  return { ok: false, reason: reason, message: message || null, lockedUntil: gd.lockUntil > Date.now() ? gd.lockUntil : 0 }
}
function rateLimited() {
  write(GUARD, { fails: 0, lockUntil: Date.now() + LOCK_429_MS })
  remove(PENDING)
  return { ok: false, reason: "rate_limited", lockedUntil: Date.now() + LOCK_429_MS }
}

// 티켓 -> OAuth1 -> OAuth2 -> 토큰 저장
function finish(jar, ticket) {
  const consumer = g.consumerCreds()
  const o1 = g.oauth1(jar, ticket, consumer)
  if (o1.status === 429) return rateLimited()
  if (!o1.token) return { ok: false, reason: "oauth1_failed", message: "HTTP " + o1.status }
  const o2 = g.oauth2(jar, consumer, { token: o1.token, secret: o1.secret, mfaToken: o1.mfaToken })
  if (o2.status === 429) return rateLimited()
  let j = null
  try { j = JSON.parse(o2.body) } catch (e) { /* 아래 */ }
  if (!j || !j.access_token) return { ok: false, reason: "oauth2_failed", message: "HTTP " + o2.status }
  token.save({ oauth1: { token: o1.token, secret: o1.secret, mfaToken: o1.mfaToken || null }, oauth2: j, saved_at: new Date().toISOString() })
  remove(PENDING)
  remove(GUARD)
  return { ok: true }
}

/** 이메일·비밀번호로 시작한다. 반환 { ok, mfa?, reason?, lockedUntil? } */
function start(email, password) {
  const until = lockedUntil()
  if (until) return { ok: false, reason: "locked", lockedUntil: until }
  email = String(email || "").trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return { ok: false, reason: "invalid_input" }

  const jar = g.newJar()
  g.primeCookies(jar)
  const lg = g.login(jar, email, String(password))
  password = null
  if (lg.status === 429) return rateLimited()
  if (lg.type === "MFA_REQUIRED") {
    write(PENDING, { cookies: jar.dump(), mfaMethod: lg.mfaMethod || "email", at: Date.now() })
    return { ok: true, mfa: true, method: lg.mfaMethod || "email" }
  }
  if (!lg.ticket) return failed("sign_in_failed", lg.message)
  return finish(jar, lg.ticket)
}

/** MFA 코드로 이어 간다 */
function mfa(code) {
  const until = lockedUntil()
  if (until) return { ok: false, reason: "locked", lockedUntil: until }
  const p = paths.readJson(PENDING)
  if (!p || Date.now() - p.at > PENDING_TTL) { remove(PENDING); return { ok: false, reason: "expired" } }
  code = String(code || "").trim()
  if (!/^\d{4,8}$/.test(code)) return { ok: false, reason: "invalid_input" }
  const jar = g.newJar(p.cookies)
  const mf = g.verifyMfa(jar, code, p.mfaMethod)
  if (mf.status === 429) return rateLimited()
  if (!mf.ticket) return failed("bad_code", mf.message)
  return finish(jar, mf.ticket)
}

function signOut() {
  token.remove()
  remove(PENDING)
  return { ok: true }
}

/** 화면이 보는 상태. 토큰 내용은 내보내지 않는다 */
function state() {
  const p = paths.readJson(PENDING)
  const t = token.read()
  return {
    signedIn: !!(t && t.oauth1),
    since: t ? t.saved_at || null : null,
    pendingMfa: !!(p && Date.now() - p.at <= PENDING_TTL),
    lockedUntil: lockedUntil(),
  }
}

module.exports = { start, mfa, signOut, state }
