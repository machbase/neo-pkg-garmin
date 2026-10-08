#!/usr/bin/env bash
# 앱스토어 설치용 아카이브를 만든다: dist/neo-pkg-garmin-<version>.tar.gz
#
# 앱스토어는 machbase-neo 의 /work/public/ 바로 아래 아카이브를 읽는다 (coin-collector pack.sh 와 같은 조건):
#   - 최상위 폴더가 정확히 하나이고 그 안에 package.json (이름·버전은 여기서 읽는다)
#   - 설치 위치는 /work/public/<package.json name>, 같은 이름·버전 아카이브가 둘이면 설치가 실패한다
#
# 아카이브에 든 것은 전부 풀린다 — 토큰·설정(cgi-bin/conf.d/*.json), 수집기 상태(data/*.json), 개발 도구·테스트는 넣지 않는다.
set -euo pipefail
cd "$(dirname "$0")"
NAME=$(sed -n 's/^ *"name": *"\([^"]*\)".*/\1/p' package.json | head -1)
VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
OUT="dist/${NAME}-${VERSION}.tar.gz"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$NAME" dist
rsync -a \
  --exclude '.git' --exclude 'dist' --exclude 'test' --exclude 'pack.sh' \
  --exclude 'cgi-bin/conf.d/*.json' --exclude 'data/*.json*' --exclude '*.log' \
  ./ "$STAGE/$NAME/"
tar -czf "$OUT" -C "$STAGE" "$NAME"
echo "$OUT"
tar -tzf "$OUT" | sed 's/^/  /'
