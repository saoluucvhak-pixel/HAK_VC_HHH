#!/usr/bin/env python3
"""Tạo bộ cài Windows (NSIS) từ dist/win-unpacked — chạy được trên Linux (không cần wine).
   python3 installer/make-setup.py <version>     → dist/VC-Cost-<version>-Setup.exe
"""
import os, subprocess, sys, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = sys.argv[1] if len(sys.argv) > 1 else '0.0.0'
src = os.path.join(ROOT, 'dist', 'win-unpacked')
nsis = glob.glob(os.path.expanduser('~/.cache/electron-builder/nsis-3.0.4.1/*/'))[0].rstrip('/')
files, dirs = [], []
for dp, dn, fn in os.walk(src):
    rel = os.path.relpath(dp, src)
    if rel != '.': dirs.append(rel.replace('/', '\\'))
    for f in fn: files.append(os.path.normpath(os.path.join(rel, f)).replace('/', '\\'))
dirs.sort(key=lambda d: -d.count('\\'))
del_files = '\n'.join(f'  Delete "$INSTDIR\\{f}"' for f in files)
del_dirs = '\n'.join(f'  RMDir "$INSTDIR\\{d}"' for d in dirs)
out = os.path.join(ROOT, 'dist', f'VC-Cost-{ver}-Setup.exe')
nsi = f'''Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
!include "MUI2.nsh"
!define APP "VC Cost"
!define KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VCCost"
Name "${{APP}}"
OutFile "{out}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\\Programs\\VC Cost"
InstallDirRegKey HKCU "Software\\VCCost" "InstallDir"
BrandingText "VC Cost {ver} — HAK Group"
VIProductVersion "{ver}.0"
VIAddVersionKey "ProductName" "VC Cost"
VIAddVersionKey "FileDescription" "VC Cost - Quan ly chi phi van chuyen"
VIAddVersionKey "FileVersion" "{ver}"
VIAddVersionKey "LegalCopyright" "HAK Group"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\VC Cost.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Mở VC Cost"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Vietnamese"

Section "Install"
  ; bản đang chạy giữ file khóa → nhắc đóng
  IfFileExists "$INSTDIR\\VC Cost.exe" 0 chua_cai
  ClearErrors
  Delete "$INSTDIR\\VC Cost.exe"
  IfErrors 0 chua_cai
  MessageBox MB_ICONSTOP "Hãy đóng VC Cost đang chạy rồi cài lại." /SD IDOK
  Abort
  chua_cai:
  SetOutPath "$INSTDIR"
  File /r "{src}\\*.*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\\VC Cost"
  CreateShortcut "$SMPROGRAMS\\VC Cost\\VC Cost.lnk" "$INSTDIR\\VC Cost.exe"
  CreateShortcut "$SMPROGRAMS\\VC Cost\\Gỡ cài đặt VC Cost.lnk" "$INSTDIR\\Uninstall.exe"
  CreateShortcut "$DESKTOP\\VC Cost.lnk" "$INSTDIR\\VC Cost.exe"
  WriteRegStr HKCU "Software\\VCCost" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${{KEY}}" "DisplayName" "VC Cost"
  WriteRegStr HKCU "${{KEY}}" "DisplayVersion" "{ver}"
  WriteRegStr HKCU "${{KEY}}" "Publisher" "HAK Group"
  WriteRegStr HKCU "${{KEY}}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${{KEY}}" "DisplayIcon" "$INSTDIR\\VC Cost.exe"
  WriteRegStr HKCU "${{KEY}}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteRegDWORD HKCU "${{KEY}}" "NoModify" 1
  WriteRegDWORD HKCU "${{KEY}}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Chỉ xóa đúng các file do bộ cài tạo ra. DỮ LIỆU (%APPDATA%\\VCCost hoặc thư mục bạn đã chọn) KHÔNG bị xóa.
{del_files}
{del_dirs}
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\\VC Cost.lnk"
  Delete "$SMPROGRAMS\\VC Cost\\VC Cost.lnk"
  Delete "$SMPROGRAMS\\VC Cost\\Gỡ cài đặt VC Cost.lnk"
  RMDir "$SMPROGRAMS\\VC Cost"
  DeleteRegKey HKCU "${{KEY}}"
  DeleteRegKey HKCU "Software\\VCCost"
SectionEnd
'''
nsi_path = os.path.join(ROOT, 'dist', 'setup.nsi')
open(nsi_path, 'w', encoding='utf-8-sig').write(nsi)
env = dict(os.environ, NSISDIR=nsis, NSISCONFDIR=nsis)
r = subprocess.run([os.path.join(nsis, 'linux', 'makensis'), '-V2', nsi_path], env=env)
sys.exit(r.returncode)
