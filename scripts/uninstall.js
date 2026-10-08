'use strict';

/**
 * pkg run uninstall
 *
 * 수집 서비스를 멈추고 등록을 지운다. **테이블(GARMIN.SYS.*)과 토큰은 남긴다** — 쌓은 건강 기록을 재설치 한 번에
 * 날리면 안 된다. 필요하면 직접 DROP 하고, 토큰은 cgi-bin/conf.d/token.json 을 지운다.
 */
const service = require('service');

const SERVICE_NAME = 'neo-pkg-garmin-svc';

service.status(SERVICE_NAME, function (missing) {
    if (missing) { console.println('neo-pkg-garmin uninstalled (no service). Tables were left intact.'); return; }
    service.stop(SERVICE_NAME, function (stopErr) {
        if (stopErr) console.println('WARN stop', SERVICE_NAME + ':', stopErr.message);
        service.uninstall(SERVICE_NAME, function (err) {
            if (err) console.println('WARN uninstall', SERVICE_NAME + ':', err.message);
            else console.println('service uninstalled:', SERVICE_NAME);
            console.println('neo-pkg-garmin uninstalled. Tables were left intact.');
        });
    });
});
