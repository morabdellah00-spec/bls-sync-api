const express = require('express');
const cors = require('cors');
const expressWs = require('express-ws');

// Memory optimization
if (global.gc) {
  setInterval(() => {
    global.gc();
    console.log('🧹 Memory cleanup triggered');
  }, 300000); // Every 5 minutes
}

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Data storage
let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString()
};

// Broadcast command storage
let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

// WebSocket connections
const wsConnections = new Set();

// Periodic cleanup of dead connections (reduce memory usage)
setInterval(() => {
  let cleaned = 0;
  wsConnections.forEach(ws => {
    if (ws.readyState !== 1) { // Not OPEN
      wsConnections.delete(ws);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} dead WebSocket connection(s)`);
  }
}, 60000); // Every 1 minute

// Broadcast to all WebSocket clients
function broadcastToAll(message) {
  // Remove photos from broadcast to save bandwidth
  if (message.data && message.data.applicants) {
    message.data.applicants = message.data.applicants.map(app => ({
      ...app,
      photo: null
    }));
  }
  
  const messageStr = JSON.stringify(message);
  wsConnections.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(messageStr);
    }
  });
}

// ==================== ROUTES ====================

// Serve dashboard at root
app.get('/', (req, res) => {
  const path = require('path');
  // Try multiple locations
  const fs = require('fs');
  
  if (fs.existsSync(path.join(__dirname, 'dashboard.html'))) {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
  } else if (fs.existsSync(path.join(__dirname, 'public', 'dashboard.html'))) {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else if (fs.existsSync(path.join(__dirname, 'public', 'index.html'))) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).send('Dashboard not found. Please upload dashboard.html');
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    applicants: sharedData.applicants.length, 
    groups: sharedData.groups.length 
  });
});

app.get('/api/applicants', (req, res) => {
  // Remove photos from API response to save bandwidth/money
  const applicantsWithoutPhotos = sharedData.applicants.map(app => ({
    ...app,
    photo: null // Don't send photos via API
  }));
  
  res.json({
    applicants: applicantsWithoutPhotos,
    groups: sharedData.groups,
    lastModified: sharedData.lastModified
  });
});

app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  
  sharedData.applicants = applicants;
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  
  // Broadcast update to all WebSocket clients
  broadcastToAll({
    type: 'DATA_UPDATED',
    data: sharedData
  });
  
  res.json({ 
    success: true, 
    data: sharedData, 
    stats: { 
      totalApplicants: sharedData.applicants.length, 
      totalGroups: sharedData.groups.length 
    } 
  });
});

app.delete('/api/applicants', (req, res) => {
  sharedData = { 
    applicants: [], 
    groups: [], 
    lastModified: new Date().toISOString() 
  };
  
  // Broadcast update
  broadcastToAll({
    type: 'DATA_UPDATED',
    data: sharedData
  });
  
  res.json({ success: true });
});

// Get single applicant with photo (on-demand for dashboard)
app.get('/api/applicants/:passportNo/photo', (req, res) => {
  const applicant = sharedData.applicants.find(a => a.PassportNo === req.params.passportNo);
  if (applicant && applicant.photo) {
    res.json({ photo: applicant.photo });
  } else {
    res.status(404).json({ photo: null });
  }
});

// Manual sync full applicants WITH photos to extensions (triggered by dashboard button)
app.post('/api/sync-photos-to-extensions', (req, res) => {
  console.log('📤 Manual full sync WITH photos triggered from dashboard');
  
  // Broadcast full data WITH photos to all extensions
  const fullDataWithPhotos = {
    type: 'FULL_SYNC_WITH_PHOTOS',
    data: sharedData // Complete applicants WITH photos
  };
  
  const messageStr = JSON.stringify(fullDataWithPhotos);
  let syncCount = 0;
  
  wsConnections.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(messageStr);
      syncCount++;
    }
  });
  
  console.log(`✅ Full applicants WITH photos synced to ${syncCount} extension(s)`);
  
  res.json({ 
    success: true, 
    connections: syncCount,
    message: `Complete applicants WITH photos synced to ${syncCount} extension(s)`
  });
});

// ==================== BROADCAST ENDPOINTS ====================

app.post('/api/broadcast', (req, res) => {
  const { location, visaType, timestamp } = req.body;

  if (!location || !visaType) {
    return res.status(400).json({
      success: false,
      error: 'Missing location or visaType'
    });
  }

  currentCommand = {
    location,
    visaType,
    timestamp: timestamp || Date.now()
  };

  console.log('📢 Broadcast command:', currentCommand);

  res.json({
    success: true,
    command: currentCommand
  });
});

app.get('/api/broadcast', (req, res) => {
  res.json({
    success: true,
    ...currentCommand
  });
});

// ==================== WEBSOCKET ====================

app.ws('/ws', (ws, req) => {
  console.log('WebSocket client connected');
  wsConnections.add(ws);

  // Send initial data WITHOUT photos to save bandwidth
  const initialData = {
    applicants: sharedData.applicants.map(app => ({
      ...app,
      photo: null
    })),
    groups: sharedData.groups,
    lastModified: sharedData.lastModified
  };

  ws.send(JSON.stringify({
    type: 'INITIAL_DATA',
    data: initialData
  }));

  ws.on('message', (msg) => {
    try {
      const message = JSON.parse(msg);
      console.log('Received:', message);
      
      if (message.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsConnections.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsConnections.delete(ws);
  });
});

// ==================== START SERVER ====================

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
});
