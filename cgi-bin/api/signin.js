'use strict';
/**
 * cgi-bin/api/signin — 가민 로그인 (앱 탭 화면이 부른다)
 *
 * 모두 POST, 본문에 neo 로그인 토큰 { neo: <accessToken> } 이 있어야 한다 (없거나 틀리면 401 · reason "neo_auth")
 *   { action: "state" }                          -> { signedIn, since, pendingMfa, lockedUntil }
 *   { action: "start", email, password }         -> { ok, mfa?, method? } | { ok: false, reason, lockedUntil? }
 *   { action: "mfa", code }                      -> { ok } | { ok: false, reason }
 *   { action: "signout" }                        -> { ok }
 *
 * 비밀번호는 저장하지 않고 응답·로그에도 내보내지 않는다 (src/signin.js).
 * reason : neo_auth · invalid_input · sign_in_failed · bad_code · expired · locked · rate_limited · oauth1_failed · oauth2_failed · error
 */
// jsh 의 require 는 상대 경로를 진입 스크립트 기준으로 풀지 못한다 — 패키지 루트에서 절대 경로로 부른다 (8.7.1 실측)
const SELF = require('@jsh/fs').resolveAbsPath(String(require('process').argv[1]));
const ROOT = SELF.slice(0, SELF.lastIndexOf('/cgi-bin/'));
const src = (m) => require(ROOT + '/cgi-bin/src/' + m);
const cgi = src('cgi.js');
const signin = src('signin.js');

const paths = src('paths.js');

try {
    const b = cgi.method() === 'POST' ? cgi.readBody() : {};
    if (!cgi.neoUser(b, paths.neoUrl())) {
        cgi.reply({ ok: false, reason: 'neo_auth' }, 401);
    } else {
        let r;
        if (b.action === 'state') r = { ok: true, data: signin.state() };
        else if (b.action === 'start') r = signin.start(b.email, b.password);
        else if (b.action === 'mfa') r = signin.mfa(b.code);
        else if (b.action === 'signout') r = signin.signOut();
        else r = { ok: false, reason: 'invalid_input' };
        b.password = null;
        cgi.reply(r);
    }
} catch (e) {
    // 예외 메시지에 요청 내용이 섞일 수 있어 그대로 내보내지 않는다
    cgi.reply({ ok: false, reason: 'error' });
}
