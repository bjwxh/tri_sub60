# Sub-60 Sprint Triathlon Training

Progress tracker for a 50-week training block toward a sub-1-hour sprint
triathlon (375m swim / 22km bike / 5km run) on **2027-08-01**.

Live site: https://bjwxh.github.io/tri_sub60/

## Updating progress data

Each metric is its own CSV in `data/`, one row per test/measurement:

| File | Columns | Typical cadence |
|---|---|---|
| `data/bodyweight.csv` | `date,lbs,notes` | daily/weekly |
| `data/css.csv` | `date,seconds_per_100yd,notes` | every 6–8 weeks |
| `data/run5k.csv` | `date,seconds,notes` | every 6–8 weeks |
| `data/ftp.csv` | `date,watts,watts_per_kg,notes` | every 6–8 weeks |
| `data/vo2.csv` | `date,vo2max,notes` | whenever tested |

Append a row and push — the charts and gap-to-target numbers on the page
rebuild automatically from the CSV on load. `data/targets.json` holds the
target value/label/notes per metric; edit it if a target changes.

## Updating the training calendar

Drop a new `.ics` file into `calendar/` (each covering the next 2–4 weeks)
and add its filename to `calendar/manifest.json`'s `files` array. The
calendar view on the page loads every file listed there.

## Editing the site itself (app.js / style.css)

`index.html` loads these with a `?v=N` cache-busting query string
(`assets/style.css?v=2`, `assets/app.js?v=2`). GitHub Pages' CDN caches
files for a while, and iOS Safari (especially a "home screen" app icon)
caches even more aggressively with no easy hard-refresh. **Whenever you
edit `assets/app.js` or `assets/style.css`, bump the `?v=` number in
`index.html` so devices are forced to fetch the new file instead of a
stale cached one.** The CSV/JSON/ICS data fetches already use
`cache: "no-store"` in `app.js`, so progress data is always fresh
without needing this.

## Local preview

```
python3 -m http.server 8000
# open http://localhost:8000
```
