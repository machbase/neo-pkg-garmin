'use strict';

/**
 * pkg run install (앱스토어 Install · Update 가 부른다)
 *
 *   1) 테이블 생성 — GARMIN 데이터베이스, METRIC(태그, 분 롤업)·SPAN·SYNC_LOG. 이미 있으면 그대로 둔다.
 *      실패해도 수집기가 시작할 때 다시 해 본다.
 *   2) 수집 서비스 neo-pkg-garmin-svc 등록 (enable: true 라 등록과 동시에 시작된다).
 *      이미 있으면 아무것도 하지 않는다 — 시작은 start 스크립트의 몫이다.
 *
 * 가민 로그인은 여기서 하지 않는다. 앱 화면에서 한다. 로그인 전에는 수집기가 토큰을 기다린다.
 */
const fs = require('fs');
const path = require('path');
const process = require('process');
const service = require('service');

const SERVICE_NAME = 'neo-pkg-garmin-svc';
const PKG_DIR = path.dirname(path.dirname(path.resolve(process.argv[1])));

function println() {
    const args = Array.prototype.slice.call(arguments);
    if (console.println) console.println.apply(console, args);
    else console.log.apply(console, args);
}
const errText = (e) => (e && e.message ? e.message : String(e));

const REQUIRED = ['package.json', 'main.html', 'side.html', 'service/collector.js', 'cgi-bin/src/collector.js'];
const missing = REQUIRED.filter(function (f) { return !fs.existsSync(path.join(PKG_DIR, f)); });
if (missing.length > 0) {
    println('ERROR: incomplete package, missing:', missing.join(', '));
    process.exit(1);
}

// ── 1) 테이블 ──
try {
    const schema = require(path.join(PKG_DIR, 'cgi-bin', 'src', 'schema.js'));
    const r = schema.ensure();
    r.created.forEach(function (n) { println('ok:', n); });
    r.existed.forEach(function (n) { println('exists:', n); });
    r.failed.forEach(function (f) { println('WARN: create failed:', f.name, '-', f.reason); });
} catch (e) {
    println('WARN: tables not created:', errText(e));
    println('      The collector creates them when it starts.');
}

// ── 2) 서비스 ──
function done(err) {
    if (err) { println('ERROR:', errText(err)); process.exit(1); }
    println('neo-pkg-garmin installed at', PKG_DIR);
    println('  service   :', SERVICE_NAME, '(waits for a Garmin sign-in before collecting)');
    println('  app tab   : main.html');
    println('  side pane : side.html');
    process.exit(0);
}

// enable: true 로 install 하면 컨트롤러가 등록하면서 바로 띄운다. 여기서 start 를 또 부르면 수집기가 두 개 뜬다
// (docs/DEVELOPMENT.md "패키지와 App Store"). 이미 등록돼 있으면 시작하지 않는다 —
// 앱스토어 업데이트는 stop → 덮어쓰기 → install → start 순서라 겹친다.
service.status(SERVICE_NAME, function (statusErr, info) {
    if (!statusErr) {
        const st = String((info && info.status) || '').toLowerCase();
        println('service already installed:', SERVICE_NAME, st ? '(' + st + ')' : '');
        done(null);
        return;
    }
    service.install({
        name: SERVICE_NAME,
        enable: true,
        working_dir: PKG_DIR,
        executable: path.join(PKG_DIR, 'service', 'collector.js'),
    }, function (err) {
        if (err) { done(err); return; }
        println('service installed and started:', SERVICE_NAME);
        done(null);
    });
});
