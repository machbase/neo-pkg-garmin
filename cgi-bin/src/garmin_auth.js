// Garmin Connect 인증 (JSH 단독) — 모바일 SSO 방식.
//
//   1) GET  sso.garmin.com/mobile/sso/en/sign-in      쿠키 획득
//   2) POST sso.garmin.com/mobile/api/login           JSON 로그인 -> serviceTicketId
//      (MFA 계정이면 responseStatus.type = MFA_REQUIRED -> verifyMfa)
//   3) GET  connectapi.../oauth-service/oauth/preauthorized   OAuth1 토큰
//   4) POST connectapi.../oauth-service/oauth/exchange/user/2.0  OAuth2 액세스 토큰
//
// 예전 웹 폼 방식(/sso/signin + HTML 에서 ticket 추출)은 가민이 바꿔서 더 이상 통하지 않는다.
// 응답이 "예기치 않은 오류가 발생했습니다" 로만 오고 원인을 알려주지 않는다.
//
// @jsh/crypto 에 HMAC 이 없어 OAuth1 서명은 sha1.js 의 순수 JS 구현을 쓴다.
const http = require("@jsh/http")
const { hmacSha1, toBytes, toB64 } = require("./sha1.js")

const DOMAIN = "garmin.com"
const SSO = "https://sso." + DOMAIN
const API = "https://connectapi." + DOMAIN
const CLIENT_ID = "GCM_ANDROID_DARK"
const SERVICE_URL = "https://mobile.integration." + DOMAIN + "/gcm/android"
const CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json"

// SSO 는 앱 안의 WebView 로 도므로 브라우저처럼 보여야 한다.
// HTTP 클라이언트 티가 나면 Cloudflare 가 막는다.
const SSO_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
const SSO_HEADERS = {
  "User-Agent": SSO_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
}
// OAuth 엔드포인트는 반대로 안드로이드 앱이어야 한다 (consumer key 와 짝이다)
const OAUTH_UA = "com.garmin.android.apps.connectmobile"

// ── 쿠키 단지 : @jsh/http 는 쿠키를 유지해 주지 않으므로 직접 모은다 ──
// initial 을 주면 저장해 둔 쿠키로 다시 만든다 (MFA 를 기다리는 동안 CGI 요청 두 번에 걸쳐 쓴다 — signin.js)
function newJar(initial) {
  const jar = Object.assign({}, initial || {})
  return {
    dump() { return Object.assign({}, jar) },
    absorb(rsp) {
      const h = rsp.headers || {}
      let sc = h["Set-Cookie"] || h["set-cookie"] || []
      if (typeof sc === "string") sc = [sc]
      for (const line of sc) {
        const kv = String(line).split(";")[0]
        const i = kv.indexOf("=")
        if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
      }
    },
    header() { return Object.keys(jar).map(k => k + "=" + jar[k]).join("; ") },
    size() { return Object.keys(jar).length },
  }
}

const client = http.NewClient()

// @jsh/http 주의 : NewRequest 의 옵션 객체(headers/body)는 무시된다.
// 헤더는 req.header.set(), 본문은 req.writeString() 으로 넣어야 실제로 전송된다.
// (postman-echo 로 확인 : 옵션으로 넘기면 content-length 0, UA 도 Go-http-client 로 나간다)
function call(method, url, opt) {
  opt = opt || {}
  const req = http.NewRequest(method, url)
  const headers = Object.assign({}, opt.headers || {})
  if (!headers["User-Agent"]) headers["User-Agent"] = opt.ua || SSO_UA
  if (opt.jar && opt.jar.size() > 0) headers["Cookie"] = opt.jar.header()
  for (const k of Object.keys(headers)) req.header.set(k, headers[k])
  if (opt.body !== undefined && opt.body !== null && opt.body !== "") req.writeString(opt.body)
  const rsp = client.do(req)
  if (opt.jar) opt.jar.absorb(rsp)
  return rsp
}

// ── OAuth1 서명 (RFC 5849, HMAC-SHA1) ─────────────────────────
function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
}
function oauthHeader(method, url, params, consumer, token) {
  const oa = {
    oauth_consumer_key: consumer.key,
    oauth_nonce: String(Date.now()) + String(Math.floor(Math.random() * 1e9)),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  }
  if (token && token.token) oa.oauth_token = token.token

  // 서명 베이스에는 질의 문자열과 폼 본문의 파라미터가 모두 들어간다
  const all = Object.assign({}, params || {}, oa)
  const base = [method.toUpperCase(), pct(url),
    pct(Object.keys(all).sort().map(k => pct(k) + "=" + pct(all[k])).join("&"))].join("&")
  const key = pct(consumer.secret) + "&" + pct(token && token.secret ? token.secret : "")
  oa.oauth_signature = toB64(hmacSha1(toBytes(key), toBytes(base)))

  return "OAuth " + Object.keys(oa).sort().map(k => k + '="' + pct(oa[k]) + '"').join(", ")
}
function parseQS(s) {
  const o = {}
  for (const part of String(s).split("&")) {
    const i = part.indexOf("=")
    if (i > 0) o[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1))
  }
  return o
}

function consumerCreds() {
  const rsp = call("GET", CONSUMER_URL)
  const j = JSON.parse(rsp.string())
  return { key: j.consumer_key, secret: j.consumer_secret }
}

// ── 1) 쿠키 ───────────────────────────────────────────────────
function primeCookies(jar) {
  const rsp = call("GET", SSO + "/mobile/sso/en/sign-in?clientId=" + CLIENT_ID, {
    jar, headers: Object.assign({}, SSO_HEADERS, { "Sec-Fetch-Site": "none" }),
  })
  return { status: rsp.statusCode, cookies: jar.size() }
}

function loginQuery() {
  return "?clientId=" + pct(CLIENT_ID) + "&locale=en-US&service=" + pct(SERVICE_URL)
}

// ── 2) 로그인 ────────────────────────────────────────────────
function login(jar, email, password) {
  const rsp = call("POST", SSO + "/mobile/api/login" + loginQuery(), {
    jar,
    headers: Object.assign({}, SSO_HEADERS, { "Content-Type": "application/json" }),
    body: JSON.stringify({ username: email, password: password, rememberMe: false, captchaToken: "" }),
  })
  const text = rsp.string()
  let j = null
  try { j = JSON.parse(text) } catch (e) { /* HTML 이면 아래에서 처리 */ }
  const type = j && j.responseStatus ? j.responseStatus.type : null
  return {
    status: rsp.statusCode,
    type: type,
    ticket: j ? j.serviceTicketId : null,
    mfaMethod: j && j.customerMfaInfo ? (j.customerMfaInfo.mfaLastMethodUsed || "email") : null,
    message: j && j.responseStatus ? j.responseStatus.message : null,
    text: text,
  }
}

// ── 2-1) MFA 코드 확인 ───────────────────────────────────────
function verifyMfa(jar, code, mfaMethod) {
  const rsp = call("POST", SSO + "/mobile/api/mfa/verifyCode" + loginQuery(), {
    jar,
    headers: Object.assign({}, SSO_HEADERS, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      mfaMethod: mfaMethod || "email",
      mfaVerificationCode: String(code),
      rememberMyBrowser: false,
      reconsentList: [],
      mfaSetup: false,
    }),
  })
  const text = rsp.string()
  let j = null
  try { j = JSON.parse(text) } catch (e) { /* 무시 */ }
  return {
    status: rsp.statusCode,
    type: j && j.responseStatus ? j.responseStatus.type : null,
    ticket: j ? j.serviceTicketId : null,
    message: j && j.responseStatus ? j.responseStatus.message : null,
    text: text,
  }
}

// ── 3) 티켓 -> OAuth1 토큰 ──────────────────────────────────
function oauth1(jar, ticket, consumer) {
  // Cloudflare 백엔드 고정용 쿠키. 실패해도 무시한다.
  try {
    call("GET", SSO + "/portal/sso/embed", {
      jar, headers: Object.assign({}, SSO_HEADERS, { "Sec-Fetch-Site": "same-origin" }),
    })
  } catch (e) { /* 무시 */ }

  const url = API + "/oauth-service/oauth/preauthorized"
  const params = { ticket: ticket, "login-url": SERVICE_URL, "accepts-mfa-tokens": "true" }
  const qs = Object.keys(params).map(k => pct(k) + "=" + pct(params[k])).join("&")
  const rsp = call("GET", url + "?" + qs, {
    jar,
    headers: { "User-Agent": OAUTH_UA, "Authorization": oauthHeader("GET", url, params, consumer, null) },
  })
  const t = parseQS(rsp.string())
  return {
    status: rsp.statusCode,
    token: t.oauth_token,
    secret: t.oauth_token_secret,
    mfaToken: t.mfa_token,
    raw: rsp.string(),
  }
}

// ── 4) OAuth1 -> OAuth2 액세스 토큰 ─────────────────────────
function oauth2(jar, consumer, token) {
  const url = API + "/oauth-service/oauth/exchange/user/2.0"
  // 폼 본문도 서명 베이스에 들어가야 한다
  const form = { audience: "GARMIN_CONNECT_MOBILE_ANDROID_DI" }
  if (token.mfaToken) form.mfa_token = token.mfaToken
  const body = Object.keys(form).map(k => pct(k) + "=" + pct(form[k])).join("&")

  const rsp = call("POST", url, {
    jar,
    headers: {
      "User-Agent": OAUTH_UA,
      "Authorization": oauthHeader("POST", url, form, consumer, token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  })
  return { status: rsp.statusCode, body: rsp.string() }
}

module.exports = {
  newJar, call, consumerCreds, primeCookies, login, verifyMfa, oauth1, oauth2, OAUTH_UA,
}
