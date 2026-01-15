const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = http.createServer(app);

// WebSocket clients
const clients = new Set();

function broadcastToClients(message) {
  const data = JSON.stringify(message);
  let sent = 0;
  clients.forEach(client => {
    try {
      client.send(data);
      sent++;
    } catch (e) {
      clients.delete(client);
    }
  });
  console.log(`📡 Broadcast to ${sent} extension(s): ${message.type}`);
}

// WebSocket upgrade handler
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    handleWebSocket(req, socket, head);
  } else {
    socket.destroy();
  }
});

function handleWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
    '\r\n'
  );

  const client = {
    socket: socket,
    send: (data) => {
      const buffer = Buffer.from(data);
      const frame = Buffer.allocUnsafe(buffer.length + 2);
      frame[0] = 0x81;
      frame[1] = buffer.length;
      buffer.copy(frame, 2);
      socket.write(frame);
    }
  };

  clients.add(client);
  console.log(`✅ Extension connected (Total: ${clients.size})`);

  client.send(JSON.stringify({
    type: 'INITIAL_DATA',
    data: sharedData
  }));

  socket.on('close', () => {
    clients.delete(client);
    console.log(`❌ Extension disconnected (Total: ${clients.size})`);
  });

  socket.on('error', (err) => {
    clients.delete(client);
  });
}

let sharedData = {
  applicants: [],
  groups: [],
  lastModified: new Date().toISOString()
};

let broadcastCommand = {
  location: null,
  visaType: null,
  timestamp: null
};

// Serve dashboard.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/applicants', (req, res) => {
  res.json(sharedData);
});

app.post('/api/applicants/sync', (req, res) => {
  const { applicants, groups } = req.body;
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Invalid' });
  }
  
  sharedData.applicants = applicants;
  sharedData.groups = groups || [];
  sharedData.lastModified = new Date().toISOString();
  
  broadcastToClients({
    type: 'DATA_UPDATED',
    data: sharedData,
    source: 'sync'
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
  
  broadcastToClients({
    type: 'DATA_UPDATED',
    data: sharedData,
    source: 'delete_all'
  });
  
  res.json({ success: true });
});

app.post('/api/force-sync', (req, res) => {
  console.log('🔔 Force sync!');
  
  broadcastToClients({
    type: 'FORCE_SYNC',
    data: sharedData,
    timestamp: Date.now()
  });
  
  res.json({ 
    success: true, 
    message: 'Sent via WebSocket!',
    connectedExtensions: clients.size
  });
});

app.get('/api/broadcast', (req, res) => {
  res.json(broadcastCommand);
});

app.post('/api/broadcast', (req, res) => {
  const { location, visaType, timestamp } = req.body;
  
  if (!location || !visaType) {
    return res.status(400).json({ error: 'Required' });
  }
  
  broadcastCommand = {
    location,
    visaType,
    timestamp: timestamp || Date.now()
  };
  
  res.json({ success: true, command: broadcastCommand });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server on ${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
});
