# BLS Applicant Manager Pro - Cloud Sync Edition

## 📦 Package Contents

### 1. `bls-sync-backend/` - Railway Backend Server
Backend API server for cloud synchronization:
- `server.js` - Express.js API server
- `package.json` - Node.js dependencies
- `railway.json` - Railway deployment config
- `README.md` - Backend documentation
- `.gitignore` - Git ignore rules

### 2. `enhanced-extension/` - Chrome Extension
Enhanced extension with cloud sync:
- `manifest.json` - Extension manifest
- `popup.html` - Extension UI
- `popup.js` - Extension logic with sync
- `content.js` - Content script

### 3. `DEPLOYMENT_GUIDE.md`
Complete step-by-step setup instructions

## 🚀 Quick Start (5 Minutes)

### Step 1: Deploy Backend
```bash
cd bls-sync-backend
npm install
# Follow DEPLOYMENT_GUIDE.md for Railway deployment
```

### Step 2: Install Extension
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `enhanced-extension` folder

### Step 3: Configure
1. Click extension icon
2. Click "Settings" ⚙️
3. Register account (email + password)
4. Save settings

### Step 4: Sync!
- Click "🔄 Sync Now" anytime
- Enable auto-sync for automatic syncing

## 📖 Full Documentation

See **DEPLOYMENT_GUIDE.md** for:
- Detailed Railway deployment
- Security configuration
- Database setup
- Multi-browser setup
- Troubleshooting
- API reference

## 🎯 Key Features

✅ Cloud synchronization across devices
✅ Automatic backups
✅ Team data sharing
✅ Secure API key authentication
✅ Merge-based sync (keeps all data)
✅ Import/Export compatibility
✅ All original features preserved

## 🔗 Important Links

- Railway: https://railway.app
- Chrome Extensions: chrome://extensions/

## 📝 Notes

- Backend uses in-memory storage by default
- For production: Add PostgreSQL or MongoDB
- Free Railway tier: Apps sleep after 5min inactivity
- First sync after sleep may be slower

## 🆘 Need Help?

1. Check `DEPLOYMENT_GUIDE.md` troubleshooting section
2. View Railway logs: `railway logs`
3. Check extension console (right-click → Inspect)

---

**Ready to go?** Start with the DEPLOYMENT_GUIDE.md!
