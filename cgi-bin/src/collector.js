// 하루치 수집 로직. 수집기(service/collector.js)가 부른다.
const g = require("./garmin_auth.js")
const store = require("./store.js")
const auth = require("./token.js")
const days = require("./days.js")

// 일별 지표 : 하루에 한 행, 시각은 그날 현지 00:00 (neo 서버 시간대 — days.js).
const DAILY = { steps: true, resting_hr: true, sleep_minutes: true }

// 활동 상세에서 뽑을 항목. 키는 가민 metricDescriptor 의 key.
const STREAM_MAP = {
  directHeartRate: "act_hr",
  directSpeed: "act_speed",
  directRunCadence: "act_cadence",
  directElevation: "act_elevation",
  directPower: "act_power",
  directStrideLength: "act_stride",
}

/**
 * 활동 하나의 스트림(약 1초 간격)을 적재한다. fromMs~toMs 는 이 활동의 시간 창.
 * maxChartSize 를 작게 주면 가민이 표본을 줄여 보낸다 (2000 → 러닝 4,641개가 1,566개).
 * 반환: 적재 포인트 수. 상세를 받지 못하면 -1 (구간을 넣지 않는다). 적재에 실패하면 예외 — 그 날을 "받음" 으로 적지 않는다
 */
function collectStream(api, activityId, fromMs, toMs) {
  const d = api("/activity-service/activity/" + activityId + "/details?maxChartSize=100000&maxPolylineSize=0")
  if (!d) return -1
  if (!d.activityDetailMetrics) return 0

  const idx = {}          // 지표 -> 배열 위치
  let tsIdx = -1
  for (const m of (d.metricDescriptors || [])) {
    if (m.key === "directTimestamp") tsIdx = m.metricsIndex
    if (STREAM_MAP[m.key] !== undefined) idx[STREAM_MAP[m.key]] = m.metricsIndex
  }
  if (tsIdx < 0) return 0

  const rows = []
  for (const p of d.activityDetailMetrics) {
    const mt = p.metrics || []
    const ts = mt[tsIdx]
    if (!ts) continue
    for (const name of Object.keys(idx)) {
      const v = mt[idx[name]]
      if (v !== null && v !== undefined) rows.push({ name: name, time: ts, value: v })
    }
  }
  // 같은 지표·같은 시각이 이미 있으면 건너뛴다. 지우지 않으므로 롤업이 오염되지 않고,
  // 줄여 받은 활동을 다시 받으면 빈 시각만 채운다.
  const have = store.timesIn(Object.values(STREAM_MAP), fromMs, toMs)
  const fresh = rows.filter(r => !have[r.name + "|" + Math.round(r.time)])
  // 한 번에 너무 크면 나눠 보낸다
  let sent = 0
  for (let i = 0; i < fresh.length; i += 5000) {
    const w = store.writeMetric(fresh.slice(i, i + 5000))
    if (w.status !== 200) throw new Error("Could not store an activity stream in machbase-neo (HTTP " + w.status + ")")
    sent += w.loaded
  }
  return sent
}

/** 마지막으로 429 를 받은 시각 (없으면 0). service/collector.js 가 보고 과거 채우기를 멈춘다 */
const limits = { at: 0 }

/** 가민 API 호출기. 토큰을 쓸 수 없으면 예외. 마지막 HTTP 상태는 api.lastStatus */
function makeApi() {
  const t = auth.ensureToken()
  if (!t) {
    if (auth.lastStatus() === 429) limits.at = Date.now()
    throw new Error("Could not renew the Garmin sign-in (HTTP " + auth.lastStatus() + "). Sign in again if this continues.")
  }
  function api(path) {
    const rsp = g.call("GET", "https://connectapi.garmin.com" + path, {
      headers: { "User-Agent": g.OAUTH_UA, "Authorization": "Bearer " + t.access },
    })
    api.lastStatus = rsp.statusCode
    if (rsp.statusCode === 429) limits.at = Date.now()     // 가민이 막았다 — 수집기가 보고 멈춘다
    if (rsp.statusCode === 204) return null
    if (rsp.statusCode !== 200) { console.log("   API " + rsp.statusCode + " " + path.slice(0, 60)); return null }
    try { return rsp.json() } catch (e) { return null }
  }
  return api
}

// 활동 요약 태그 : 활동 목록 응답에 이미 들어 있는 값이라 추가 호출 없이 넣는다.
// 시각은 활동 시작. 추세(같은 속도에서 심박이 내려가는가)를 보는 데 쓴다.
// 페이스는 이동 시간(movingDuration) 기준 — 쉬거나 멈춘 시간을 뺀다.
const SUMMARY = {
  running: [
    ["run_pace", "s/km", (a) => a.movingDuration && a.distance ? a.movingDuration / (a.distance / 1000) : null],
    ["run_hr", "bpm", (a) => a.averageHR],
    ["run_vo2max", "ml/kg/min", (a) => a.vO2MaxValue],
  ],
  lap_swimming: [
    ["swim_pace", "s/100m", (a) => a.movingDuration && a.distance ? a.movingDuration / (a.distance / 100) : null],
    ["swim_hr", "bpm", (a) => a.averageHR],
    ["swim_swolf", "score", (a) => a.averageSwolf],
  ],
}
let summaryTagsReady = false

/** 활동 요약을 넣는다. 같은 (지표, 시각) 이 있으면 건너뛴다. 반환: 넣은 개수 */
function writeSummary(a) {
  const defs = SUMMARY[a.activityType && a.activityType.typeKey]
  if (!defs) return 0
  if (!summaryTagsReady) {
    for (const list of Object.values(SUMMARY)) for (const [name, unit] of list) store.ensureTag(name, "garmin", unit, "summary")
    summaryTagsReady = true
  }
  const b = days.activityStart(a)
  const have = store.timesIn(defs.map(d => d[0]), b, b)
  const rows = []
  for (const [name, , f] of defs) {
    const v = f(a)
    if (v !== null && v !== undefined && isFinite(v) && !have[name + "|" + b]) rows.push({ name: name, time: b, value: Math.round(v * 100) / 100 })
  }
  if (!rows.length) return 0
  const w = store.writeMetric(rows)
  return w.status === 200 ? rows.length : 0
}

/**
 * 활동 하나 : 스트림과 요약을 넣고 구간(span)을 돌려준다. 구간은 호출한 쪽이 넣는다.
 * 반환: { ok, points, span } — ok 가 false 면 상세를 받지 못한 것 (구간도 넣지 않는다)
 */
function collectActivity(api, a, day) {
  const b = days.activityStart(a)
  const secs = a.elapsedDuration || a.duration || 0
  const span = { kind: "activity", label: (a.activityType && a.activityType.typeKey) || "unknown",
                 begin: b, end: b + secs * 1000, seconds: a.duration || 0,
                 detail: "day=" + day + " id=" + a.activityId + " dist=" + Math.round(a.distance || 0) + "m cal=" + Math.round(a.calories || 0) }
  // 시간 창은 앞뒤로 여유를 둔다 (일시정지·기록 종료 지연)
  const n = collectStream(api, a.activityId, b - 60 * 1000, b + secs * 1000 + 10 * 60 * 1000)
  if (n >= 0) writeSummary(a)
  return { ok: n >= 0, points: Math.max(n, 0), span: span }
}

/**
 * 하루치를 수집해 적재한다.
 *   day   : "YYYY-MM-DD"
 *   force : true 면 이미 수집한 날도 다시 받는다 (어제·오늘 갱신용)
 * 반환 : 수집했으면 true, 받은 날이라 건너뛰면 false.
 * 토큰을 못 쓰거나, 가민이 401·429 로 막거나, 적재에 실패하면 예외 — 그 날은 "받음" 으로 적지 않아 다음에 다시 받는다.
 */
function run(day, opt) {
  opt = opt || {}
  // 받은 날은 DB 만 보고 건너뛴다 — 토큰도 가민도 건드리지 않는다
  if (!opt.force && store.isSynced("garmin", day)) return false
  const t0 = Date.now()
  const api = makeApi()

  const prof = api("/userprofile-service/socialProfile")
  const NAME = prof ? prof.displayName : null
  if (!NAME) {
    if (api.lastStatus === 401 || api.lastStatus === 403) throw new Error("Garmin rejected the sign-in (HTTP " + api.lastStatus + "). Sign in again.")
    throw new Error("Could not read the Garmin profile (HTTP " + api.lastStatus + ")")
  }
  console.log("수집:", day)
  // 같은 날을 다시 받을 때(오늘치 갱신) 이미 들어간 시각 이후만 넣는다.
  const seen = store.lastTimes(day + " 00:00:00", day + " 23:59:59")

  // 태그 메타 등록 (최초 1회만 의미 있음)
  store.ensureTag("hr", "garmin", "bpm", "wellness")
  store.ensureTag("stress", "garmin", "score", "wellness")
  store.ensureTag("body_battery", "garmin", "score", "wellness")
  store.ensureTag("steps", "garmin", "steps", "daily")
  store.ensureTag("resting_hr", "garmin", "bpm", "daily")
  store.ensureTag("sleep_minutes", "garmin", "min", "daily")
  // 활동 스트림 (1초 간격)
  store.ensureTag("act_hr", "garmin", "bpm", "activity")
  store.ensureTag("act_speed", "garmin", "mps", "activity")
  store.ensureTag("act_cadence", "garmin", "spm", "activity")
  store.ensureTag("act_elevation", "garmin", "m", "activity")
  store.ensureTag("act_power", "garmin", "watt", "activity")
  store.ensureTag("act_stride", "garmin", "cm", "activity")

  const rows = []

  // ── 종일 심박 (2분) ────────────────────────────────────────
  const hr = api("/wellness-service/wellness/dailyHeartRate/" + NAME + "?date=" + day)
  if (hr && hr.heartRateValues) {
    for (const [ts, v] of hr.heartRateValues) if (v !== null) rows.push({ name: "hr", time: ts, value: v })
    if (hr.restingHeartRate) rows.push({ name: "resting_hr", time: days.midnight(day), value: hr.restingHeartRate })
    console.log("  심박:", hr.heartRateValues.length, "표본")
  }

  // ── 스트레스 + Body Battery (한 응답에 함께 온다) ─────────
  const st = api("/wellness-service/wellness/dailyStress/" + day)
  if (st) {
    let ns = 0, nb = 0
    for (const [ts, v] of (st.stressValuesArray || [])) if (v !== null && v >= 0) { rows.push({ name: "stress", time: ts, value: v }); ns++ }
    for (const arr of (st.bodyBatteryValuesArray || [])) {
      // [시각, 상태, 값, ...]
      const ts = arr[0], v = arr[2]
      if (v !== null && v !== undefined) { rows.push({ name: "body_battery", time: ts, value: v }); nb++ }
    }
    console.log("  스트레스:", ns, "표본 / Body Battery:", nb, "표본")
  }

  // ── 걸음 (일별) ────────────────────────────────────────────
  const sp = api("/usersummary-service/stats/steps/daily/" + day + "/" + day)
  if (sp && sp[0] && sp[0].totalSteps !== null) {
    rows.push({ name: "steps", time: days.midnight(day), value: sp[0].totalSteps })
    console.log("  걸음:", sp[0].totalSteps)
  }

  // ── 수면 (구간 + 일별 합계) ────────────────────────────────
  const sl = api("/wellness-service/wellness/dailySleepData/" + NAME + "?date=" + day + "&nonSleepBufferMinutes=60")
  const spans = []
  if (sl && sl.dailySleepDTO) {
    const d = sl.dailySleepDTO
    if (d.sleepTimeSeconds) {
      rows.push({ name: "sleep_minutes", time: days.midnight(day), value: Math.round(d.sleepTimeSeconds / 60) })
    }
    const levelName = { 0: "deep", 1: "light", 2: "rem", 3: "awake" }
    for (const lv of (sl.sleepLevels || [])) {
      const b = Date.parse(lv.startGMT + "Z"), e = Date.parse(lv.endGMT + "Z")
      if (!b || !e) continue
      spans.push({ kind: "sleep", label: levelName[lv.activityLevel] || String(lv.activityLevel),
                   begin: b, end: e, seconds: (e - b) / 1000, detail: day })
    }
    console.log("  수면:", Math.round((d.sleepTimeSeconds || 0) / 60), "분 / 구간", spans.length, "개")
  }

  // ── 활동 (구간 + 스트림) ───────────────────────────────────
  // 그날 활동만 날짜로 찾는다 (최근 N건만 보면 과거 채우기가 오래된 활동을 못 받는다)
  const acts = api("/activitylist-service/activities/search/activities?startDate=" + day + "&endDate=" + day + "&start=0&limit=50")
  if (acts) {
    for (const a of acts) {
      if (!days.activityStart(a)) continue
      if (days.activityDay(a) !== day) continue   // 가민이 정한 현지 날짜
      // 활동 상세 : 약 1초 간격 다채널 스트림. 시계열 DB 가 가장 잘 하는 데이터다.
      const r = collectActivity(api, a, day)
      if (r.ok) spans.push(r.span)
      if (r.points) console.log("    스트림:", r.points, "포인트 (" + a.activityId + ")")
    }
    console.log("  활동:", spans.filter(s => s.kind === "activity").length, "건")
  }

  // ── 적재 ───────────────────────────────────────────────────
  // 일별 지표는 시각이 늘 그날 00:00 이라 시각으로 거르면 첫 값에서 굳는다.
  // 값이 달라졌을 때만 그날 행을 지우고 새 값을 넣는다. 지운 행은 롤업에 남으므로
  // 일별 지표는 롤업으로 묻지 않는다.
  const stored = store.dailyValues(Object.keys(DAILY), day + " 00:00:00", day + " 23:59:59")
  const fresh = []
  let updated = 0
  for (const r of rows) {
    if (DAILY[r.name]) {
      const old = stored[r.name] || []
      if (old.length === 1 && old[0] === r.value) continue
      if (old.length) { store.deleteDaily(r.name, day + " 00:00:00", day + " 23:59:59"); updated++ }
      fresh.push(r)
    } else if (!(seen[r.name] > 0) || r.time > seen[r.name]) {
      fresh.push(r)
    }
  }
  const w = store.writeMetric(fresh)
  if (w.status !== 200) throw new Error("Could not store data in machbase-neo (HTTP " + w.status + ")")
  store.clearSpans(day)
  const ns = store.writeSpan(spans)
  console.log("적재:", w.loaded, "포인트", (rows.length - fresh.length > 0 ? "(중복 " + (rows.length - fresh.length) + "건 제외)" : ""),
              (updated ? "(일별 갱신 " + updated + "건)" : ""), "/ 구간", ns, "건")
  // 가민이 도중에 429 로 막았으면 빠진 데이터가 있다. 받은 것은 넣어 두되 "받음" 으로 적지 않는다
  if (limits.at >= t0) throw new Error("Garmin limited requests (HTTP 429)")
  store.markSynced("garmin", day, w.loaded + ns, "ok")
  return true
}

module.exports = { run, limits }
