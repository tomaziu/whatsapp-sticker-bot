@echo off
title WhatsApp Sticker Bot
setlocal

set "PROJECT_DIR=%~dp0"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LOG_FILE=%PROJECT_DIR%logs\startup.log"

if not exist "%PROJECT_DIR%logs" mkdir "%PROJECT_DIR%logs"

echo.
echo ========================================
echo    WhatsApp Sticker Bot
echo ========================================
echo.
echo Pasta do projeto: %PROJECT_DIR%
echo Iniciando o bot...
echo.

cd /d "%PROJECT_DIR%"

if not exist "%NODE_EXE%" (
  echo Node.js nao encontrado em "%NODE_EXE%".
  echo Instale o Node.js ou ajuste NODE_EXE no iniciar.bat.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%node_modules" (
  echo node_modules nao encontrado.
  echo Rode npm install dentro de "%PROJECT_DIR%" antes de iniciar.
  pause
  exit /b 1
)

echo [%date% %time%] Iniciando em "%PROJECT_DIR%" >> "%LOG_FILE%"
echo.
echo Se precisar escanear o QR, abra manualmente:
echo http://localhost:3000
echo.

"%NODE_EXE%" "%PROJECT_DIR%index.js"
echo [%date% %time%] Bot encerrou com codigo %ERRORLEVEL% >> "%LOG_FILE%"

echo.
echo O bot encerrou. Veja o log em:
echo %LOG_FILE%
pause
