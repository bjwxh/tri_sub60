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

## Local preview

```
python3 -m http.server 8000
# open http://localhost:8000
```
