#!/usr/bin/env bash
# 시험 실행기 — 가민·neo 서버를 부르지 않는 시험을 jsh 로 돌린다.
#   test/run.sh                       -> test/test_*.js 모두
#   test/run.sh test/test_days.js     -> 하나만
#   TZ=America/New_York test/run.sh test/test_days.js   (시간대 시험)
#
# machbase-neo 는 NEO_BIN (없으면 PATH 의 machbase-neo).
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NEO="${NEO_BIN:-$(command -v machbase-neo || true)}"
[ -n "$NEO" ] && [ -x "$NEO" ] || { echo "machbase-neo 를 찾을 수 없습니다. NEO_BIN 을 지정하세요"; exit 1; }

cd "$DIR"
[ $# -gt 0 ] && LIST="$*" || LIST="$(ls test/test_*.js)"
rc=0
for t in $LIST; do
  echo "== $t"
  "$NEO" jsh "$t" || rc=1
done
exit $rc
