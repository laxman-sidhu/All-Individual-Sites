@echo off
REM ============================================================
REM  update-gallery.bat  -  regenerate FileNames.json
REM  This file lives in the assets\ folder, NEXT TO the Gallery\
REM  folder and FileNames.json. Just double-click it.
REM  It scans assets\Gallery\ for images/videos and writes a
REM  valid FileNames.json into assets\ (same folder as this bat).
REM ============================================================
setlocal enabledelayedexpansion

REM Anchor everything to THIS script's own folder (assets\),
REM so it works no matter where it is launched from.
cd /d "%~dp0"

set "OUT=FileNames.json"

REM Start the JSON object + open the array
> "%OUT%" echo {"files":[

REM Walk every supported file. A leading comma is written before
REM every entry EXCEPT the first, so there is never a trailing comma.
set "FIRST=1"
for %%F in (Gallery\*.jpg Gallery\*.jpeg Gallery\*.png Gallery\*.gif Gallery\*.webp Gallery\*.avif Gallery\*.mp4 Gallery\*.webm Gallery\*.mov Gallery\*.m4v) do (
  if defined FIRST (
    set "FIRST="
    >> "%OUT%" echo   "%%~nxF"
  ) else (
    >> "%OUT%" echo   ,"%%~nxF"
  )
)

REM Close the array + object
>> "%OUT%" echo ]}

echo.
echo Done. FileNames.json regenerated inside the assets folder.
echo Now commit and push to GitHub.
echo.
pause
endlocal
