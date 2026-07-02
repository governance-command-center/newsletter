# Deploying Platform Updates (GitHub + Firebase Hosting)

This is a static site — `index.html`, `style.css`, `script.js` — with no backend.
Firebase Hosting serves static files directly, and GitHub Actions (wired up by the
Firebase CLI) redeploys automatically every time you push to `main`.

## 0. Prerequisites (one-time, on your machine)

- A GitHub account with permission to create repos.
- A Google account for Firebase (console.firebase.google.com).
- Node.js installed (needed for the Firebase CLI): https://nodejs.org
- Git installed.

## 1. Create the GitHub repo

1. On github.com, click **New repository** (e.g. `platform-updates`). Public or
   private both work — private is fine since Firebase Hosting will still make the
   *site* public, only the source code stays private.
2. On your machine, in this project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-org>/platform-updates.git
   git push -u origin main
   ```

## 2. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. `platform-updates`) → you can skip Google Analytics for this.
2. Install the CLI and log in:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

## 3. Connect Hosting to this folder

From inside this project folder:
```bash
firebase init hosting
```
Answer the prompts:
- **Use an existing project** → pick the Firebase project you just created.
- **What do you want to use as your public directory?** → `.` (this folder — the
  `firebase.json` already included in this project has the right config, so if
  it asks to overwrite, say **No**).
- **Configure as a single-page app?** → **No**.
- **Set up automatic builds and deploys with GitHub?** → **Yes**.
  - Authorize GitHub when prompted.
  - Pick the repo you pushed in step 1.
  - **Set up the workflow to run a build script before every deploy?** → **No**
    (there's nothing to build — it's plain HTML/CSS/JS).
  - **Set up automatic deployment to your site's live channel when a PR is
    merged?** → **Yes**, branch `main`.

This writes two files under `.github/workflows/` and a GitHub secret with a
deploy key — commit and push those:
```bash
git add .github firebase.json .firebaserc
git commit -m "Add Firebase Hosting + GitHub Actions deploy"
git push
```

That push (to `main`) will trigger the first automatic deploy. Check the
**Actions** tab on GitHub to watch it run.

## 4. Get your URL and share it

Once the workflow finishes, your site is live at:
```
https://<your-firebase-project-id>.web.app
```
(also shown in the Firebase console under **Hosting**). Share that link with
the team, and paste it into the tool's **Admin → Email digest → Digest base
URL** field so the "View full update" links in your email digests point to it.

## 5. Day-to-day updates

From now on: edit the files, then
```bash
git add .
git commit -m "Update slides"
git push
```
GitHub Actions redeploys automatically — no manual `firebase deploy` needed.

## Notes

- This site has **no backend and no database** — everything the admin panel
  imports/exports lives only in the browser tab's memory for that session.
  Anyone visiting the live URL sees the same seed data baked into `index.html`
  unless you edit that file and push a new version.
- If you'd rather skip GitHub Actions and deploy by hand at any time:
  ```bash
  firebase deploy --only hosting
  ```
