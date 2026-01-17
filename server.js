const express = require('express');
const cors = require('cors');
const expressWs = require('express-ws');
const path = require('path');

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

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

// Periodic cleanup of dead connections
setInterval(() => {
  let cleaned = 0;
  wsConnections.forEach(ws => {
    if (ws.readyState !== 1) {
      wsConnections.delete(ws);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} dead WebSocket connection(s)`);
  }
}, 60000);

// Broadcast to all WebSocket clients (WITH PHOTOS)
function broadcastToAll(message) {
  const messageStr = JSON.stringify(message);
  let sent = 0;
  wsConnections.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(messageStr);
      sent++;
    }
  });
  console.log(`📡 Broadcasted to ${sent} client(s)`);
}

// ==================== ROUTES ====================

// Serve dashboard at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Dashboard not found');
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    applicants: sharedData.applicants.length, 
    groups: sharedData.groups.length,
    connections: wsConnections.size
  });
});

// Get data WITH photos
app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

app.get('/api/applicants/full', (req, res) => {
  res.json(sharedData);
});

// Sync from dashboard (accepts changes and broadcasts)
app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  
  sharedData.applicants = applicants;
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  
  console.log(`💾 Dashboard saved ${applicants.length} applicants`);
  
  // Broadcast update WITH photos to all extensions
  broadcastToAll({
    type: 'DATA_UPDATED',
    data: sharedData  // Includes photos!
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
  
  broadcastToAll({
    type: 'DATA_UPDATED',
    data: sharedData
  });
  
  res.json({ success: true });
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
  console.log('📡 WebSocket client connected');
  wsConnections.add(ws);
  console.log(`👥 Total connections: ${wsConnections.size}`);

  // Send initial data WITH photos immediately
  ws.send(JSON.stringify({
    type: 'INITIAL_DATA',
    data: sharedData  // Includes photos!
  }));

  ws.on('message', (msg) => {
    try {
      const message = JSON.parse(msg);
      
      if (message.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log('📡 WebSocket client disconnected');
    wsConnections.delete(ws);
    console.log(`👥 Total connections: ${wsConnections.size}`);
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
  console.log('💡 WebSocket sends photos for instant sync!');
});
