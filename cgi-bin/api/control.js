'use strict';
/**
 * POST cgi-bin/api/control { neo: <accessToken>, action: "start" | "stop" } — 사이드 패널의 수집 켜기·끄기 버튼.
 * neo 로그인이 없으면 401 (signin.js 와 같은 확인). App Store 카드의 스위치와 같은 일을 한다.
 *
 *   stop  : 수집 서비스를 멈춘다. 컨트롤러가 SIGKILL 로 죽이므로 하루치 수집 도중이면 그 날은 다음에 다시 받는다
 *   start : 이미 돌거나 시작 중이면 그대로 둔다 — 두 번 start 하면 수집기가 둘 뜬다 (scripts/start.js 와 같은 규칙)
 * 응답 : { ok: true, data: { service: running|starting|stopped|missing } }
 */
const service = require('service');
// jsh 의 require 는 상대 경로를 진입 스크립트 기준으로 풀지 못한다 — 패키지 루트에서 절대 경로로 부른다 (8.7.1)
const SELF = require('@jsh/fs').resolveAbsPath(String(require('process').argv[1]));
const ROOT = SELF.slice(0, SELF.lastIndexOf('/cgi-bin/'));
const src = (m) => require(ROOT + '/cgi-bin/src/' + m);
const cgi = src('cgi.js');
const paths = src('paths.js');

const SERVICE_NAME = 'neo-pkg-garmin-svc';

function status(cb) {
    service.status(SERVICE_NAME, function (missing, info) {
        cb(missing ? 'missing' : String((info && info.status) || '').toLowerCase() || 'unknown');
    });
}
const isUp = (st) => st === 'running' || st === 'starting';

const b = cgi.method() === 'POST' ? cgi.readBody() : {};
if (!cgi.neoUser(b, paths.neoUrl())) {
    cgi.reply({ ok: false, reason: 'neo_auth' }, 401);
} else {
    const done = (err, st) => (err ? cgi.fail(err.message || String(err)) : cgi.ok({ service: st }));
    try {
        status(function (st) {
            if (b.action === 'stop') {
                if (!isUp(st)) { done(null, st); return; }
                service.stop(SERVICE_NAME, function (err) { if (err) done(err); else status((s) => done(null, s)); });
            } else if (b.action === 'start') {
                if (st === 'missing') { done(new Error('service not installed — reinstall the package')); return; }
                if (isUp(st)) { done(null, st); return; }
                service.start(SERVICE_NAME, function (err) { if (err) done(err); else status((s) => done(null, s)); });
            } else {
                done(new Error('unknown action'));
            }
        });
    } catch (e) {
        cgi.fail(e && e.message ? e.message : String(e));
    }
}
