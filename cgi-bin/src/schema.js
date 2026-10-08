// 가민 앱 스키마. 여러 번 실행해도 안전하다 (이미 있으면 "exists" 로 넘어간다).
// scripts/install.js 와 수집기(service/collector.js)가 시작할 때 부른다.
const store = require("./store.js")

const STATEMENTS = [
  ["database GARMIN", "create database if not exists garmin"],
  // 심박(2분) · 스트레스(3분) · Body Battery(3분) · 일별 요약값 · 활동 스트림(1초) · 활동 요약을 한 태그 테이블에 담는다.
  // 지표마다 주기가 달라도 태그 테이블은 문제가 없다.
  ["GARMIN.SYS.METRIC", `create tag table garmin.sys.metric (
     name varchar(40) primary key,
     time datetime basetime,
     value double summarized
   ) metadata (
     source varchar(20), unit varchar(12), kind varchar(12)
   ) with rollup (min)`],
  // 활동 구간과 수면 단계
  ["GARMIN.SYS.SPAN", `create table garmin.sys.span (
     kind varchar(20), label varchar(40),
     begin_time datetime, end_time datetime,
     seconds double, detail varchar(300)
   )`],
  // 수집한 날 기록 (과거 받기 재개용)
  ["GARMIN.SYS.SYNC_LOG", `create table garmin.sys.sync_log (
     source varchar(20), day varchar(10),
     rows_loaded double, status varchar(20), at_time datetime
   )`],
]

/** 반환 : { created: [...], existed: [...], failed: [{ name, reason }] } */
function ensure() {
  const out = { created: [], existed: [], failed: [] }
  for (const [name, sql] of STATEMENTS) {
    const r = store.query(sql)
    if (r.ok) { out.created.push(name); continue }
    const reason = (r.json && r.json.reason) || r.text || ("HTTP " + r.status)
    if (/exist/i.test(reason)) out.existed.push(name)
    else out.failed.push({ name, reason })
  }
  return out
}

module.exports = { ensure }
