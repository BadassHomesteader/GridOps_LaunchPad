# GridOps LaunchPad

Team link hub with Azure AD auth. Users see only the link collections shared with them. Each user also has a private "My Links" section they can manage themselves.

## Stack
- **Frontend**: Vanilla JS, single-file HTML pages (no bundler)
- **Backend**: Azure Functions v4 (Node.js)
- **Storage**: Azure Blob Storage (container: `gridops-launchpad-data`)
- **Auth**: MSAL.js (Azure AD) + `X-Auth-Token` header (SWA strips `Authorization`)
- **Hosting**: Azure Static Web Apps

## Project structure
```
GridOps_LaunchPad/
├── index.html          — main launchpad (all users)
├── admin.html          — collection manager (admin only)
├── users.html          — user manager (admin only)
├── staticwebapp.config.json
├── api/
│   ├── package.json
│   ├── host.json
│   ├── local.settings.json  (gitignored)
│   └── src/
│       ├── index.js
│       ├── middleware/auth.js      — X-Auth-Token + Easy Auth + auto-admin
│       ├── storage/blob.js         — local dev + Azure Blob (CONTAINER = gridops-launchpad-data)
│       └── functions/
│           ├── me.js               — GET /api/me
│           ├── collections.js      — CRUD /api/collections (+ /sharing)
│           ├── personal.js         — GET+PUT /api/personal (per-user blob)
│           ├── users.js            — GET+POST+PUT+DELETE /api/users (admin only)
│           └── feedback.js         — CRUD /api/feedback
└── gridops-launchpad-data/   (local dev data — gitignored)
    └── _config/
        └── allowed-users.json
```

## Azure AD setup (required before deploy)
1. Create or reuse an Azure AD app registration in portal.azure.com
2. Add redirect URI: `https://<your-swa-url>` and `http://localhost:5500`
3. Copy the **Client ID**
4. Client ID is already set (`f6c71447-d931-4690-aa7a-a43b5c261c71` — shared with GridOps_Cal). If you ever need to change it, update three files:
   - `index.html` → `MSAL_CONFIG.auth.clientId`
   - `admin.html` → `MSAL_CONFIG.auth.clientId`
   - `users.html` → `MSAL_CONFIG.auth.clientId`

## Blob storage layout
```
gridops-launchpad-data/
├── _config/
│   └── allowed-users.json          — user list
├── _feedback/
│   └── items.json                  — all feedback in one ETag-protected array
├── collections/
│   └── col-{id}.json               — one blob per collection
└── personal/
    └── {email-safe}/
        └── my-links.json           — per-user personal links
```

### Collection schema
```json
{
  "id": "col-1234-abcd",
  "name": "SharePoint Links",
  "icon": "📁",
  "description": "Client SharePoint sites",
  "owner": "admin@example.com",
  "createdAt": "...", "updatedAt": "...",
  "sharedWith": ["user@example.com"],
  "links": [
    { "id": "lnk-...", "name": "AMI Site", "url": "https://...", "description": "..." }
  ]
}
```

## Access control
- **Admin**: sees all collections, full CRUD, manages users
- **User/Viewer**: sees only collections in their `sharedWith` list + their own personal links
- **Personal links**: private per-user blob — no one else can see them

## Auto-admin emails (auth.js — bypass blob lookup)
- `jlunkwitz@contractcallers.com`
- `juergs@geeksare.cool`
- `juergs@geeksarecool.onmicrosoft.com`

## Local dev
```bash
cd api && npm install && func start
# Serve frontend with VS Code Live Server (port 5500)
```
`local.settings.json`: `STORAGE_CONNECTION_STRING = UseDevelopmentStorage=true`

## Deploy
```bash
swa deploy . --deployment-token <TOKEN> --env production
```
Azure app setting required: `STORAGE_CONNECTION_STRING`
