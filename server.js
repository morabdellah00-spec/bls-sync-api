const express = require('express');
const cors = require('cors');
const expressWs = require('express-ws');
const path = require('path');

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Data storage
let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString()
};

let currentCommand = {
  location: '',
  visaType: '',
  timestamp: Date.now()
};

const wsConnections = new Set();

function broadcastToAll(message) {
  const messageStr = JSON.stringify(message);
  wsConnections.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(messageStr);
    }
  });
}

// ROOT ROUTE - Serve dashboard.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    applicants: sharedData.applicants.length, 
    groups: sharedData.groups.length 
  });
});

app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  
  sharedData.applicants = applicants;
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  
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
  
  broadcastToAll({
    type: 'DATA_UPDATED',
    data: sharedData
  });
  
  res.json({ success: true });
});

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

app.ws('/ws', (ws, req) => {
  console.log('WebSocket client connected');
  wsConnections.add(ws);

  ws.send(JSON.stringify({
    type: 'INITIAL_DATA',
    data: sharedData
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
    console.log('WebSocket client disconnected');
    wsConnections.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsConnections.delete(ws);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BLS Server running on port ${PORT}`);
});
