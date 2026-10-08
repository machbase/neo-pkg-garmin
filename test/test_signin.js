// 로그인 흐름 시험 — 가민을 부르지 않는다. garmin_auth 의 함수를 가짜로 바꿔 끼운다.
//   test/run.sh test/test_signin.js   — cgi-bin/conf.d 에 쓰고 끝나면 지운다 (토큰이 있으면 시작하지 않는다)
const fs = require("@jsh/fs")
const SELF = fs.resolveAbsPath(String(require("@jsh/process").argv[1]))
const ROOT = SELF.split("/").slice(0, -2).join("/")
const src = (m) => require(ROOT + "/cgi-bin/src/" + m)
const g = src("garmin_auth.js")
const paths = src("paths.js")
const signin = src("signin.js")

if (paths.exists(paths.TOKEN)) { console.log("!! cgi-bin/conf.d/token.json 이 있다 — 진짜 토큰을 지우지 않게 멈춘다"); require("@jsh/process").exit(1) }

const PW = "pw-must-not-be-stored-7f3a"
const conf = paths.CONF_DIR
const files = ["signin-pending.json", "signin-guard.json", "token.json"]
const clean = () => files.forEach((f) => { try { fs.remove(conf + "/" + f) } catch (e) { /* 없다 */ } })
const read = (f) => { try { return Buffer.from(fs.readFile(conf + "/" + f)).toString("utf8") } catch (e) { return null } }

let pass = 0, fail = 0, logins = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("  실패:", what) } }

// 가짜 가민
let loginResult = null, mfaResult = null
g.primeCookies = (jar) => ({ status: 200, cookies: 1 })
g.login = (jar, email, pw) => { logins++; return Object.assign({ status: 200 }, loginResult) }
g.verifyMfa = (jar, code, m) => Object.assign({ status: 200 }, mfaResult)
g.consumerCreds = () => ({ key: "k", secret: "s" })
g.oauth1 = () => ({ status: 200, token: "t1", secret: "s1", mfaToken: null })
g.oauth2 = () => ({ status: 200, body: JSON.stringify({ access_token: "a2", expires_in: 3600 }) })

clean()
console.log("1) 입력 검사 — 가민을 부르지 않는다")
ok(signin.start("not-an-email", PW).reason === "invalid_input", "이메일 형식")
ok(signin.start("a@b.co", "").reason === "invalid_input", "빈 비밀번호")
ok(logins === 0, "입력 오류에 가민 호출 0번")

console.log("2) 틀린 비밀번호 3번이면 15분 잠금, 잠긴 동안은 가민을 부르지 않는다")
loginResult = { type: "INVALID_USERNAME_PASSWORD", ticket: null }
let r1 = signin.start("a@b.co", PW), r2 = signin.start("a@b.co", PW), r3 = signin.start("a@b.co", PW)
ok(r1.reason === "sign_in_failed" && !r1.lockedUntil, "1번째는 잠그지 않음")
ok(r3.lockedUntil > Date.now() + 14 * 60e3, "3번째에 약 15분 잠금")
const before = logins
ok(signin.start("a@b.co", PW).reason === "locked" && logins === before, "잠긴 동안 호출 없음")
clean()

console.log("3) 가민 429 면 2시간 잠금")
loginResult = { status: 429 }
const r429 = signin.start("a@b.co", PW)
ok(r429.reason === "rate_limited" && r429.lockedUntil > Date.now() + 119 * 60e3, "429 -> 2시간")
clean()

console.log("4) MFA — 대기 상태, 틀린 형식, 성공, 토큰 저장")
loginResult = { type: "MFA_REQUIRED", mfaMethod: "email", ticket: null }
const rm = signin.start("a@b.co", PW)
ok(rm.ok && rm.mfa && rm.method === "email", "MFA 필요 응답")
ok(signin.state().pendingMfa === true, "대기 상태")
ok(signin.mfa("12a").reason === "invalid_input", "코드 형식")
mfaResult = { ticket: null }
ok(signin.mfa("000000").reason === "bad_code", "틀린 코드")
mfaResult = { ticket: "ST-1" }
const rok = signin.mfa("123456")
ok(rok.ok === true, "맞는 코드 -> 로그인")
const st = signin.state()
ok(st.signedIn === true && st.pendingMfa === false && !st.lockedUntil, "로그인 상태 · 대기·잠금 지움")
ok(read("signin-pending.json") === null && read("signin-guard.json") === null, "대기·잠금 파일 지움")
const tok = read("token.json")
ok(tok && JSON.parse(tok).oauth1.token === "t1", "토큰 저장")
let mode = null
try { mode = fs.stat(conf + "/token.json").mode } catch (e) { /* 없음 */ }
console.log("   토큰 파일 권한:", mode)

console.log("5) 비밀번호는 어떤 파일에도 남지 않는다")
let leaked = false
try { fs.readDir(conf).forEach((e) => { const t = read(e.name); if (t && t.indexOf(PW) >= 0) leaked = true }) } catch (e) { /* readDir 형식이 다르면 아래 파일들만 */ files.forEach((f) => { const t = read(f); if (t && t.indexOf(PW) >= 0) leaked = true }) }
ok(!leaked, "비밀번호가 conf.d 어디에도 없음")

console.log("6) 로그아웃")
ok(signin.signOut().ok && signin.state().signedIn === false && read("token.json") === null, "토큰 삭제")

console.log("7) MFA 대기 5분이 지나면 만료")
loginResult = { type: "MFA_REQUIRED", mfaMethod: "phone", ticket: null }
signin.start("a@b.co", PW)
const p = JSON.parse(read("signin-pending.json")); p.at = Date.now() - 6 * 60e3
fs.writeFile(conf + "/signin-pending.json", JSON.stringify(p))
ok(signin.mfa("123456").reason === "expired", "만료")

clean()
console.log("")
console.log("통과 " + pass + " / 실패 " + fail)
if (fail) require("@jsh/process").exit(1)
