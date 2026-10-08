// 토큰 보관과 갱신.
// OAuth2 액세스 토큰은 약 19시간이면 만료된다. OAuth1 토큰은 오래가므로
// 만료 시 OAuth1 로 다시 exchange 하면 재로그인 없이 갱신된다.
const fs = require("@jsh/fs")
const g = require("./garmin_auth.js")
const paths = require("./paths.js")

// cgi-bin/conf.d/token.json — cgi-bin 아래 일반 파일은 HTTP 로 열리지 않는다 (paths.js)
const PATH = paths.TOKEN

function read() {
  try { return JSON.parse(Buffer.from(fs.readFile(PATH)).toString("utf8")) } catch (e) { return null }
}
// 토큰은 계정 데이터를 읽을 수 있는 자격이다. 본인만 읽게 잠근다
function save(o) {
  try { fs.mkdir(paths.CONF_DIR) } catch (e) { /* 이미 있다 */ }
  fs.writeFile(PATH, JSON.stringify(o))
  try { fs.chmod(PATH, 0o600) } catch (e) { /* 권한을 못 바꾸는 파일 시스템 */ }
}
function remove() { try { fs.remove(PATH) } catch (e) { /* 없다 */ } }

let lastStatus = 0                    // 마지막 갱신 요청의 HTTP 상태 (collector.js 가 429 인지 본다)

function ensureToken() {
  const t = read()
  if (!t || !t.oauth1) return null
  const savedAt = Date.parse(t.saved_at || 0) / 1000
  const expiresIn = (t.oauth2 && t.oauth2.expires_in) || 0
  const left = savedAt + expiresIn - Date.now() / 1000

  if (left > 300) return { access: t.oauth2.access_token, refreshed: false }

  // 만료 임박 -> OAuth1 으로 재교환
  const consumer = g.consumerCreds()
  const jar = g.newJar()
  const o2 = g.oauth2(jar, consumer, { token: t.oauth1.token, secret: t.oauth1.secret, mfaToken: t.oauth1.mfaToken })
  lastStatus = o2.status
  if (o2.status !== 200) return null
  const j = JSON.parse(o2.body)
  save({ oauth1: t.oauth1, oauth2: j, saved_at: new Date().toISOString() })
  return { access: j.access_token, refreshed: true }
}

module.exports = { ensureToken, read, save, remove, PATH, lastStatus: () => lastStatus }
