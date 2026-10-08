'use strict';
/**
 * GET cgi-bin/api/health — 앱스토어(neo-web) 실행 스위치용 서비스 상태.
 * neo-web pkgHealth 형식 (neo-pkg-llm-chat · coin-collector 와 같다).
 *
 *   running                    200 { ok: true, data: { healthy: true,  status: 'running', … } }
 *   stopped/starting/failed …  200 { ok: true, data: { healthy: false, status, … } }
 *   서비스 등록 안 됨           200 { ok: true, data: { healthy: false, status: 'not_installed', … } }
 *   서비스 컨트롤러 응답 없음   503 { ok: false, reason }
 */
const service = require('service');
// jsh 의 require 는 상대 경로를 진입 스크립트 기준으로 풀지 못한다 — 패키지 루트에서 절대 경로로 부른다 (8.7.1 실측)
const SELF = require('@jsh/fs').resolveAbsPath(String(require('process').argv[1]));
const ROOT = SELF.slice(0, SELF.lastIndexOf('/cgi-bin/'));
const src = (m) => require(ROOT + '/cgi-bin/src/' + m);
const cgi = src('cgi.js');

const SERVICE_NAME = 'neo-pkg-garmin-svc';

try {
    service.status(SERVICE_NAME, { timeout: 3000 }, function (err, info) {
        if (err) {
            const msg = err.message || String(err);
            if (/not\s*found|does not exist/i.test(msg)) {
                cgi.reply({ ok: true, data: { healthy: false, status: 'not_installed', pid: 0, exit_code: null, error: msg } }, 200);
            } else {
                cgi.reply({ ok: false, reason: msg }, 503);
            }
            return;
        }
        const status = String((info && info.status) || 'unknown').toLowerCase();
        cgi.reply({ ok: true, data: {
            healthy: status === 'running',
            status: status,
            pid: (info && info.pid) || 0,
            exit_code: info && info.exit_code != null ? info.exit_code : null,
            error: (info && info.error) || '',
        } }, 200);
    });
} catch (e) {
    cgi.reply({ ok: false, reason: e && e.message ? e.message : String(e) }, 500);
}
