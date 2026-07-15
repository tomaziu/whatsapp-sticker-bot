@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "BAT_PATH=%PROJECT_DIR%iniciar.bat"
set "SHORTCUT_NAME=WhatsApp Sticker Bot.lnk"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\%SHORTCUT_NAME%"

if not exist "%BAT_PATH%" (
  echo Nao achei "%BAT_PATH%".
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT_PATH%'); $shortcut.TargetPath = '%BAT_PATH%'; $shortcut.WorkingDirectory = '%PROJECT_DIR%'; $shortcut.WindowStyle = 1; $shortcut.Description = 'Inicia o WhatsApp Sticker Bot'; $shortcut.Save()"

echo.
echo Atalho criado no Startup:
echo %SHORTCUT_PATH%
echo.
echo O bot vai iniciar junto com o Windows.
pause
