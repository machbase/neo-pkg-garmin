# Garmin Health (neo-pkg-garmin)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

A machbase-neo package that **collects your own Garmin Connect data — heart rate, stress, Body Battery, steps, sleep, and workouts with 1-second streams — into Machbase** and shows it as dashboards.

- Sign in once in the app. Collection then runs in the background every hour, and fills up to one year of past data right after you sign in.
- **12 TQL dashboards** — from one day of heart rate to a one-year calendar, running trends, and "same pace, lower heart rate" comparisons.
- Everything is stored in ordinary Machbase tables, so you can query it with SQL and TQL, or ask questions with the AI chat package (`neo-pkg-llm-chat`).

> **Unofficial.** This package is not affiliated with, endorsed by, or supported by Garmin. It uses the same sign-in and data interfaces as the Garmin Connect mobile app, which Garmin does not offer as a public API. Use it only with your own account, at your own risk — see [Disclaimer](#disclaimer).

![Similar run pairs — collector status in the side panel on the left, the package tab on the right](docs/images/similar-run-pairs.png)

## Requirements

- machbase-neo 8.7.1 or later
- Your own Garmin Connect account (email and password). Accounts with two-step verification work: enter the code Garmin sends you.
- The server must be able to connect over HTTPS to `sso.garmin.com`, `connectapi.garmin.com`, and `thegarth.s3.amazonaws.com` (the public client key used by Garmin Connect mobile clients is read from there).
- The operating system of the machbase-neo server should use **the same time zone as your Garmin account**. Days are counted in the server's time zone; charts show times in the browser's time zone.
- Disk space is small: one person's watch produces about 1.5 million records per year.

## Installation

1. Download a ZIP file from this repository using **Code → Download ZIP**.
2. Place the downloaded file **without extracting it** in the `public/` directory under your machbase-neo installation directory.

   ```text
   <machbase-neo installation directory>/
   ├── machbase-neo
   └── public/
       └── neo-pkg-garmin-main.zip   ← place it here
   ```

3. Open the **App Store** in the machbase-neo web UI, refresh the list, and click **Install** for `neo-pkg-garmin`.
4. The collection service starts as soon as installation finishes and waits until you sign in. Use **Start / Stop** in the side panel (or the switch on the App Store card) to turn it on or off.

The App Store looks for archives in the `public/` directory of **the directory machbase-neo was started from**. If you started machbase-neo with `--file` pointing to another directory, see [Troubleshooting](#troubleshooting).

### Updating

Place the new archive in `public/` and click **Update** in the App Store. Your sign-in and the collected data are preserved.
Installation fails if `public/` contains two archives with the same package name and version, so remove the old one.

### Uninstalling

Click **Sign out** in the app first if you want the Garmin token deleted. Then click **Uninstall** in the App Store to stop the collection service and remove its registration.
**Collected data remains** in the `GARMIN` database. If you no longer need it, drop it with SQL:

```sql
DROP TABLE GARMIN.SYS.METRIC CASCADE;
DROP TABLE GARMIN.SYS.SPAN;
DROP TABLE GARMIN.SYS.SYNC_LOG;
DROP DATABASE GARMIN;
```

## Using the app

Open the **App Store**, click `neo-pkg-garmin`, and the package tab opens. The side panel shows collection status.

### Sign in

- Enter your Garmin email and password, then the verification code if Garmin asks for one (enter it within 5 minutes).
- **Your password is never stored.** It is sent over HTTPS only to Garmin's sign-in server. What remains is the token Garmin returns, saved in a file with owner-only permissions (on Linux and macOS).
- With the token, collection keeps working without signing in again — access is renewed automatically. You need to sign in again only after **Sign out**, after changing your Garmin password, or if Garmin revokes the token.
- To protect your account, the app pauses sign-in for 15 minutes after three failed attempts, and for 2 hours when Garmin limits sign-ins (HTTP 429). Repeated sign-ins can get an account limited by Garmin.
- Each machbase-neo server keeps **one** Garmin sign-in. Everyone who uses that server sees the same data.

### Collection (automatic)

- **Every hour**: yesterday and today. Yesterday is read again so that data from a late watch sync is not missed; records already stored are skipped.
- **Right after sign-in**: past days, one day every 15 seconds, up to one year back (about two hours for a full year).
- If Garmin limits requests (HTTP 429), collection pauses for an hour and then resumes.
- New data appears after your watch syncs with Garmin Connect (the phone app).
- How far back Garmin returns data: steps and workouts for a year or more; 2–3-minute heart rate, stress, and Body Battery for about the last five months.

### Start / Stop

The **Start / Stop** button in the side panel turns collection on and off (the same as the switch on the App Store card).

- **Stop** ends the collector right away, so no more requests go to Garmin. Your sign-in, the collected data, and the dashboards stay. A day that was being collected is collected again from the start next time.
- **Start** collects yesterday and today first, fills any days missed while stopped, and then collects every hour.
- Stop is a **pause**: when machbase-neo restarts, the collector starts again. To stop for good, **Sign out** (deletes the token) or **Uninstall**.

### Dashboards

Choose a dashboard from the list on the left — grouped by sport; the app opens on **Running trend**. The bar at the top sets the period: **7 days, 30 days, 90 days, 1 year**, or any date range.

| Dashboard | What it shows |
|---|---|
| **Running** | |
| Running trend | Monthly average pace (moving time) and heart rate |
| VO2max | Garmin's VO2max estimate for each run |
| Similar run pairs | Pairs of an earlier and a later run with distance within ±10% and pace within ±10 s/km. Arrows go from the earlier run to the later run |
| **Swimming** | |
| Swimming trend | Monthly average pace per 100 m and heart rate |
| **All workouts** | |
| Activities per month | Workouts per month by type (swim, run, other) |
| One-year calendar | One cell per day (gray = steps), dots for workouts. Each column is a week, Monday to Sunday from top to bottom |
| **More** | |
| Then and now | Heart rate of two runs, overlaid by moving time. Choose the first run on or after one date and the last run on or before another |
| Pace vs heart rate | One dot per outdoor run. A "same-pace band" compares the average heart rate of earlier and later runs at similar pace (checkbox to hide) |
| Run detail (1-sec) | Heart rate of one run from 1-second samples. Choose "last run on or before" a date; zoom with the slider |
| Daily steps · resting HR | Steps per day (bars) and resting heart rate (line) |
| Heart rate (one day) | One day of heart rate, 10-minute averages. Choose the day |
| Stress · Body Battery | Stress and Body Battery for one day |

### Side panel

Collection state (waiting for sign-in, filling past data, collecting every hour, paused by Garmin, stopped), whether you are signed in, the service state, the last and next collection times, and the last error. The **Start / Stop** button turns collection on and off; your sign-in and data stay.

## Asking questions with AI

Install **`neo-pkg-llm-chat`** from the App Store and open it in another tab. It runs SQL on this data for you.

- Name the table in capitals (`GARMIN.SYS.METRIC`, `GARMIN.SYS.SPAN`) and the tag (`run_vo2max`, `resting_hr`, …), and ask for a value, a count, or a chart.
- In llm-chat 3.3.1, questions containing words such as "how to", "what is", "explain", "vs", or "compared to" are treated as documentation questions and answered **without running SQL**.
- Check important numbers against the dashboards — answers can contain wrong supporting numbers even when the conclusion is right.

Example: *Draw a chart of the VO2max trend from GARMIN.SYS.METRIC run_vo2max for the last 12 months.*

## Stored data

| Table | Type | Contents |
|---|---|---|
| `GARMIN.SYS.METRIC` | TAG (minute rollup) | `NAME`, `TIME`, `VALUE`, with metadata `SOURCE`, `UNIT`, `KIND` |
| `GARMIN.SYS.SPAN` | LOG | Workouts and sleep stages: `KIND` (`activity`, `sleep`), `LABEL` (`running`, `lap_swimming`, …), `BEGIN_TIME`, `END_TIME`, `SECONDS`, `DETAIL` (day, activity id, distance in m, calories) |
| `GARMIN.SYS.SYNC_LOG` | LOG | Days collected (`DAY`, `ROWS_LOADED`, `STATUS`, `AT_TIME`) |

Tags in `GARMIN.SYS.METRIC`:

| Tags | Unit | Interval |
|---|---|---|
| `hr` · `stress` · `body_battery` | bpm · score · score | about 2–3 minutes while the watch is worn |
| `steps` · `resting_hr` · `sleep_minutes` | steps · bpm · min | daily, stamped at local midnight |
| `act_hr` · `act_speed` · `act_cadence` · `act_elevation` · `act_power` · `act_stride` | bpm · m/s · spm · m · W · cm | about 1 second during workouts |
| `run_pace` · `run_hr` · `run_vo2max` | s/km · bpm · ml/kg/min | one value per run, at its start time |
| `swim_pace` · `swim_hr` · `swim_swolf` | s/100 m · bpm · score | one value per pool swim, at its start time |

```sql
-- Resting heart rate by month
SELECT TO_CHAR(TIME, 'YYYY-MM') AS M, ROUND(AVG(VALUE), 1) AS RESTING_HR
  FROM GARMIN.SYS.METRIC WHERE NAME = 'resting_hr' AND TIME >= NOW - 365d GROUP BY M ORDER BY M;

-- Hourly heart rate for the past day (rollup — no raw-data scan)
SELECT ROLLUP('hour', 1, TIME) AS H, ROUND(AVG(VALUE), 0) AS HR
  FROM GARMIN.SYS.METRIC WHERE NAME = 'hr' AND TIME >= NOW - 1d GROUP BY H ORDER BY H;

-- Pace (seconds per km) and average heart rate of each run in the last 90 days
SELECT TIME, MAX(CASE WHEN NAME = 'run_pace' THEN VALUE END) AS PACE_SEC_PER_KM,
       MAX(CASE WHEN NAME = 'run_hr' THEN VALUE END) AS AVG_HR
  FROM GARMIN.SYS.METRIC WHERE NAME IN ('run_pace', 'run_hr') AND TIME >= NOW - 90d GROUP BY TIME ORDER BY TIME;

-- Workouts by type over the past year
SELECT LABEL, COUNT(*) AS N FROM GARMIN.SYS.SPAN
  WHERE KIND = 'activity' AND BEGIN_TIME >= NOW - 365d GROUP BY LABEL ORDER BY N DESC;
```

## Configuration files

The files reside in `<machbase-neo installation directory>/public/neo-pkg-garmin/cgi-bin/conf.d/` and are preserved during updates. You do not need to edit them.

| File | Contents |
|---|---|
| `token.json` | The Garmin token created when you sign in, with owner-only permissions. **Treat it like a password.** Sign out deletes it. |
| `signin-guard.json` | Sign-in pause after failed attempts or when Garmin limits sign-ins |
| `signin-pending.json` | Waiting for a verification code (expires after 5 minutes) |
| `neo.json` | Only needed to store data in another machbase-neo: `{ "url": "http://<host>:<port>" }`. If absent, data is stored on this server. |

The collector writes its status to `public/neo-pkg-garmin/data/status.json`; the side panel reads it.

## Troubleshooting

- **"Garmin is limiting sign-ins for now."** Garmin answered HTTP 429 to the sign-in. Wait until the time shown and try once more. Collection with an existing token is not affected. Do not run two collectors (two servers) with the same Garmin account at the same time.
- **Signed in, but no data.** The first collection starts within a minute — check the side panel. Data exists only for times the watch was worn and appears after the watch syncs with Garmin Connect.
- **The App Store says "installed", but the package tab is empty or shows 404.** machbase-neo was started from a directory other than its `--file` directory. Start machbase-neo from the `--file` directory, or make `public` in the start directory a link to `<--file directory>/public`, then install again.
- **Days are off by several hours.** The server's time zone differs from your Garmin time zone. Run machbase-neo on a machine set to your time zone — starting machbase-neo 8.7.1 with a different `TZ` environment variable fails.

## Requests from Garmin

This package exists so that people can keep their own health data in their own database. If Garmin asks us to change or stop it, we will act promptly. Please contact us through this repository's **Issues**.

## Disclaimer

Garmin and Garmin Connect are trademarks of Garmin Ltd. or its subsidiaries. This package is an independent, unofficial tool and is not affiliated with, endorsed by, sponsored by, or approved by Garmin.

- **Your own account and your own data only.** Sign in with your own Garmin account to copy your own data into your own machbase-neo server. Do not use it with anyone else's account or data.
- **Unofficial interfaces.** Garmin does not offer these interfaces publicly; they may change or be blocked at any time, and collection then stops. **Using this package may violate Garmin's terms of use and may lead to restrictions on your account. You use it at your own risk.**
- **Where your credentials go.** Your email, password, and verification code are sent over HTTPS to Garmin's sign-in service only — never to this project or to machbase.
- **Requests are kept low**: once an hour, past data slowly, and a pause whenever Garmin answers HTTP 429.
- The software is provided "as is", without warranty of any kind.

Development and architecture notes are available in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (Korean). Tests are in `test/` — run one with `machbase-neo jsh test/test_collector.js` from the repository root (any OS).
