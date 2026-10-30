param([int]$IntervalMs = 2000, [string]$OutputFile = '', [switch]$Once)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if (-not ('ProcessCityNative' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ProcessCityNative {
  [StructLayout(LayoutKind.Sequential)] public struct FT { public uint low; public uint high; public double Value {get {return (double)high*4294967296.0+low;}} }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetSystemTimes(out FT idle,out FT kernel,out FT user);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct PE {
    public uint dwSize,cntUsage,th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID,cntThreads,th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string szExeFile;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32First(IntPtr snapshot,ref PE entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32Next(IntPtr snapshot,ref PE entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential)] public class Memory {
    public uint length=(uint)Marshal.SizeOf(typeof(Memory)),load;
    public ulong totalPhys,availPhys,totalPageFile,availPageFile,totalVirtual,availVirtual,availExtendedVirtual;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx([In,Out] Memory memory);
  public static Dictionary<int,int> Parents() {
    var result=new Dictionary<int,int>(); var handle=CreateToolhelp32Snapshot(2,0);
    if(handle==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
    try {var entry=new PE();entry.dwSize=(uint)Marshal.SizeOf(typeof(PE));
      if(Process32First(handle,ref entry)) do {result[(int)entry.th32ProcessID]=(int)entry.th32ParentProcessID;} while(Process32Next(handle,ref entry));
    } finally {CloseHandle(handle);} return result;
  }
  public static double[] Cpu() {FT idle,kernel,user;if(!GetSystemTimes(out idle,out kernel,out user))return null;return new double[]{idle.Value,kernel.Value+user.Value};}
  public static Memory Ram() {var memory=new Memory();if(!GlobalMemoryStatusEx(memory))throw new System.ComponentModel.Win32Exception();return memory;}
}
'@
}
$IntervalMs = [Math]::Max(1000,[Math]::Min(10000,$IntervalMs))
do {
  $started = [DateTime]::UtcNow
  $parents = [ProcessCityNative]::Parents()
  $records = [Collections.Generic.List[object]]::new()
  foreach ($process in [Diagnostics.Process]::GetProcesses()) {
    try {
      if ($process.Id -eq 0) {continue}
      $cpu = $null; $created = $null; $rss = 0L; $private = 0L
      try {$cpu=$process.TotalProcessorTime.TotalSeconds} catch {}
      try {$created=$process.StartTime.ToUniversalTime().ToString('o')} catch {}
      try {$rss=$process.WorkingSet64;$private=$process.PrivateMemorySize64} catch {}
      $parent = 0
      if ($parents.ContainsKey($process.Id)) {$parent=$parents[$process.Id]}
      $records.Add([ordered]@{pid=$process.Id;ppid=$parent;name=$process.ProcessName;createdAt=$created;cpuSeconds=$cpu;rssBytes=$rss;privateBytes=$private})
    } catch {} finally {$process.Dispose()}
  }
  $memory=[ProcessCityNative]::Ram();$cpuTimes=[ProcessCityNative]::Cpu()
  $systemCpu=$null
  if ($null -ne $cpuTimes) {$systemCpu=@{idle=$cpuTimes[0];total=$cpuTimes[1]}}
  $snapshot=[ordered]@{schemaVersion=1;capturedAt=[DateTime]::UtcNow.ToString('o');cores=[Environment]::ProcessorCount;totalBytes=[double]$memory.totalPhys;availableBytes=[double]$memory.availPhys;systemCpu=$systemCpu;processes=@($records.ToArray())}
  $json=$snapshot | ConvertTo-Json -Depth 5 -Compress
  if ($OutputFile) {
    $destination=[IO.Path]::GetFullPath($OutputFile);$temporary=$destination+'.tmp'
    [IO.File]::WriteAllText($temporary,$json,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $destination -Force
  } else {[Console]::WriteLine($json)}
  if (-not $Once) { $remaining=$IntervalMs-([DateTime]::UtcNow-$started).TotalMilliseconds;if($remaining -gt 0){Start-Sleep -Milliseconds ([int]$remaining)} }
} while (-not $Once)


