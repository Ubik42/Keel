using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

internal static class PhonePhotoSyncLauncher {
 static string Quote(string value) {
  if(value.IndexOf('"')>=0) throw new ArgumentException("路径包含非法引号");
  int trailing=value.Length-value.TrimEnd('\\').Length;
  return "\""+value+new string('\\',trailing)+"\"";
 }
 static int Main(string[] args) {
  Console.OutputEncoding=new UTF8Encoding(false);
  Console.Title="更新手机照片 · Serpent";
  bool pause=!args.Contains("--no-pause");int code=1;
  try {
   string folder=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
   var json=new JavaScriptSerializer();
   var config=json.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(folder,"launcher.json"),Encoding.UTF8));
   var options=new List<string>{Quote(Path.Combine(folder,"cli.py")),"--library",Quote(config["library"])};
   foreach(string arg in args) if(arg!="--no-pause") options.Add(Quote(arg));
   var start=new ProcessStartInfo(config["python"],String.Join(" ",options));
   start.WorkingDirectory=folder;start.UseShellExecute=false;
   start.EnvironmentVariables["PYTHONUTF8"]="1";start.EnvironmentVariables["PYTHONUNBUFFERED"]="1";
   using(var process=Process.Start(start)) {process.WaitForExit();code=process.ExitCode;}
  } catch(Exception error) {Console.Error.WriteLine("无法启动手机照片更新："+error.Message);}
  if(pause) {Console.WriteLine("\n按任意键关闭窗口。");Console.ReadKey(true);}
  return code;
 }
}
