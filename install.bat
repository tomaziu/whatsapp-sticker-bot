@echo off
chcp 65001 >nul
title WhatsApp Sticker Bot - Instalador Automatico

echo ============================================
echo  WhatsApp Sticker Bot - Instalacao Automatica
echo ============================================
echo.

set INSTALL_OK=0

REM Verificar se Node.js esta instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Por favor, instale o Node.js 20+ em: https://nodejs.org/
    goto END
)

echo [OK] Node.js detectado: 
node --version

REM Verificar se npm esta disponivel
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] npm nao encontrado!
    goto END
)

echo [OK] npm detectado:
npm --version

echo.
echo ============================================
echo  Instalando dependencias...
echo ============================================
echo.

npm install

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha na instalacao das dependencias!
    echo Tente executar manualmente: npm install
    goto END
)

set INSTALL_OK=1

echo.
echo ============================================
echo  Instalacao concluida com sucesso!
echo ============================================
echo.
echo Para iniciar o bot, execute:
echo   npm start
echo.
echo Ou clique duas vezes no arquivo: iniciar.bat
echo.
echo O QR Code aparecera em: http://localhost:3000
echo.

:END
echo.
echo ============================================
if %INSTALL_OK%==1 (
    echo  Status: SUCESSO
) else (
    echo  Status: FALHOU
)
echo ============================================
echo.
pause