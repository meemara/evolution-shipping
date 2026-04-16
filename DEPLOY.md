# Evolution Shipping Tracker — Deployment Guide

## Prerequisites

- A [Vercel](https://vercel.com) account (free tier works)
- A [GitHub](https://github.com) account
- Node.js 18+ installed on your machine

---

## Step 1: Push to GitHub

1. Create a new repository on GitHub (e.g., `evolution-shipping`)
2. From your local project folder, run:

```bash
git init
git add .
git commit -m "Initial commit - Evolution Shipping Tracker"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/evolution-shipping.git
git push -u origin main
```

## Step 2: Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to your `evolution-shipping` repository
3. Leave all settings as default (Vercel auto-detects Next.js)
4. Click **Deploy**
5. Wait for the build to complete (~1-2 minutes)

## Step 3: Add the Database

1. In your Vercel project dashboard, go to **Storage** tab
2. Click **Create Database** → Select **Postgres** (powered by Neon)
3. Choose the free tier, name it `evolution-shipping-db`
4. Click **Create**
5. Vercel automatically adds the `POSTGRES_URL` environment variable to your project

## Step 4: Initialize the Database

After the database is connected:

1. Visit your deployed site: `https://your-app.vercel.app`
2. You'll see a "Connection Error" message with a **Run Database Setup** link
3. Click it — this creates all tables and seeds Mark Meece + Josh Fontaine as admins
4. The page will reload and you're live

## Step 5: Add Employees

To add more employees who can use the tracker, make a quick API call:

```bash
curl -X POST https://your-app.vercel.app/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "First Last", "role": "viewer"}'
```

Roles:
- `admin` — can add new orders, edit all fields, delete orders (Mark and Josh)
- `viewer` — can view orders and update shipping status/notes

## Step 6: Custom Domain (Optional)

1. In Vercel project settings → **Domains**
2. Add your domain (e.g., `shipping.evolutionhometech.com`)
3. Follow Vercel's DNS instructions to point your domain

---

## Managing the App

**Adding employees:** Use the API call above, or add them directly in the Vercel Postgres console.

**Redeploying after code changes:** Push to GitHub and Vercel auto-deploys.

**Database access:** Go to Vercel dashboard → Storage → your database → **Data** tab to view/edit records directly.
