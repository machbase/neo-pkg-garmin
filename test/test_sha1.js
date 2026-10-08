// RFC 3174 / RFC 2202 표준 벡터로 구현을 검증한다. 계정이 없어도 확인 가능하다.
const { sha1, hmacSha1, toBytes, toHex, toB64 } = require(require("@jsh/fs").resolveAbsPath(String(require("@jsh/process").argv[1])).split("/").slice(0, -2).join("/") + "/cgi-bin/src/sha1.js")

let pass = 0, fail = 0
function eq(name, got, want) {
  if (got === want) { pass++; console.log("  OK   " + name) }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + got + "\n       want " + want) }
}

// SHA-1 (RFC 3174)
eq("sha1('abc')", toHex(sha1(toBytes("abc"))), "a9993e364706816aba3e25717850c26c9cd0d89d")
eq("sha1('')",    toHex(sha1(toBytes(""))),    "da39a3ee5e6b4b0d3255bfef95601890afd80709")
eq("sha1(56자)",  toHex(sha1(toBytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
                  "84983e441c3bd26ebaae4aa1f95129e5e54670f1")
// 블록 경계(64바이트 이상) 확인
eq("sha1('a'x1000)", toHex(sha1(toBytes("a".repeat(1000)))),
                  "291e9a6c66994949b57ba5e650361e98fc36b1ba")

// HMAC-SHA1 (RFC 2202)
eq("hmac case1", toHex(hmacSha1(new Uint8Array(20).fill(0x0b), toBytes("Hi There"))),
                 "b617318655057264e28bc0b6fb378c8ef146be00")
eq("hmac case2", toHex(hmacSha1(toBytes("Jefe"), toBytes("what do ya want for nothing?"))),
                 "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79")
eq("hmac 긴키",  toHex(hmacSha1(new Uint8Array(80).fill(0xaa), toBytes("Test Using Larger Than Block-Size Key - Hash Key First"))),
                 "aa4ae5e15272d00e95705637ce8a3b55ed402112")
// OAuth1 은 base64 로 넘긴다
eq("base64 출력", toB64(hmacSha1(toBytes("Jefe"), toBytes("what do ya want for nothing?"))),
                 "7/zfauXrL6LSdBbV8YTfnCWafHk=")

console.log("\n통과 " + pass + " / 실패 " + fail)
