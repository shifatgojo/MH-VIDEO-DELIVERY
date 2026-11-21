# MH Video Delivery

Architecture: **GitHub Pages** (static frontend) → **Cloudflare Worker** (free; holds all secrets) → **Supabase** (DB + admin login) and **Google Drive** (video files).
Customers only ever talk to the Worker, which looks up a token and streams the video from Drive. The Drive folder stays private.

## 1. Supabase
1. Open your project → **SQL Editor** → paste `supabase/schema.sql` → Run. This creates `videos` and enables RLS with **no policies**, so the public cannot read or write the table at all (step 2 = RLS done).
2. **Authentication → Providers → Google**: enable it using your Google Client ID/Secret.
3. **Authentication → URL Configuration**: add your admin URL (`https://USER.github.io/REPO/admin.html`) to Redirect URLs.
4. **Settings → API Keys**: copy the *publishable* and *secret* keys.

## 2. Google Drive API
1. Google Cloud Console → enable **Google Drive API**. Create an **OAuth client (Web)**. Add redirect URIs: `https://developers.google.com/oauthplayground` and `https://qtcbsppuemuoyeobroup.supabase.co/auth/v1/callback`.
2. Create a **private** folder in Drive; its ID is the last part of the folder URL → `GOOGLE_DRIVE_FOLDER_ID`.
3. Get a refresh token (one time): open https://developers.google.com/oauthplayground → gear icon → tick *Use your own OAuth credentials* → enter your Client ID/Secret → authorize scope `https://www.googleapis.com/auth/drive` with the Drive-owning account → *Exchange authorization code* → copy the **refresh token** → `GOOGLE_REFRESH_TOKEN`. (If the OAuth app is in "Testing" mode the token expires in 7 days; click *Publish app* to avoid this.)

## 3. Deploy the backend (Cloudflare Worker, free)
```
cd api
npm i -g wrangler && wrangler login
wrangler secret put SUPABASE_PUBLISHABLE_KEY
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put GOOGLE_DRIVE_FOLDER_ID
wrangler secret put ADMIN_EMAILS      # e.g. you@gmail.com,other@gmail.com
wrangler secret put ALLOWED_ORIGIN    # https://USER.github.io  (no path, no trailing slash)
wrangler deploy
```
Note the URL it prints (`https://mh-video-api.<you>.workers.dev`).

## 4. Deploy the frontend (GitHub Pages)
Edit `js/config.js`: set `API` to your Worker URL and paste the **publishable** key (public by design). Push to GitHub (`.env` is git-ignored) → repo **Settings → Pages** → deploy from `main` / root.

## 5. How tokens work
Each upload gets a random token like `MH-7K4P-92QX` (crypto-random, no ambiguous characters, not sequential). The Worker only returns a video if the token exists and `status = 'active'`. There is no endpoint that lists videos publicly.

## 6. Upload the first video
Go to `/admin.html` → sign in with an email listed in `ADMIN_EMAILS` → enter a name, choose a file (mp4/webm/mov/mkv, max 2 GB) → Upload. The browser sends the file straight to Drive through a one-time upload session created by the Worker (so no secret reaches the browser and Worker size limits don't apply). Copy the token and send it to your customer.

## 7. Customer flow
Customer opens the site → **Find My Video** → enters the token → watches in the player or presses **Download**. Deactivating a video in admin blocks it immediately.

## Security notes
- Secrets exist only as Worker secrets. Frontend holds only the public URL + publishable key.
- Admin routes verify the Supabase login JWT server-side and check the email allowlist.
- Streaming goes through the Worker (Cloudflare free: 100k requests/day). For heavy traffic consider rate limiting (Cloudflare dashboard → Security → WAF rate limiting).
- Anyone holding a token can share the link; deactivate to revoke.
