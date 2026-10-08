# 개발 메모

machbase-neo 8.7.1 에서 이 패키지를 만들며 확인한 것. 사용법은 [README](../README.ko.md), 이 문서는 구조와 함정이다.

## 구조

| 위치 | 하는 일 |
|---|---|
| `main.html` | 앱 탭 — 로그인 카드, 대시보드 목록, 기간 막대. 차트는 `/db/tql/public/neo-pkg-garmin/tql/<파일>.tql?…` 를 iframe 으로 연다 |
| `side.html` | 사이드 패널 — 수집 상태, Start / Stop |
| `cgi-bin/api/` | `signin` · `status` · `control` (모두 POST, neo 로그인 확인) · `health` (App Store 카드용, 열려 있음) |
| `cgi-bin/src/` | 모듈 — `garmin_auth` (로그인·OAuth 서명), `signin` (로그인 상태·잠금), `token` (저장·갱신), `collector` (하루치 수집), `store` (neo HTTP API 로 적재), `schema`, `days` (시간대), `paths`, `cgi`, `sha1` |
| `service/collector.js` | 상주 수집기. `scripts/install.js` 가 neo 서비스 `neo-pkg-garmin-svc` 로 등록한다 |
| `tql/` | 대시보드 12개 |
| `test/` | `test/run.sh` — 가민·DB 를 부르지 않는 시험 |
| `pack.sh` | 배포 아카이브 `dist/neo-pkg-garmin-<버전>.tar.gz` (토큰·상태 파일·시험은 빼고) |

수집기는 cgi-bin 밖에 둔다. cgi-bin 안의 `.js` 는 HTTP 요청마다 CGI 로 실행되므로, 거기 두면 요청 한 번에 수집기가 하나 더 뜬다.
`cgi-bin/src` 의 모듈도 주소로 부르면 실행되므로 불러올 때 아무 일도 하지 않게 둔다.

## 수집기

- **1시간마다** 어제와 오늘을 다시 받는다. 오늘은 쌓이는 중이고, 어제는 시계가 늦게 동기화하면 뒤늦게 채워진다. 이미 들어간 시각은 거른다
- **과거 채우기** — 수집기가 뜨거나 새로 로그인하면 2일 전부터 365일 전까지 훑는다. 받은 날은 `sync_log` 만 보고 건너뛰고(가민·토큰을 건드리지 않는다),
  안 받은 날은 하루 받고 15초 쉰다. 1년을 다 훑으면 그 뒤로는 1시간마다 어제·오늘만 본다
- **실패하면 멈춘다** — 토큰 갱신 실패, 가민 401·429, 적재 실패는 예외로 올라와 수집기가 1시간 쉰다. 그 날은 "받음" 으로 적지 않는다.
  도중에 429 를 받은 날도 마찬가지다. 실패를 "건너뜀" 과 같은 값으로 돌려주면 과거 채우기가 쉬지 않고 다음 날로 넘어가며 요청을 쏟아낸다
- 토큰이 없으면 1분마다 확인하며 기다린다. 상태는 `data/status.json` 에 쓰고 사이드 패널이 읽는다
- Start / Stop 은 neo 서비스 시작·중지다. 중지는 SIGKILL 이라 종료 훅이 돌지 않는다. 중지해도 서비스의 자동 시작 설정은 그대로여서
  neo 를 다시 시작하면 수집기가 다시 뜬다. 이미 돌고 있으면 start 를 다시 부르지 않는다 — 두 번 부르면 수집기가 둘 뜬다

## 로그인과 토큰

- 모바일 SSO 방식이다 : `GET /mobile/sso/en/sign-in` (쿠키) → `POST /mobile/api/login` (JSON) → `serviceTicketId` →
  OAuth1 (`/oauth-service/oauth/preauthorized`) → OAuth2 (`/oauth-service/oauth/exchange/user/2.0`).
  2단계 인증 계정은 `responseStatus.type == "MFA_REQUIRED"` → `/mobile/api/mfa/verifyCode`. 예전 웹 폼 방식(`/sso/signin`)은 "예기치 않은 오류" 만 돌려준다
- SSO 는 브라우저 User-Agent, OAuth 엔드포인트는 안드로이드 앱 User-Agent 여야 한다 (consumer key 와 짝). consumer key 는
  `thegarth.s3.amazonaws.com/oauth_consumer.json` 에서 읽는다 — 이 주소가 사라지면 로그인과 갱신이 멈춘다
- OAuth2 액세스 토큰은 하루 안팎이면 만료되고, OAuth1 토큰으로 다시 교환하면 비밀번호 없이 갱신된다. 그래서 저장하는 것은 토큰뿐이다
- 비밀번호는 저장하지 않고 응답·로그에도 내보내지 않는다. 인증 코드를 기다리는 동안은 가민 로그인 쿠키만 `signin-pending.json` 에 5분 둔다.
  실패 3번이면 15분, 가민이 429 로 막으면 2시간 로그인을 받지 않는다 — 반복 로그인은 계정 단위 차단을 부른다
- 패키지의 CGI 는 neo 로그인 없이 실행되고 `Authorization` 헤더도 넘어오지 않는다(넘어오는 것은 Cookie·본문 정도).
  그래서 화면이 neo 로그인 토큰(`localStorage.accessToken`)을 본문 `neo` 에 넣어 보내고, CGI 가 neo 의 `/web/api/check` 로 확인한다.
  다른 사이트는 neo 의 localStorage 를 읽을 수 없으므로 요청 위조도 막힌다

## 시간대

`cgi-bin/src/days.js` — 수집기와 DB 질의는 **neo 서버의 OS 시간대**, 차트 글자는 브라우저 시간대를 따른다.
DB 도 `to_date('YYYY-MM-DD HH24:MI:SS')` 를 서버 시간대로 읽는다. 일별 지표는 현지 자정에, 활동은 `startTimeGMT` 로 정확한 순간에 넣고,
활동의 날짜는 `startTimeLocal` 앞 10자(가민이 정한 현지 날짜)로 정한다. `test/test_days.js` 를 서울·뉴욕(서머타임)·UTC·애들레이드(+10:30)에서 돌린다.

neo 를 OS 와 다른 `TZ` 로 띄우면 시작하지 않는다 (`MACHCLI-ERR-483, Failed to verify auth signature`, 기존 데이터 폴더).
그래서 사용자와 다른 시간대의 서버(클라우드 등)에서는 날짜 경계가 어긋난다.

## JSH 함정

- `@jsh/http` 의 `NewRequest` 옵션 객체(headers·body)는 무시된다. 헤더는 `req.header.set()`, 본문은 `req.writeString()` 으로 넣는다.
  옵션으로 넘기면 content-length 0, User-Agent 는 `Go-http-client` 로 나간다
- `client.do(req)` 는 동기로 응답을 준다 (`statusCode` · `ok` · `headers` · `string()` · `json()`). 쿠키는 유지되지 않아 `Set-Cookie` 를 직접 모은다 (`garmin_auth.js` 의 `newJar`)
- `@jsh/crypto` 에 해시·HMAC 이 없고 전역 `crypto`·`fetch` 도 없다. OAuth1 서명용 SHA-1/HMAC 을 직접 구현했다 (`sha1.js`)
- 진입 스크립트에서 `require("./x.js")`·`require("../…")` 가 안 된다 (`Invalid module`). 진입점은 `argv[1]` 로 패키지 루트를 계산해 절대 경로로 부르고,
  절대 경로로 불린 모듈 안에서는 `./x.js` 가 된다. 직접 띄운 jsh 의 `argv[1]` 은 상대 경로라 `fs.resolveAbsPath` 로 바꾼다
- `@jsh/fs` 의 `stat` 은 없는 파일에 예외를 던진다. `readFile` 은 바이트 배열을 주므로 `Buffer.from(b).toString("utf8")` 로 바꾼다
- JSH 는 OS 환경변수를 물려받지 않는다. `-e NAME=VALUE` 는 `ps` 에 보이므로 비밀에는 쓰지 않는다
- 자기 neo 의 주소는 `/proc/share/ports.json` 에서 읽는다 (CGI · 서비스 안에서 보인다). 포트를 고정하면 다른 포트의 neo 에 설치했을 때 엉뚱한 서버에 쓴다

## 적재·질의 함정

- 태그 테이블은 같은 값을 다시 넣어도 그대로 쌓인다. 다시 받는 날은 지표별 `max(time)` 을 먼저 읽어 그 뒤만 넣는다.
  일별 지표는 시각이 늘 자정이라 값이 바뀌었을 때만 그 행을 지우고 다시 넣는다. 지운 행은 롤업에 남으므로 일별 지표는 롤업으로 묻지 않는다
- `from_unixtime(ms*1000000)` 은 INT32 오버플로가 난다 (`MACHCLI-ERR-2325`). 시각은 문자열 + `to_date` 로 넣는다
- 롤업 질의에는 `case when name=…` 을 못 쓴다 (`MACHCLI-ERR-2264`). `WITH ROLLUP (MIN)` 이면 `rollup('sec', …)` 이 없다 (`MACHCLI-ERR-2685`)
- **바인드 값이 든 스칼라 서브쿼리는 쓰지 않는다** — 같은 SQL 문장이면 첫 실행의 결과가 남아 인자를 바꿔도 화면이 안 바뀐다.
  04·09 는 `SCRIPT` + `$.db().query` 로 두 번 묻는다 (`SCRIPT` 는 ECMA5 만 된다)
- `union all` 뒤에 `order by` 를 바로 붙이면 `MACHCLI-ERR-2127`. `select * from ( … union all … ) order by …` 로 감싼다

## TQL 차트 함정

- `chartOption(...)` 의 인자는 객체 리터럴이어야 한다. 계산이 길면 `chartOption({ ...(function () { … return {…} })() })` 로 감싼다.
  객체 안의 JS 는 그대로 브라우저로 간다 (`column(n)` 은 배열, 시각은 epoch ms)
- URL 인자는 `param('from') ?? time('now-365d')` 로 바인드한다. 차트 JS 로 넘기려면 `MAPVALUE(n, param('x') ?? "")` 로 열을 붙여 `column(n)[0]` 으로 읽는다
- 차트 페이지는 `body` 가 100vh 인데 위 여백이 더해져 늘 스크롤이 생기고 아래가 잘린다. `main.html` 이 같은 출처의 iframe 에 CSS(`FIT_CSS`)를 넣어 틀에 맞춘다.
  범례는 아래(`bottom`)보다 제목 아래(`top`)에 두어야 틀 높이와 상관없이 보인다
- 차트를 서버에 두지 않고 미리 보려면 `POST /db/tql` 에 TQL 을 보낸다 — 자산 목록(JSON: `chartID` · `jsAssets` · `jsCodeAssets`)이 오므로 페이지를 조립해 연다
- 시계를 차지 않은 시간에는 기록이 없다. 02·03 은 30분 넘는 빈틈에서 선을 끊는다 (매끈한 선이 빈 곳에 가짜 곡선을 그린다)

## 패키지와 App Store

- App Store 는 **neo 를 실행한 폴더**의 `public/` 에서 아카이브를 찾아 거기에 푼다. 웹과 서비스는 `--file` 폴더를 보므로, 둘이 다르면
  카드는 "설치됨" 인데 화면은 404 이고 서비스도 등록되지 않는다 ([README](../README.ko.md#문제-해결))
- `service.install({ enable: true })` 는 등록과 동시에 시작한다. 여기서 `service.start` 를 또 부르면 수집기가 둘 뜬다.
  App Store 업데이트는 stop → 덮어쓰기 → install → start 순서이므로 install 은 이미 등록돼 있으면 아무것도 하지 않는다
- 업데이트해도 `cgi-bin/conf.d/` 의 토큰은 남는다. cgi-bin 아래 일반 파일은 HTTP 로 열리지 않는다

## 시험

```bash
NEO_BIN=/path/to/machbase-neo test/run.sh                          # 모두
TZ=America/New_York NEO_BIN=… test/run.sh test/test_days.js         # 시간대
```

`test_collector` (실패 경로·받은 날 건너뛰기), `test_signin` (잠금·429·MFA·비밀번호 미저장·로그아웃·만료), `test_days`, `test_sha1`.
모두 가짜 응답으로 돌고 가민·DB 를 부르지 않는다. `test_signin` 은 `cgi-bin/conf.d/token.json` 이 있으면 시작하지 않는다.

## 제품 제안 (machbase-neo)

- `@jsh/crypto` 에 해시(SHA-1/256)와 HMAC — 외부 API 연동의 절반이 서명을 요구한다
- TQL 차트 페이지가 틀을 꽉 채우는 옵션 (지금은 늘 스크롤)
- 바인드 값이 든 스칼라 서브쿼리의 결과 재사용 수정
- App Store 가 `--file` 폴더의 `public/` 을 보게
- 패키지 화면이 다른 패키지 탭을 열 수 있는 통로 (지금은 특정 패키지만 허용)
