'use strict';

/**
 * CGI 공통 헬퍼 (coin-collector 의 cgi.js 와 같은 규칙).
 *
 * JSON 응답에는 Content-Length 를 반드시 붙인다. 없으면 keep-alive 연결에서 브라우저가 다음 응답의 경계를
 * 잘못 잡아 "Unexpected non-whitespace character after JSON" 이 난다 (curl 은 요청마다 새 연결이라 안 보인다).
 */
const process = require('process');

function getEnv(name) {
    if (process.env && typeof process.env.get === 'function') return process.env.get(name);
    return process.env ? process.env[name] : undefined;
}

function method() { return String(getEnv('REQUEST_METHOD') || 'GET').toUpperCase(); }

/** UTF-8 바이트 길이. Content-Length 는 문자 수가 아니라 바이트 수다. */
function utf8Length(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

function reply(body, code) {
    const text = JSON.stringify(body);
    process.stdout.write('Content-Type: application/json\r\n');
    if (code) process.stdout.write('Status: ' + code + '\r\n');
    process.stdout.write('Content-Length: ' + utf8Length(text) + '\r\n');
    process.stdout.write('Cache-Control: no-store\r\n');
    process.stdout.write('\r\n');
    process.stdout.write(text);
}

function ok(data) { reply({ ok: true, data: data === undefined ? null : data }); }
function fail(reason, code) { reply({ ok: false, reason: String(reason) }, code); }

/** 요청 본문 JSON. 길이 없이 read() 하는 쪽이 검증된 방식이다 (coin-collector). */
function readBody() {
    try {
        const raw = process.stdin.read();
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}

/**
 * 요청한 사람이 neo 에 로그인했는지 확인한다. 로그인 이름 또는 null.
 *
 * public 패키지의 CGI 는 neo 로그인 없이도 실행된다 (8.7.1 실측). 그리고 CGI 에는 Authorization 헤더가 넘어오지 않는다
 * (넘어오는 것은 Cookie 와 본문 정도). 그래서 화면이 neo 의 로그인 토큰(localStorage 의 accessToken)을 본문 neo 에 넣어 보내고,
 * 여기서 neo 의 /web/api/check 로 검증한다 (neo-pkg-llm-chat 의 auth.js 와 같은 검증). 다른 사이트는 neo 의 localStorage 를 못 읽는다.
 */
function neoUser(body, neoUrl) {
    const t = body && typeof body.neo === 'string' ? body.neo : '';
    if (!t) return null;
    try {
        const http = require('@jsh/http');
        const req = http.NewRequest('GET', neoUrl + '/web/api/check');
        req.header.set('Authorization', 'Bearer ' + t);
        if (!http.NewClient().do(req).ok) return null;
    } catch (e) {
        return null;
    }
    // 검증을 통과한 토큰에서만 이름을 꺼낸다 (이름은 기록용 — 못 꺼내도 로그인은 맞다)
    try {
        const p = JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return (p && typeof p.sub === 'string' && p.sub) ? p.sub : 'user';
    } catch (e) {
        return 'user';
    }
}

module.exports = { method, reply, ok, fail, readBody, getEnv, utf8Length, neoUser };
