---
type: dashboard
tags: [dashboard]
---

# Papers dashboard

> Updates itself. Needs the **Dataview** plugin.

## To read
```dataview
TABLE authors, year, journal
FROM "Sources"
WHERE status = "to read"
SORT year DESC
```

## Reading
```dataview
TABLE authors, year
FROM "Sources"
WHERE status = "reading"
```

## Recently changed
```dataview
TABLE status, year
FROM "Sources"
SORT file.mtime DESC
LIMIT 10
```

## Papers by topic
```dataview
TABLE rows.file.link AS "Papers"
FROM "Sources"
FLATTEN topics AS topic
GROUP BY topic
```

## Topics
```dataview
LIST
FROM "Topics"
SORT file.name ASC
```

## My ideas
```dataview
LIST
FROM "Thoughts"
SORT file.mtime DESC
```
