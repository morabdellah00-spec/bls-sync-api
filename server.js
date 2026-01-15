const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname)); // Serve static files

const server = http.createServer(app);

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const EMAIL_USER = process.env.EMAIL_USER || 'your-email@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'your-app-password';
const BASE_URL = process.env.BASE_URL || 'https://bls-sync-api-production.up.railway.app';

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// In-memory database (use real DB in production)
const users = new Map(); // email -> {email, password, verified, verificationToken, data}
const sessions = new Map(); // token -> email

// WebSocket clients per user
const userWebSockets = new Map(); // email -> Set of WebSocket clients

function broadcastToUser(email, message) {
  const clients = userWebSockets.get(email);
  if (!clients) return 0;
  
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
  
  console.log(`📡 Broadcast to ${email}: ${message.type} (${sent} clients)`);
  return sent;
}

// WebSocket upgrade handler
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws?token=')) {
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

  // Extract token from URL
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  const email = sessions.get(token);
  
  if (!email) {
    console.log('❌ WebSocket: Invalid token');
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
    email: email,
    send: (data) => {
      const buffer = Buffer.from(data);
      const frame = Buffer.allocUnsafe(buffer.length + 2);
      frame[0] = 0x81;
      frame[1] = buffer.length;
      buffer.copy(frame, 2);
      socket.write(frame);
    }
  };

  if (!userWebSockets.has(email)) {
    userWebSockets.set(email, new Set());
  }
  userWebSockets.get(email).add(client);
  
  console.log(`✅ ${email} connected via WebSocket`);

  // Send initial data
  const user = users.get(email);
  if (user && user.data) {
    client.send(JSON.stringify({
      type: 'INITIAL_DATA',
      data: user.data
    }));
  }

  socket.on('close', () => {
    const clients = userWebSockets.get(email);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        userWebSockets.delete(email);
      }
    }
    console.log(`❌ ${email} disconnected`);
  });

  socket.on('error', () => {
    const clients = userWebSockets.get(email);
    if (clients) clients.delete(client);
  });
}

// Middleware: Verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  const email = sessions.get(token);
  if (!email) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.userEmail = email;
  next();
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Register new user
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (users.has(email)) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  users.set(email, {
    email,
    password: hashedPassword,
    verified: true, // Auto-verify for testing
    verificationToken: null,
    data: {
      applicants: [],
      groups: [],
      lastModified: new Date().toISOString()
    }
  });

  console.log(`✅ User registered (auto-verified): ${email}`);
  res.json({ 
    success: true, 
    message: 'Registration successful! You can now login.' 
  });
});

// Verify email
app.get('/api/auth/verify', (req, res) => {
  const { token } = req.query;
  
  let userEmail = null;
  for (const [email, user] of users.entries()) {
    if (user.verificationToken === token) {
      userEmail = email;
      break;
    }
  }

  if (!userEmail) {
    return res.send('<h1>Invalid verification link</h1>');
  }

  const user = users.get(userEmail);
  user.verified = true;
  user.verificationToken = null;

  res.send(`
    <h1>✅ Email Verified!</h1>
    <p>Your email has been verified successfully.</p>
    <a href="/">Click here to login</a>
  `);
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = users.get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.verified) {
    return res.status(401).json({ error: 'Please verify your email first' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, email);

  res.json({ 
    success: true, 
    token,
    email
  });
});

// Logout
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  sessions.delete(token);
  res.json({ success: true });
});

// Get user's applicants
app.get('/api/applicants', authenticateToken, (req, res) => {
  const user = users.get(req.userEmail);
  res.json(user.data);
});

// Sync applicants
app.post('/api/applicants/sync', authenticateToken, (req, res) => {
  const { applicants, groups } = req.body;
  
  if (!Array.isArray(applicants)) {
    return res.status(400).json({ error: 'Invalid' });
  }

  const user = users.get(req.userEmail);
  user.data.applicants = applicants;
  user.data.groups = groups || [];
  user.data.lastModified = new Date().toISOString();

  // Broadcast to user's extensions
  broadcastToUser(req.userEmail, {
    type: 'DATA_UPDATED',
    data: user.data,
    source: 'sync'
  });

  res.json({ 
    success: true, 
    data: user.data, 
    stats: { 
      totalApplicants: user.data.applicants.length, 
      totalGroups: user.data.groups.length 
    } 
  });
});

// Delete all
app.delete('/api/applicants', authenticateToken, (req, res) => {
  const user = users.get(req.userEmail);
  user.data = {
    applicants: [],
    groups: [],
    lastModified: new Date().toISOString()
  };

  broadcastToUser(req.userEmail, {
    type: 'DATA_UPDATED',
    data: user.data,
    source: 'delete_all'
  });

  res.json({ success: true });
});

// Force sync
app.post('/api/force-sync', authenticateToken, (req, res) => {
  const user = users.get(req.userEmail);
  
  const sent = broadcastToUser(req.userEmail, {
    type: 'FORCE_SYNC',
    data: user.data,
    timestamp: Date.now()
  });

  res.json({ 
    success: true, 
    message: 'Sent via WebSocket!',
    connectedExtensions: sent
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server on ${PORT}`);
  console.log(`📧 Email: ${EMAIL_USER}`);
});
