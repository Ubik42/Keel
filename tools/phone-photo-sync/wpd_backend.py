import sys,ctypes,json,hashlib,os,time,threading,functools
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'runtime'))
sys.coinit_flags=0
import comtypes,comtypes.client
api=comtypes.client.GetModule('PortableDeviceApi.dll')
types=comtypes.client.GetModule('PortableDeviceTypes.dll')
ole32=ctypes.OleDLL('ole32');ole32.CoTaskMemFree.argtypes=[ctypes.c_void_p];ole32.CoTaskMemFree.restype=None

def key(g,p):
 k=api._tagpropertykey();k.fmtid=comtypes.GUID(g);k.pid=p;return k
OBJECT='{EF6B490D-5CD8-437A-AFFC-DA8B60EE4A3C}'
NAME=key(OBJECT,4);ORIGINAL_NAME=key(OBJECT,12);SIZE=key(OBJECT,11);CONTENT_TYPE=key(OBJECT,7)
RESOURCE=key('{E81E79BE-34F0-41BF-B53F-F1A06AE87842}',0)
CAPACITY=key('{01A3057A-74D6-4E80-BEA7-DC4C212CE50A}',4)
FREE=key('{01A3057A-74D6-4E80-BEA7-DC4C212CE50A}',5)
FOLDER='{27E2E392-A111-48E0-AB0C-E17705A05F85}'
def guarded(fn):
 @functools.wraps(fn)
 def call(self,*args,**kwargs):
  self._active=fn.__name__;self._last_progress=time.monotonic()
  try:return fn(self,*args,**kwargs)
  finally:self._active=None
 return call

class Phone:
 def __init__(self,expected_serial=None):
  kernel=ctypes.WinDLL('kernel32',use_last_error=True)
  kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_wchar_p];kernel.CreateMutexW.restype=ctypes.c_void_p
  kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong];kernel.WaitForSingleObject.restype=ctypes.c_ulong
  kernel.ReleaseMutex.argtypes=[ctypes.c_void_p];kernel.CloseHandle.argtypes=[ctypes.c_void_p]
  self._kernel=kernel;self._mutex=kernel.CreateMutexW(None,0,'Local\\UbikPhoneStorageMaintenance-OnePlusAce5')
  if kernel.WaitForSingleObject(self._mutex,0) not in (0,128):
   kernel.CloseHandle(self._mutex);raise RuntimeError('另一项手机操作正在运行，请完成后再更新。')
  mgr=comtypes.client.CreateObject(api.PortableDeviceManager,interface=api.IPortableDeviceManager)
  mgr.RefreshDeviceList()
  n=ctypes.c_ulong();raw=getattr(mgr,'_IPortableDeviceManager__com_GetDevices');raw(None,ctypes.byref(n))
  if n.value!=1:raise RuntimeError('请只连接待更新的手机，解锁并开启 USB 文件传输。')
  buf=(ctypes.c_void_p*n.value)();raw(ctypes.cast(buf,ctypes.POINTER(ctypes.c_wchar_p)),ctypes.byref(n))
  self.device_id=ctypes.wstring_at(buf[0]);ole32.CoTaskMemFree(buf[0])
  client=comtypes.client.CreateObject(types.PortableDeviceValues,interface=api.IPortableDeviceValues)
  client.SetStringValue(key('{204D9F0C-2292-4080-9F42-40664E70F859}',2),'Serpent photo sync')
  client.SetUnsignedIntegerValue(key('{204D9F0C-2292-4080-9F42-40664E70F859}',9),0x80000000)
  self.dev=comtypes.client.CreateObject(api.PortableDeviceFTM,interface=api.IPortableDevice)
  self.dev.Open(self.device_id,client);self.content=self.dev.Content();self.properties=self.content.Properties();self.resources=self.content.Transfer()
  self.keys=comtypes.client.CreateObject(types.PortableDeviceKeyCollection,interface=api.IPortableDeviceKeyCollection)
  for k in [NAME,ORIGINAL_NAME,SIZE,CONTENT_TYPE]:self.keys.Add(k)
  self._active=None;self._closed=threading.Event();self._last_progress=time.monotonic()
  def watchdog():
   comtypes.CoInitializeEx(0)
   try:
    while not self._closed.wait(2):
     timeout=180 if self._active=='delete' else 60
     if self._active and time.monotonic()-self._last_progress>timeout:
      try:self.dev.Cancel()
      except Exception:pass
      self._last_progress=time.monotonic()
   finally:comtypes.CoUninitialize()
  self._watchdog=threading.Thread(target=watchdog,daemon=True);self._watchdog.start()
  self.storage=self.children('DEVICE')[0]
  self._path_cache={'':self.storage};self._directory_cache={}
  device_keys=comtypes.client.CreateObject(types.PortableDeviceKeyCollection,interface=api.IPortableDeviceKeyCollection)
  serial_key=key('{26D4979A-E643-4626-9E2B-736DC0C92FDC}',9)
  model_key=key('{26D4979A-E643-4626-9E2B-736DC0C92FDC}',8)
  device_keys.Add(serial_key);device_keys.Add(model_key)
  device_values=self.properties.GetValues('DEVICE',device_keys)
  try:self.serial=device_values.GetStringValue(serial_key)
  except comtypes.COMError:self.serial=None
  try:self.model=device_values.GetStringValue(model_key)
  except comtypes.COMError:self.model='Android phone'
  if expected_serial and self.serial!=expected_serial:
   self.close();raise RuntimeError('连接的手机与此资源库绑定设备不同。')
  self.modified_key=key(OBJECT,19);self.keys.Add(self.modified_key)
 @guarded
 def children(self,parent):
  e=self.content.EnumObjects(0,parent,None);result=[]
  while True:
   count=ctypes.c_ulong();buf=(ctypes.c_void_p*128)()
   getattr(e,'_IEnumPortableDeviceObjectIDs__com_Next')(128,ctypes.cast(buf,ctypes.POINTER(ctypes.c_wchar_p)),ctypes.byref(count))
   self._last_progress=time.monotonic()
   for i in range(count.value):result.append(ctypes.wstring_at(buf[i]));ole32.CoTaskMemFree(buf[i])
   if count.value<128:break
  return result
 @guarded
 def info(self,oid):
  values=self.properties.GetValues(oid,self.keys)
  try:name=values.GetStringValue(ORIGINAL_NAME)
  except comtypes.COMError:name=values.GetStringValue(NAME)
  ctype=str(values.GetGuidValue(CONTENT_TYPE))
  try:size=values.GetUnsignedLargeIntegerValue(SIZE)
  except comtypes.COMError:size=None
  stamp=None
  try:
   value=values.GetValue(self.modified_key)
   if value.vt==7:stamp=str(ctypes.c_double.from_buffer(value,8).value)
  except (comtypes.COMError,AttributeError):pass
  return {'id':oid,'name':name,'folder':ctype.upper()==FOLDER,'bytes':size,'stamp':stamp,'contentType':ctype}
 @guarded
 def capacity(self):
  ks=comtypes.client.CreateObject(types.PortableDeviceKeyCollection,interface=api.IPortableDeviceKeyCollection)
  ks.Add(CAPACITY);ks.Add(FREE);v=self.properties.GetValues(self.storage,ks)
  return {'capacity':v.GetUnsignedLargeIntegerValue(CAPACITY),'free':v.GetUnsignedLargeIntegerValue(FREE)}
 @guarded
 def download(self,oid,target,expected):
  target=Path(target);part=target.with_name(target.name+'.phone-copy.partial')
  target.parent.mkdir(parents=True,exist_ok=True)
  optimal,stream=self.resources.GetStream(oid,RESOURCE,0,0)
  blocksize=max(1024*1024,min(int(optimal) or 1024*1024,4*1024*1024));buffer=(ctypes.c_ubyte*blocksize)();total=0;h=hashlib.sha256()
  try:
   read=getattr(stream,'_ISequentialStream__com_RemoteRead')
   with part.open('wb') as f:
    while True:
     count=ctypes.c_ulong();read(buffer,blocksize,ctypes.byref(count))
     self._last_progress=time.monotonic()
     if not count.value:break
     data=ctypes.string_at(buffer,count.value);f.write(data);h.update(data);total+=count.value
    f.flush();os.fsync(f.fileno())
   if total!=expected:raise RuntimeError(f'Transfer size mismatch: {total} != {expected}')
   if target.exists():raise RuntimeError('Refusing to overwrite existing archive item')
   part.rename(target)
   return {'bytes':total,'sha256':h.hexdigest()}
  finally:del stream
 def find(self,path):
  parts=path.strip('/').split('/')
  if any(p in {'','..','.'} for p in parts):raise RuntimeError('Invalid phone path')
  current=self.storage;prefix='';row=None
  for part in parts:
   prefix=prefix+'/'+part if prefix else part
   if prefix in self._path_cache:
    current=self._path_cache[prefix];continue
   if current not in self._directory_cache:
    items=[self.info(i) for i in self.children(current)]
    self._directory_cache[current]={r['name']:r for r in items}
   row=self._directory_cache[current].get(part)
   if row is None:raise FileNotFoundError(path)
   current=row['id'];self._path_cache[prefix]=current
  row=self.info(current);row['path']=path
  return row
 def close(self):
  self._closed.set()
  try:self.dev.Close()
  finally:self._kernel.ReleaseMutex(self._mutex);self._kernel.CloseHandle(self._mutex)
