// SHA-1 + HMAC-SHA1 (순수 JS).
// @jsh/crypto 에 해시가 없어서 직접 구현한다. Garmin 인증의 OAuth1 서명에 필요하다.
// 입출력은 Uint8Array 로 통일한다. Buffer 는 인코딩 변환에만 쓴다.

function rotl(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0 }

function sha1(bytes) {
  const ml = bytes.length
  // 패딩: 0x80 + 0 채움 + 길이(비트, 8바이트 빅엔디안)
  const withPad = new Uint8Array((((ml + 8) >> 6) + 1) << 6)
  withPad.set(bytes)
  withPad[ml] = 0x80
  const bitLen = ml * 8
  const dv = new DataView(withPad.buffer)
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false)
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296), false)

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0
  const w = new Array(80)

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false)
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)

    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let j = 0; j < 80; j++) {
      let f, k
      if (j < 20)      { f = (b & c) | (~b & d);          k = 0x5A827999 }
      else if (j < 40) { f = b ^ c ^ d;                   k = 0x6ED9EBA1 }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else             { f = b ^ c ^ d;                   k = 0xCA62C1D6 }
      const t = (rotl(a, 5) + f + e + k + w[j]) >>> 0
      e = d; d = c; c = rotl(b, 30); b = a; a = t
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false)
  odv.setUint32(12, h3, false); odv.setUint32(16, h4, false)
  return out
}

function hmacSha1(keyBytes, msgBytes) {
  const B = 64
  let k = keyBytes
  if (k.length > B) k = sha1(k)
  const key = new Uint8Array(B)
  key.set(k)
  const ipad = new Uint8Array(B), opad = new Uint8Array(B)
  for (let i = 0; i < B; i++) { ipad[i] = key[i] ^ 0x36; opad[i] = key[i] ^ 0x5c }

  const inner = new Uint8Array(B + msgBytes.length)
  inner.set(ipad); inner.set(msgBytes, B)
  const innerHash = sha1(inner)

  const outer = new Uint8Array(B + 20)
  outer.set(opad); outer.set(innerHash, B)
  return sha1(outer)
}

const toBytes = (s) => new Uint8Array(Buffer.from(s, "utf8"))
const toHex   = (b) => Buffer.from(b).toString("hex")
const toB64   = (b) => Buffer.from(b).toString("base64")

module.exports = { sha1, hmacSha1, toBytes, toHex, toB64 }
