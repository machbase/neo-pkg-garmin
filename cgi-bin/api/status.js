'use strict';
/**
 * POST cgi-bin/api/status { neo: <accessToken> } — 사이드 패널용 수집 상태. neo 로그인이 없으면 401 (signin.js 와 같은 확인).
 *
 *   signedIn : 토큰 파일이 있는가 (내용은 절대 돌려주지 않는다)
 *   collector: 수집기가 쓰는 data/status.json 그대로
 *   stale    : 예정된 다음 실행(nextTick)이 10분 넘게 지났는데 상태가 그대로면 수집기가 멈춘 것으로 본다
 *              (수집기는 1시간마다 쓰므로 "10분 동안 안 바뀜" 으로 보면 안 된다)
 *   service  : 서비스 컨트롤러가 아는 상태
 */
const service = require('service');
// jsh 의 require 는 상대 경로를 진입 스크립트 기준으로 풀지 못한다 — 패키지 루트에서 절대 경로로 부른다 (8.7.1 실측)
const SELF = require('@jsh/fs').resolveAbsPath(String(require('process').argv[1]));
const ROOT = SELF.slice(0, SELF.lastIndexOf('/cgi-bin/'));
const src = (m) => require(ROOT + '/cgi-bin/src/' + m);
const cgi = src('cgi.js');
const paths = src('paths.js');

const SERVICE_NAME = 'neo-pkg-garmin-svc';
const GRACE_MS = 10 * 60 * 1000;

if (!cgi.neoUser(cgi.method() === 'POST' ? cgi.readBody() : {}, paths.neoUrl())) {
    cgi.reply({ ok: false, reason: 'neo_auth' }, 401);
} else {
    const st = paths.readJson(paths.STATUS);
    const out = {
        signedIn: paths.exists(paths.TOKEN),
        collector: st,
        stale: !st || !st.nextTick || (Date.now() > Date.parse(st.nextTick) + GRACE_MS),
        service: null,
    };
    try {
        service.status(SERVICE_NAME, { timeout: 3000 }, function (err, info) {
            out.service = err ? 'not_installed' : String((info && info.status) || 'unknown').toLowerCase();
            cgi.ok(out);
        });
    } catch (e) {
        out.service = 'unknown';
        cgi.ok(out);
    }
}
