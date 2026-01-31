# Strava Activity Tracker

A Cloudflare Worker application that tracks and aggregates Strava activities for a club or group of friends. It features a leaderboard, trophy system, manual activity entry, and Excel export, all built with **Hono**, **Cloudflare D1**, and **Tailwind CSS**.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Strava API](https://img.shields.io/badge/Strava-API-FC4C02?style=for-the-badge&logo=strava&logoColor=white)

## 🚀 Features

* **Automated Sync**: Periodically fetches activities from connected Strava accounts using Cloudflare Scheduled Events.
* **Club Leaderboard**: View stats by month, year, or sport (Cycling, Running, Swimming, Walking) - by default however the world is your oyster and anything that can be recorded in Strava can be mapped!
* **Trophy System**: Distinct trophy levels (Bronze, Silver, Gold, Platinum) based on annual mileage.
* **Admin Tools**: Manual activity entry (for non-Strava activities/users) and user management.
* **Dark Mode**: Fully supported via Tailwind CSS v4.
* **Export**: Download stats to Excel.

## 🛠️ Tech Stack

* **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
* **Framework**: [Hono](https://hono.dev/)
* **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
* **Frontend**: Static HTML served via Worker Assets

## 📋 Prerequisites

1.  **Node.js** (v18 or later)
2.  **Cloudflare Account** (with Workers and D1 enabled)
3.  **Strava Account** (to create an API Application - you will need screenshots to prove to Strava it meets there requirments otherwise it will only let you have one user - I have submitted this application and got approved with no push back so 🤞 you do as well)

## ⚙️ Setup Guide

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd strava-activity-tracker
npm install
```

### 2. Strava API Configuration
1. Go to your [Strava API Settings](https://www.strava.com/settings/api).
2. Create an application.
3. Set the **Authorization Callback Domain** to:
   * `localhost` (for local dev)
   * `your-worker-name.your-subdomain.workers.dev` (for production)
4. Note down your `Client ID` and `Client Secret`.

### 3. Database Setup (Cloudflare D1)
Create a new D1 database:

```bash
npx wrangler d1 create strava-db
```
Copy the `database_id` output by the command and paste it into your `wrangler.jsonc` file:

```bash
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "strava-db",
    "database_id": "YOUR_GENERATED_ID_HERE"
  }
]
```

### Initialise the Schema
You need to create the tables. Create a file named `schema.sql` in your root directory with the following content (derived from the codebase):

```sql
CREATE TABLE IF NOT EXISTS users (
  athlete_id TEXT PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  profile_json TEXT,
  is_admin BOOLEAN,
  is_og_admin BOOLEAN,
  last_fetch_time INTEGER
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  athlete_id TEXT,
  athlete_name TEXT,
  activity_name TEXT,
  type TEXT,
  distance_miles REAL,
  start_date TEXT,
  week_commencing TEXT,
  strava_link TEXT,
  manual_entry BOOLEAN,
  FOREIGN KEY (athlete_id) REFERENCES users(athlete_id)
);
```
Apply this schema to your remote database:

```Bash
npx wrangler d1 execute strava-db --remote --file=./schema.sql
```

(For local development, add `--local` instead of `--remote`)

### 4. Environment Secrets
Securely store your Strava credentials on Cloudflare:

```Bash
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REDIRECT_URI
npx wrangler secret put JWT_SECRET
```
* **STRAVA_REDIRECT_URI**: Should be `https://<your-worker>.workers.dev/auth/callback` (or `http://localhost:8787/auth/callback` for local dev via `.dev.vars`).
* **JWT_SECRET**: Any random string for security.

### 💻 Local Development
To run the project locally, you need a `.dev.vars` file in the root directory for your secrets:

```text
STRAVA_CLIENT_ID=your_id
STRAVA_CLIENT_SECRET=your_secret
STRAVA_REDIRECT_URI=http://localhost:8787/auth/callback
JWT_SECRET=local_secret
```

Start the development server:

```bash
npm run dev
```
This will start the Wrangler dev server on `http://localhost:8787`.

**Note**: Tailwind CSS needs to be watched separately if you are editing styles:

```bash
npm run watch:css
```

### 📦 Build and Deploy
This project uses a static assets build step for CSS before deploying the Worker.

1. **Build CSS**
The project uses Tailwind CSS v4. You must compile the CSS before deployment to ensure the `public/assets/styles.css` file is up to date.

```bash
npm run build
```
This runs `npm run build:css`, which invokes Tailwind to minify and output the CSS to the public folder.

2. **Deploy to Cloudflare**
Once the CSS is built, deploy the worker and assets:

```bash
npm run deploy
```
This command runs wrangler deploy `--minify`.

**One-liner for updates:**

```bash
npm run build && npm run deploy
```
### 📅 Scheduled Syncing
The `wrangler.jsonc` should be configured with a cron trigger to automatically sync activities. Ensure this is present in your config if you want automatic updates:

```Code snippet
"triggers": {
  "crons": ["0 */4 * * *"] 
}
```
(Example: Runs every 4 hours)
## Screenshots
Login
![Alt text](https://i.ibb.co/35Pk1kHc/Strava-Activity-Tracker-Login-Day-Night-Split.png "Login Page (Day/Night Mode)")
OG (AKA Superadmin) - Admin view
![Alt text](https://i.ibb.co/zh34mYRm/Strava-Activity-Tracker-OG-Admin.png "OG Admin view")
Admin view
![Alt text](https://i.ibb.co/sJmSv55F/Strava-Activity-Tracker-Admin.png "Admin view")
User view
![Alt text](https://i.ibb.co/b88hDVm/Strava-Activity-Tracker-User.png "User view)")
Leaderboard
![Alt text](https://i.ibb.co/0p2P7MvS/Strava-Activity-Tracker-Leaderboard.png "Leaderboard")