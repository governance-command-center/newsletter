# Platform Updates — Web Newsletter

A static site version of the monthly platform-updates newsletter. Two views:
- **By Platform** — full detail grouped by Lazada/Shopee/TikTok/Zalora, expandable cards with images, tables, bullets, source links
- **By Region (Email view)** — brief per-update summaries grouped by region, close to what goes in the email

No backend, no build step — just static files. Filter by platform/region and search across everything.

## Test it locally

Browsers block `fetch()` on `file://` URLs, so open it through a tiny local server rather than double-clicking `index.html`:

```
cd webapp
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

(No Python? `npx serve .` works the same way if you have Node.)

## Regenerate the data for a new month

From the project root (one level up from `webapp/`):

```
python3 extract_updates.py path/to/new_deck.pptx webapp/data/extracted.json webapp/images
```

This overwrites `webapp/data/extracted.json` and re-populates `webapp/images/`.
Refresh the browser — no other changes needed. `index.html`, `style.css`, and
`script.js` don't need to be touched month to month.

## Deploy

This is a plain static site, so both of these work with zero config:

**GitHub Pages**
1. Push the `webapp/` folder contents to a repo (or a `docs/` folder / `gh-pages` branch).
2. In repo Settings → Pages, point it at that folder/branch.

**Firebase Hosting**
```
npm install -g firebase-tools
firebase init hosting     # set "public directory" to this webapp/ folder
firebase deploy
```

## File structure

```
webapp/
  index.html        page shell + view toggle + search
  style.css          design system / layout
  script.js          loads data.json, renders both views, filtering & search
  data/
    extracted.json   this month's structured updates (regenerate monthly)
  images/            screenshots pulled from the source slides
```

## Notes

- Everything is client-side; there's nothing to keep running — once deployed,
  it's just files served as-is.
- If you want this **not** to be publicly guessable (Firebase/GitHub Pages URLs
  are public by default), consider Firebase Hosting with access restricted via
  Google Auth, or a private GitHub Pages repo (needs GitHub Enterprise) —
  happy to help set that up if the newsletter shouldn't be open to anyone with
  the link.
