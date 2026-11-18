# Nghiệm thu bộ cài Windows (chạy trên CI hoặc máy Windows): cài mới (Setup), thư mục dữ liệu mặc định, nâng từ bản cũ,
# thư mục dữ liệu tùy chỉnh, Portable. Mỗi ca khởi động THẬT bản đã cài/đóng gói ở chế độ smoke (VCCOST_SMOKE) và đọc kết quả JSON.
param([string]$DistDir = 'dist', [string]$Work = $env:RUNNER_TEMP)
$ErrorActionPreference = 'Stop'
$results = @()
$appdataDir = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'VCCost'))
if (Test-Path -LiteralPath $appdataDir) { throw "Thu muc $appdataDir da ton tai. Dung nghiem thu de bao toan du lieu hien co." }

function Invoke-Smoke([string]$Exe, [hashtable]$EnvVars, [string]$Name) {
  $out = Join-Path $Work "smoke-$Name.json"
  if (Test-Path $out) { Remove-Item $out -Force }
  $set = @{ VCCOST_SMOKE = '1'; VCCOST_SMOKE_OUT = $out } + $EnvVars
  foreach ($k in $set.Keys) { Set-Item -Path "Env:$k" -Value $set[$k] }
  try { $p = Start-Process -FilePath $Exe -WindowStyle Hidden -PassThru -Wait } finally { foreach ($k in $set.Keys) { Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue } }
  if (-not (Test-Path $out)) { throw "[$Name] không có file kết quả smoke (exit $($p.ExitCode))" }
  $raw = Get-Content $out -Raw; Write-Host "[$Name] $raw"
  $r = $raw | ConvertFrom-Json
  if ($p.ExitCode -ne 0 -or -not $r.ok) { throw "[$Name] smoke không đạt: $($r.problems -join '; ')$($r.error)" }
  $script:results += [pscustomobject]@{ Ca = $Name; DuLieu = $r.acc.dataDir; Schema = $r.schema; Phieu = $r.counts.phieu; GhiChu = ($r.acc.migration | ConvertTo-Json -Compress) }
  return $r
}
function Assert-True([bool]$Cond, [string]$Msg) { if (-not $Cond) { throw $Msg } }

$setup = (Get-ChildItem $DistDir -Filter 'VC-Cost-*-Setup.exe' | Select-Object -First 1).FullName
$portable = (Get-ChildItem $DistDir -Filter 'VC-Cost-*-Portable.exe' | Select-Object -First 1).FullName
Assert-True ($setup -and $portable) 'Thiếu bộ cài Setup hoặc Portable trong dist'

# Cài mới (silent, không quyền quản trị: perMachine=false)
$inst = Join-Path $Work 'vc-install'
Start-Process -FilePath $setup -ArgumentList '/S', "/D=$inst" -WindowStyle Hidden -Wait
$exe = Join-Path $inst 'VC Cost.exe'
Assert-True (Test-Path $exe) "Cài Setup xong nhưng không thấy $exe"
Write-Host "Đã cài Setup vào $inst"


# Ca 1: cài mới → thư mục dữ liệu MẶC ĐỊNH của Setup (%APPDATA%\VCCost), nạp dữ liệu mẫu, nhập trùng, Excel/PDF, chốt kỳ, sao lưu/khôi phục, toàn vẹn
$r = Invoke-Smoke $exe @{} 'cai-moi-mac-dinh'
Assert-True (Test-Path (Join-Path $appdataDir 'data\app.db')) 'Setup không tạo DB ở %APPDATA%\VCCost\data'
Assert-True ($r.counts.phieu -eq 2035) "Cài mới phải có 2035 phiếu mẫu, thực tế $($r.counts.phieu)"

# Ca 2: nâng từ bản cũ (DB schema 4 có dữ liệu + WAL) ở thư mục mặc định → migrate lên bản mới, có PRE_MIGRATION, giữ dữ liệu
Remove-Item $appdataDir -Recurse -Force
$old = node --no-warnings scripts/make-old-db.js (Join-Path $appdataDir 'data\app.db') 4
Write-Host "DB cũ: $old"
$r = Invoke-Smoke $exe @{ VCCOST_EXPECT_UPGRADE_FROM = '4'; VCCOST_EXPECT_PHIEU = '3' } 'nang-cap-tu-v4'
Assert-True ($r.schema -ge 6) "Sau nâng cấp schema phải >= 6, thực tế $($r.schema)"
Assert-True (@(Get-ChildItem (Join-Path $appdataDir 'backups') -Filter '*_PRE_MIGRATION.db').Count -ge 1) 'Thiếu file PRE_MIGRATION trong %APPDATA%\VCCost\backups'

# Nâng DB của bản 0.7.1 (schema 6) lên schema 7, giữ dữ liệu cũ.
Remove-Item -LiteralPath $appdataDir -Recurse -Force
$old = node --no-warnings scripts/make-old-db.js (Join-Path $appdataDir 'data\app.db') 6
Write-Host "DB schema 6: $old"
$r = Invoke-Smoke $exe @{ VCCOST_EXPECT_UPGRADE_FROM = '6'; VCCOST_EXPECT_PHIEU = '3' } 'nang-cap-tu-v6'
Assert-True ($r.schema -eq 7) "Sau nâng cấp phải có schema 7, thực tế $($r.schema)"

# Ca 3: thư mục dữ liệu TÙY CHỈNH (VCCOST_DATA_DIR) — không đụng thư mục mặc định
Remove-Item $appdataDir -Recurse -Force
$custom = Join-Path $Work 'du-lieu-tuy-chinh'
$r = Invoke-Smoke $exe @{ VCCOST_DATA_DIR = $custom } 'thu-muc-tuy-chinh'
Assert-True (Test-Path (Join-Path $custom 'data\app.db')) 'Không tạo DB ở thư mục tùy chỉnh'
Assert-True (-not (Test-Path (Join-Path $appdataDir 'data\app.db'))) 'Thư mục tùy chỉnh nhưng vẫn ghi vào %APPDATA%\VCCost'

# Ca 4: Portable — dữ liệu nằm cạnh file .exe (VCCost-data)
$pdir = Join-Path $Work 'portable-test'; New-Item -ItemType Directory -Force $pdir | Out-Null
$pexe = Join-Path $pdir (Split-Path $portable -Leaf); Copy-Item $portable $pexe
$r = Invoke-Smoke $pexe @{} 'portable-mac-dinh'
Assert-True (Test-Path (Join-Path $pdir 'VCCost-data\data\app.db')) 'Portable không tạo VCCost-data cạnh file .exe'

Write-Host "`n=== KẾT QUẢ NGHIỆM THU BỘ CÀI ==="
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($env:GITHUB_STEP_SUMMARY) { "### Nghiệm thu bộ cài Windows`n" + (($results | ForEach-Object { "- ✅ $($_.Ca): schema $($_.Schema), $($_.Phieu) phiếu, dữ liệu tại ``$($_.DuLieu)``" }) -join "`n") | Add-Content $env:GITHUB_STEP_SUMMARY }
