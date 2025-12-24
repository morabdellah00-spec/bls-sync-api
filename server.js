const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Simple in-memory storage (single shared database - no auth)
let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString()
};

// Serve dashboard as homepage
app.get('/', (req, res) => {
  // Check if requesting JSON API
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ 
      status: 'ok', 
      service: 'BLS Applicant Manager Sync API',
      version: '1.0.0'
    });
  }
  
  // Otherwise serve a simple status page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>BLS Sync API</title>
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
        }
        h1 { color: #667eea; margin: 0 0 10px 0; }
        .stats { color: #7f8c8d; font-size: 14px; }
        .badge { 
          display: inline-block;
          background: #27ae60;
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 BLS Sync API</h1>
        <div class="stats">
          <p>Applicants: ${sharedData.applicants.length}</p>
          <p>Groups: ${sharedData.groups.length}</p>
          <p>Last Modified: ${new Date(sharedData.lastModified).toLocaleString()}</p>
        </div>
        <div class="badge">✅ Online</div>
      </div>
    </body>
    </html>
  `);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'BLS Applicant Manager Sync API',
    version: '1.0.0',
    applicants: sharedData.applicants.length,
    groups: sharedData.groups.length
  });
});

// Get all applicants (no auth required)
app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

// Sync applicants (merge strategy)
app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Applicants must be an array' });
  }
  
  // Merge applicants (keep latest version based on passport)
  const mergedApplicants = new Map();
  
  // Add existing applicants
  sharedData.applicants.forEach(app => {
    if (app.PassportNo) {
      mergedApplicants.set(app.PassportNo, app);
    }
  });
  
  // Merge with incoming applicants
  applicants.forEach(app => {
    if (app.PassportNo) {
      mergedApplicants.set(app.PassportNo, app);
    }
  });
  
  // Merge groups
  const mergedGroups = Array.from(new Set([
    ...sharedData.groups,
    ...(groups || [])
  ]));
  
  sharedData = {
    applicants: Array.from(mergedApplicants.values()),
    groups: mergedGroups,
    lastModified: new Date().toISOString()
  };
  
  console.log(`✅ Synced: ${sharedData.applicants.length} applicants, ${sharedData.groups.length} groups`);
  
  res.json({
    success: true,
    data: sharedData,
    stats: {
      totalApplicants: sharedData.applicants.length,
      totalGroups: sharedData.groups.length
    }
  });
});

// Replace all applicants (full sync)
app.put('/api/applicants', (req, res) => {
  const { applicants, groups } = req.body;
  
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Applicants must be an array' });
  }
  
  sharedData = {
    applicants: applicants || [],
    groups: groups || [],
    lastModified: new Date().toISOString()
  };
  
  console.log(`✅ Replaced: ${sharedData.applicants.length} applicants, ${sharedData.groups.length} groups`);
  
  res.json({
    success: true,
    data: sharedData,
    stats: {
      totalApplicants: sharedData.applicants.length,
      totalGroups: sharedData.groups.length
    }
  });
});

// Delete all applicants
app.delete('/api/applicants', (req, res) => {
  sharedData = {
    applicants: [],
    groups: [],
    lastModified: new Date().toISOString()
  };
  
  console.log('✅ Deleted all applicants');
  
  res.json({
    success: true,
    message: 'All applicants deleted'
  });
});

// Get sync status
app.get('/api/sync/status', (req, res) => {
  res.json({
    hasSyncedData: sharedData.applicants.length > 0,
    lastModified: sharedData.lastModified,
    applicantCount: sharedData.applicants.length,
    groupCount: sharedData.groups.length
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Get port from Railway's environment
const PORT = parseInt(process.env.PORT || '3000', 10);

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Sync API running on 0.0.0.0:${PORT}`);
  console.log(`📊 Applicants: ${sharedData.applicants.length}`);
  console.log(`📁 Groups: ${sharedData.groups.length}`);
});

// Handle graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Forcing shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
