@echo off
cd /d "%~dp0"
title VC Cost - Noi file va cai dat
set "NAME=VC-Cost-0.8.3-Setup.exe"
set "HASH=39cc35bb0679a08290ceea3184b47b47d5dba891ffcba2585dc859b9ca2baa72"
set "PARTS="
set "GOT="
set COUNT=0

echo ============================================
echo   VC Cost 0.8.3 - Noi file va cai dat
echo ============================================
echo Thu muc: %CD%
echo.

for %%F in (%NAME%.part*) do call :addpart "%%F"

if %COUNT%==0 goto :nopart
if not %COUNT%==5 goto :badcount

echo Dang noi %COUNT% file, vui long doi...
if exist "%NAME%" del /f /q "%NAME%"
copy /b %PARTS% "%NAME%" >nul
if errorlevel 1 goto :copyfail
if not exist "%NAME%" goto :copyfail

echo Dang kiem tra tinh toan ven SHA256...
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%NAME%" SHA256') do if not defined GOT set "GOT=%%H"
set "GOT=%GOT: =%"
if /i not "%GOT%"=="%HASH%" goto :badhash

echo.
echo OK - file hop le: %NAME%
echo.
choice /c YN /m "Chay bo cai dat ngay bay gio"
if errorlevel 2 goto :done
start "" "%NAME%"
goto :end

:addpart
set /a COUNT+=1
if "%PARTS%"=="" goto :first
set "PARTS=%PARTS%+%~1"
goto :eof
:first
set "PARTS=%~1"
goto :eof

:nopart
echo [LOI] Khong thay file %NAME%.part00, part01 ... trong thu muc nay.
echo Hay dat file .bat cung thu muc voi cac file .part va giu nguyen ten file.
goto :fail

:badcount
echo [LOI] Can du 5 file part tu part00 den part04, hien chi co %COUNT% file.
goto :fail

:copyfail
echo [LOI] Noi file that bai. Kiem tra o dia con trong va quyen ghi thu muc.
goto :fail

:badhash
echo [LOI] Ma SHA256 khong khop - co file part bi loi hoac tai thieu.
echo   Mong doi: %HASH%
echo   Thuc te : %GOT%
del /f /q "%NAME%" >nul 2>&1
goto :fail

:done
echo.
echo Da tao file %NAME% trong thu muc nay. Bam dup de cai khi can.
:fail
pause
:end
