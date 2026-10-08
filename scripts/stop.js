'use strict';

// 수집 서비스를 멈춘다. 컨트롤러가 SIGKILL 로 죽이므로 종료 훅은 돌지 않는다 —
// 하루치 수집 도중이면 그 날은 다음 tick 에 다시 받는다.
const process = require('process');
const service = require('service');

const SERVICE_NAME = 'neo-pkg-garmin-svc';

service.status(SERVICE_NAME, function (missing, info) {
    const st = String((info && info.status) || '').toLowerCase();
    if (missing || (st !== 'running' && st !== 'starting')) { console.println('service not running:', SERVICE_NAME); return; }
    console.println('stopping service:', SERVICE_NAME);
    service.stop(SERVICE_NAME, function (err) {
        if (err) { console.println('ERROR:', err.message); process.exit(1); }
        console.println('service stopped.');
    });
});
