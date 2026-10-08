// 적재 : neo 의 HTTP write API 로 태그·구간 데이터를 넣는다.
// (@jsh/db 는 dsn 설정이 따로 필요해서, 같은 프로세스 안에서도 HTTP 가 단순하다)
const http = require("@jsh/http")
const client = http.NewClient()
const NEO = require("./paths.js").neoUrl()   // 이 neo 자신 (paths.js)
const days = require("./days.js")

function post(path, body, contentType) {
  const req = http.NewRequest("POST", NEO + path)
  req.header.set("Content-Type", contentType)
  req.writeString(body)
  const rsp = client.do(req)
  return { status: rsp.statusCode, text: rsp.string() }
}

function query(sql) {
  const req = http.NewRequest("GET", NEO + "/db/query?q=" + encodeURIComponent(sql))
  const rsp = client.do(req)
  let j = null
  try { j = rsp.json() } catch (e) { /* 무시 */ }
  return { status: rsp.statusCode, ok: !!(j && j.success), json: j, text: rsp.string() }
}

// 태그 메타(name, source, unit, kind)를 먼저 등록한다. 이미 있으면 조용히 넘어간다.
function ensureTag(name, source, unit, kind) {
  query("insert into garmin.sys.metric metadata (name, source, unit, kind) values ('" +
        name + "','" + source + "','" + unit + "','" + kind + "')")
}

/**
 * rows : [{ name, time(ms), value }]
 * CSV 로 한 번에 넣는다. 태그 테이블은 METADATA 컬럼이 있으므로 header=columns 가 필수다.
 */
function writeMetric(rows) {
  if (!rows.length) return { status: 200, loaded: 0 }
  const lines = ["NAME,TIME,VALUE"]
  for (const r of rows) lines.push(r.name + "," + r.time + "," + r.value)
  const r = post("/db/write/garmin.sys.metric?header=columns&timeformat=ms",
                 lines.join("\n") + "\n", "text/csv")
  return { status: r.status, loaded: rows.length, text: r.text }
}

/** spans : [{ kind, label, begin(ms), end(ms), seconds, detail }]
 *  시각은 서버 시간대의 문자열 + to_date 로 넣는다 (days.text — DB 도 같은 시간대로 읽는다).
 *  from_unixtime(ms*1000000) 은 INT32 오버플로가 난다 (MACHCLI-ERR-2325). */
function writeSpan(spans) {
  let n = 0
  for (const s of spans) {
    const sql = "insert into garmin.sys.span values('" + s.kind + "','" + s.label + "'," +
      "to_date('" + days.text(s.begin) + "','YYYY-MM-DD HH24:MI:SS')," +
      "to_date('" + days.text(s.end) + "','YYYY-MM-DD HH24:MI:SS')," +
      Math.round(s.seconds || 0) + ",'" + String(s.detail || "").replace(/'/g, "") + "')"
    const r = query(sql)
    if (r.ok) n++
    else if (!writeSpan._warned) { writeSpan._warned = true; console.log("   구간 적재 실패:", (r.json && r.json.reason) || "") }
  }
  return n
}

function markSynced(source, day, rows, status) {
  query("insert into garmin.sys.sync_log values('" + source + "','" + day + "'," +
        rows + ",'" + status + "', now)")
}

function isSynced(source, day) {
  const r = query("select count(*) from garmin.sys.sync_log where source='" + source +
                  "' and day='" + day + "' and status='ok'")
  try { return r.json.data.rows[0][0] > 0 } catch (e) { return false }
}

/**
 * 이미 받은 시각까지의 최댓값을 지표별로 돌려준다.
 * 같은 날을 다시 수집할 때(오늘치 갱신) 중복 적재를 막는 데 쓴다.
 * 태그 테이블은 같은 값을 다시 넣어도 거르지 않고 그대로 쌓인다.
 */
function lastTimes(dayStart, dayEnd) {
  const r = query("select name, max(time) from garmin.sys.metric where time between " +
    "to_date('" + dayStart + "','YYYY-MM-DD HH24:MI:SS') and to_date('" + dayEnd + "','YYYY-MM-DD HH24:MI:SS') group by name")
  const out = {}
  try {
    for (const row of r.json.data.rows) out[row[0]] = Number(row[1]) / 1000000   // ns -> ms
  } catch (e) { /* 비어 있으면 그대로 */ }
  return out
}

/**
 * 일별 지표(시각이 늘 그날 00:00)의 저장된 값을 지표별 배열로 돌려준다.
 * 하루 동안 값이 바뀌므로 lastTimes 로는 거를 수 없다.
 */
function dailyValues(names, dayStart, dayEnd) {
  const r = query("select name, value from garmin.sys.metric where name in ('" + names.join("','") + "')" +
    " and time >= to_date('" + dayStart + "','YYYY-MM-DD HH24:MI:SS') and time <= to_date('" + dayEnd + "','YYYY-MM-DD HH24:MI:SS')")
  const out = {}
  try {
    for (const row of r.json.data.rows) (out[row[0]] = out[row[0]] || []).push(Number(row[1]))
  } catch (e) { /* 비어 있으면 그대로 */ }
  return out
}

/** 일별 지표 하나의 그날 행을 지운다. 지운 행은 롤업에 남는다 (docs/DEVELOPMENT.md). */
function deleteDaily(name, dayStart, dayEnd) {
  return query("delete from garmin.sys.metric where name = '" + name + "'" +
    " and time >= to_date('" + dayStart + "','YYYY-MM-DD HH24:MI:SS') and time <= to_date('" + dayEnd + "','YYYY-MM-DD HH24:MI:SS')")
}

/**
 * fromMs~toMs 에 이미 있는 (지표, 시각) 을 돌려준다. 키는 "name|ms".
 * 활동 스트림을 다시 받을 때 빈 시각만 넣는 데 쓴다.
 */
function timesIn(names, fromMs, toMs) {
  const r = query("select name, time from garmin.sys.metric where name in ('" + names.join("','") + "')" +
    " and time between to_date('" + days.text(fromMs) + "','YYYY-MM-DD HH24:MI:SS') and to_date('" + days.text(toMs) + "','YYYY-MM-DD HH24:MI:SS')")
  const out = {}
  try {
    for (const row of r.json.data.rows) out[row[0] + "|" + Math.round(Number(row[1]) / 1000000)] = true   // ns -> ms
  } catch (e) { /* 비어 있으면 그대로 */ }
  return out
}

/** 구간(span)은 다시 넣기 전에 그 날 것을 지운다. detail 에 날짜가 들어 있어야 한다. */
function clearSpans(day) {
  query("delete from garmin.sys.span where detail like '%" + day + "%'")
}

module.exports = { query, writeMetric, writeSpan, ensureTag, markSynced, isSynced, post, lastTimes, clearSpans, dailyValues, deleteDaily, timesIn }
