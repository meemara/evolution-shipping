# Azure App Registration — Shipping Tracker Auto-Sync

**Purpose:** Create a service account that lets the shipping tracker automatically read emails from `shipping@evolutionava.com` without any user login. This powers the cron job that syncs new shipping emails into the tracker every 4 hours.

**Time required:** ~10 minutes

---

## Step 1: Create the App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for **App registrations** in the top search bar → click it
3. Click **+ New registration**
4. Fill in:
   - **Name:** `Evolution Shipping Tracker`
   - **Supported account types:** Select **Accounts in this organizational directory only**
   - **Redirect URI:** Leave blank
5. Click **Register**
6. On the overview page, copy these two values — you'll need them later:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Step 2: Create a Client Secret

1. In the left sidebar, click **Certificates & secrets**
2. Click **+ New client secret**
3. Description: `shipping-tracker-secret`
4. Expires: **24 months**
5. Click **Add**
6. **IMMEDIATELY copy the Value** (not the Secret ID) — you won't be able to see it again

## Step 3: Add API Permissions

1. In the left sidebar, click **API permissions**
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Application permissions** (NOT delegated)
5. Search for and add:
   - `Mail.Read` — lets the app read mail in all mailboxes (we'll scope it down in Step 4)
6. Click **Add permissions**
7. Click **Grant admin consent for Evolution** (the green checkmark button at the top)
8. Confirm — all permissions should now show green checkmarks

## Step 4: Scope to Shipping Mailbox Only (Recommended)

By default, Mail.Read gives access to ALL mailboxes. To restrict it to only `shipping@evolutionava.com`:

1. Open **Exchange Admin Center**: [admin.exchange.microsoft.com](https://admin.exchange.microsoft.com)
2. Open **PowerShell** (or use Exchange Online PowerShell)
3. You'll need to run these commands (can do this later or have your admin do it):

```powershell
# Connect to Exchange Online
Connect-ExchangeOnline

# Create a mail-enabled security group
New-DistributionGroup -Name "Shipping Tracker Access" -Type Security -Members shipping@evolutionava.com

# Create the application access policy
New-ApplicationAccessPolicy -AppId "YOUR_CLIENT_ID" -PolicyScopeGroupId "Shipping Tracker Access" -AccessRight RestrictAccess -Description "Restrict shipping tracker to shipping mailbox only"
```

If you skip this step, the app can technically read any mailbox — but it only WILL read shipping@evolutionava.com. The scoping is a best-practice security measure.

## Step 5: Add Environment Variables to Vercel

1. Go to [Vercel Dashboard](https://vercel.com) → **evolution-shipping** project → **Settings** → **Environment Variables**
2. Add these variables:

| Variable | Value |
|----------|-------|
| `AZURE_TENANT_ID` | The Directory (tenant) ID from Step 1 |
| `AZURE_CLIENT_ID` | The Application (client) ID from Step 1 |
| `AZURE_CLIENT_SECRET` | The secret Value from Step 2 |
| `SHIPPING_MAILBOX` | `shipping@evolutionava.com` |
| `SYNC_SECRET` | Make up a random string (e.g. `evo-sync-2026-abc123`) |
| `CRON_SECRET` | Copy from Vercel: Settings → General → scroll to "Cron Job Protection" |

3. Make sure each variable is set for **Production** environment
4. Click **Save**

## Step 6: Deploy and Test

1. Push the code update:
```bash
cd shipping-tracker
npm install
git add .
git commit -m "Add automated email sync with cron job"
git push
```

2. After deploy completes, test the sync manually by visiting:
```
https://evolution-shipping.vercel.app/api/sync?secret=YOUR_SYNC_SECRET&days=60
```
(Use the SYNC_SECRET value you set in Step 5)

3. This should return JSON showing how many emails were fetched, parsed, and inserted.

## How It Works

- The Vercel cron job runs every 4 hours
- It reads emails from the shipping mailbox received in the last 2 days
- Parses vendor, order number, PO, tracking, carrier, and status from each email
- Checks the database for existing orders to avoid duplicates
- Inserts only new orders
- No Claude tokens consumed — runs entirely on the app server

## Supported Vendors (Auto-Parsed)

| Vendor | What's Extracted |
|--------|-----------------|
| Lutron | Order number, PO#, project name from subject |
| Crestron | Order number, PO#, project name, tracking from body |
| Sonance | Order/confirmation number |
| Legrand | Order number, PO# |
| UPS | Tracking number, carrier service, est. delivery, ship-to |
| FedEx | Tracking number |
| Wesco | PO#, tracking from body |
| TD SYNNEX | Order number, tracking |

Lutron tracking details are in PDF attachments — those still require the vendor portal login to get complete tracking data.
