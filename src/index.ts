import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
  DB: D1Database
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_REDIRECT_URI: string
  JWT_SECRET: string 
}

interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  type: string;
  sport_type: string;
  start_date: string;
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

// --- HELPER FUNCTIONS ---

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay(); 
  const diff = date.getDate() - day + (day == 0 ? -6 : 1); 
  const monday = new Date(date.setDate(diff));
  const dd = String(monday.getDate()).padStart(2, '0');
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const yyyy = monday.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function mapSportType(type: string): string {
  if (!type) return "Other";
  const t = type.toLowerCase();
  const cycling = new Set(["ride", "virtualride", "ebikeride", "handcycle", "velomobile", "gravelride", "mountainbikeride"]);
  const walking = new Set(["walk", "hike"]);
  
  if (cycling.has(t)) return "Cycling";
  if (t === "run" || t === "virtualrun" || t === "trailrun") return "Running";
  if (t === "swim") return "Swimming";
  if (walking.has(t)) return "Walking";
  
  return type.charAt(0).toUpperCase() + type.slice(1);
}

async function refreshAccessToken(env: Bindings, refreshToken: string) {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  if (!response.ok) return null;
  return await response.json() as any;
}

// Core Sync Logic
async function syncAthlete(env: Bindings, user: any) {
  try {
    console.log(`Syncing: ${user.firstname}`);
    let accessToken = user.access_token;
    
    if (!user.refresh_token) {
        return; // Manual user
    }

    const now = Date.now() / 1000;
    if (!user.expires_at || user.expires_at < now + 300) {
      const newTokens = await refreshAccessToken(env, user.refresh_token);
      if (newTokens && newTokens.access_token) {
        accessToken = newTokens.access_token;
        await env.DB.prepare(`
          UPDATE users SET access_token = ?, refresh_token = ?, expires_at = ? WHERE athlete_id = ?
        `).bind(newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, user.athlete_id).run();
      } else {
        return; 
      }
    }

    const startTimestamp = Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000);
    
    let page = 1;
    let allActivities: StravaActivity[] = [];
    
    while (true) {
      const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${startTimestamp}&per_page=200&page=${page}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!response.ok) break; 

      const pageActivities = await response.json() as StravaActivity[];
      if (pageActivities.length === 0) break; 

      allActivities.push(...pageActivities);
      if (pageActivities.length < 200) break;
      page++;
    }

    if (allActivities.length === 0) return;

    const stmt = env.DB.prepare(`
      INSERT INTO activities (id, athlete_id, athlete_name, activity_name, type, distance_miles, start_date, week_commencing, strava_link, manual_entry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
      ON CONFLICT(id) DO UPDATE SET
      activity_name=excluded.activity_name,
      type=excluded.type,
      distance_miles=excluded.distance_miles,
      week_commencing=excluded.week_commencing
    `);

    const batch = [];
    const metersToMiles = 0.000621371;
    const excludedTypes = [
        "Workout", "Yoga", "WeightTraining", "Rowing", 
        "StandUpPaddling", "Surfing", "WaterSport", 
        "Kayaking", "Canoeing", "Windsurf"
    ];

    for (const act of allActivities) {
      const type = mapSportType(act.type || act.sport_type);
      if (excludedTypes.includes(type)) continue;

      const miles = (act.distance * metersToMiles).toFixed(2);
      const weekStart = getWeekStart(act.start_date);
      const name = `${user.firstname} ${user.lastname}`;
      const stravaLink = `https://www.strava.com/activities/${act.id}`;

      batch.push(stmt.bind(
        act.id.toString(),
        user.athlete_id,
        name,
        act.name,
        type,
        parseFloat(miles),
        act.start_date,
        weekStart,
        stravaLink
      ));
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        if (chunk.length > 0) await env.DB.batch(chunk);
    }
    console.log(`✅ Synced ${batch.length} activities for ${user.firstname}`);

  } catch (e) {
    console.error(`Error syncing user ${user.athlete_id}:`, e);
  }
}


// --- ROUTES ---

app.get('/auth/login', (c) => {
  const params = new URLSearchParams({
    client_id: c.env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: c.env.STRAVA_REDIRECT_URI,
    approval_prompt: 'force',
    scope: 'activity:read_all'
  })
  return c.redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`)
})

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Missing code', 400)

  const tokenResp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: c.env.STRAVA_CLIENT_ID,
      client_secret: c.env.STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code'
    })
  })
  
  if (!tokenResp.ok) return c.text('Failed to exchange token', 500);

  const data: any = await tokenResp.json();
  const athlete = data.athlete;

  await c.env.DB.prepare(`
    INSERT INTO users (athlete_id, firstname, lastname, refresh_token, access_token, expires_at, profile_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(athlete_id) DO UPDATE SET
    refresh_token=excluded.refresh_token,
    access_token=excluded.access_token,
    expires_at=excluded.expires_at
  `).bind(
    athlete.id.toString(),
    athlete.firstname,
    athlete.lastname,
    data.refresh_token,
    data.access_token,
    data.expires_at,
    JSON.stringify(athlete)
  ).run()

  setCookie(c, 'athlete_id', athlete.id.toString(), { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 7 })

  c.executionCtx.waitUntil(syncAthlete(c.env, {
      athlete_id: athlete.id.toString(),
      firstname: athlete.firstname,
      lastname: athlete.lastname,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at
  }));

  return c.redirect('/')
})

app.get('/api/stats', async (c) => {
  const athleteId = getCookie(c, 'athlete_id')
  if (!athleteId) return c.json({ error: 'Unauthorized' }, 401)

  const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE athlete_id = ?').bind(athleteId).first()
  if (!user) return c.json({ error: 'User not found' }, 401)

  const { results } = await c.env.DB.prepare('SELECT * FROM activities ORDER BY start_date DESC').all()

  const isOgAdmin = user.is_og_admin === 1;
  const isAdmin = isOgAdmin || (user.is_admin === 1);

  return c.json({
    user: {
      id: user.athlete_id,
      name: user.firstname,
      is_admin: isAdmin,
      is_og_admin: isOgAdmin
    },
    activities: results
  })
})

app.post('/api/manual-activity', async (c) => {
  const athleteId = getCookie(c, 'athlete_id')
  if (!athleteId) return c.json({ error: 'Unauthorized' }, 401)

  const user: any = await c.env.DB.prepare('SELECT is_admin, is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first()
  if (user?.is_admin !== 1 && user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const weekStart = getWeekStart(body.date)

  let targetAthleteId = null;
  const { results: allUsers } = await c.env.DB.prepare("SELECT athlete_id, firstname, lastname FROM users").all();
  
  const match = allUsers.find((u: any) => {
      const fullName = `${u.firstname} ${u.lastname}`;
      return fullName.trim() === body.athlete_name.trim();
  }) as any;

  if (match) {
    targetAthleteId = match.athlete_id;
  } else {
    targetAthleteId = `manual_${crypto.randomUUID()}`;
    const nameParts = body.athlete_name.split(' ');
    const first = nameParts[0];
    const last = nameParts.slice(1).join(' ') || '';

    await c.env.DB.prepare(`
        INSERT INTO users (athlete_id, firstname, lastname, is_admin, is_og_admin, last_fetch_time)
        VALUES (?, ?, ?, 0, 0, ?)
    `).bind(targetAthleteId, first, last, Date.now()).run();
  }

  await c.env.DB.prepare(`
    INSERT INTO activities (id, athlete_id, athlete_name, activity_name, type, distance_miles, start_date, week_commencing, manual_entry)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
  `).bind(
    crypto.randomUUID(), 
    targetAthleteId, 
    body.athlete_name, 
    body.activity_name,
    body.club,
    body.miles,
    body.date,
    weekStart
  ).run()

  return c.json({ success: true })
})

app.delete('/api/manual-activity', async (c) => {
  const athleteId = getCookie(c, 'athlete_id')
  if (!athleteId) return c.json({ error: 'Unauthorized' }, 401)

  const user: any = await c.env.DB.prepare('SELECT is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first()
  if (user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403)

  const { id } = await c.req.json()
  if (!id) return c.json({ error: 'Missing ID' }, 400)

  const activity: any = await c.env.DB.prepare('SELECT manual_entry FROM activities WHERE id = ?').bind(id).first()
  
  if (!activity) return c.json({ error: 'Activity not found' }, 404)
  if (activity.manual_entry !== 1) {
    return c.json({ error: 'Cannot delete automated Strava activities.' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id).run()

  return c.json({ success: true })
})

// --- ADMIN TOOLS ---

app.get('/api/force-sync', async (c) => {
    const athleteId = getCookie(c, 'athlete_id');
    if (!athleteId) return c.json({ error: 'Unauthorized' }, 401);
    
    const user: any = await c.env.DB.prepare('SELECT is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first();
    if (user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403);

    const { results: users } = await c.env.DB.prepare('SELECT * FROM users').all();
    
    c.executionCtx.waitUntil(Promise.all(users.map((u) => syncAthlete(c.env, u))));
    
    return c.json({ success: true, message: `Sync started for ${users.length} users.` });
})

app.get('/api/admin/debug-info', async (c) => {
    const athleteId = getCookie(c, 'athlete_id');
    if (!athleteId) return c.json({ error: 'Unauthorized' }, 401);
    
    const user: any = await c.env.DB.prepare('SELECT is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first();
    if (user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403);

    const lastActivity = await c.env.DB.prepare('SELECT MAX(last_fetch_time) as last_sync FROM users').first();
    const usersCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
    const activityCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM activities').first();
    const manualCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM activities WHERE manual_entry = 1').first();

    return c.json({
        status: "Active",
        last_sync: lastActivity?.last_sync || "Unknown",
        worker_location: c.req.raw.cf?.colo || "Unknown",
        database: {
            users: usersCount?.count,
            total_activities: activityCount?.count,
            manual_activities: manualCount?.count
        },
        environment: "Cloudflare Workers",
        timestamp: new Date().toISOString()
    });
})

// --- NEW: USER MANAGEMENT (OG ADMIN ONLY) ---

// 1. Get list of all users
app.get('/api/admin/users', async (c) => {
    const athleteId = getCookie(c, 'athlete_id');
    if (!athleteId) return c.json({ error: 'Unauthorized' }, 401);
    
    const user: any = await c.env.DB.prepare('SELECT is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first();
    if (user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403);

    const { results } = await c.env.DB.prepare('SELECT athlete_id, firstname, lastname, is_admin, is_og_admin, last_fetch_time FROM users ORDER BY firstname').all();
    return c.json({ users: results });
})

// 2. Delete a user (and their data)
app.delete('/api/user', async (c) => {
    const athleteId = getCookie(c, 'athlete_id')
    if (!athleteId) return c.json({ error: 'Unauthorized' }, 401)
  
    const user: any = await c.env.DB.prepare('SELECT is_og_admin FROM users WHERE athlete_id = ?').bind(athleteId).first()
    if (user?.is_og_admin !== 1) return c.json({ error: 'Forbidden' }, 403)
  
    const body = await c.req.json()
    const targetId = body.id; 
  
    if (!targetId) return c.json({ error: 'Missing Target ID' }, 400)
    if (targetId === user.athlete_id) return c.json({ error: 'Cannot delete yourself' }, 400);

    // 1. Delete ALL activities first (Foreign Key Fix)
    await c.env.DB.prepare('DELETE FROM activities WHERE athlete_id = ?').bind(targetId).run()
  
    // 2. Delete the user
    await c.env.DB.prepare('DELETE FROM users WHERE athlete_id = ?').bind(targetId).run()
  
    return c.json({ success: true })
})

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    console.log("Starting scheduled sync...");
    const { results: users } = await env.DB.prepare('SELECT * FROM users').all();
    if (users.length > 0) {
      const syncPromises = users.map((user) => syncAthlete(env, user));
      await Promise.all(syncPromises);
    }
    
    await env.DB.prepare(`
      DELETE FROM activities 
      WHERE type IN (
        'Workout', 'Yoga', 'WeightTraining', 'Rowing', 
        'StandUpPaddling', 'Surfing', 'WaterSport', 
        'Kayaking', 'Canoeing', 'Windsurf'
      )
    `).run();
    console.log("Scheduled sync and cleanup complete.");
  }
}