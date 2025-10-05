@echo off
setlocal
call "%~dp0selftest.bat"
if errorlevel 1 goto :error
pyinstaller FlowViz.spec --noconfirm
if errorlevel 1 goto :error
powershell -NoLogo -NoProfile -Command "Compress-Archive -Path dist/FlowViz.exe,app,config,logs -DestinationPath FlowViz-win64.zip -Force"
echo Build succeeded.
endlocal
exit /b 0
:error
echo Build failed.
endlocal
exit /b 1
