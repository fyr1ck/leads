@echo off
REM ============================================================
REM  HENVIX SALES OS - mantem o painel no ar
REM
REM  Sobe o painel e, se o processo cair por qualquer motivo,
REM  levanta de novo sozinho depois de 10 segundos.
REM
REM  Uso manual:  clique duas vezes neste arquivo
REM  Automatico:  veja scripts/instalar-inicializacao.bat
REM ============================================================

title Henvix Sales OS
cd /d "%~dp0.."

REM painel e API na mesma porta em modo producao
set PORT=3000
set NODE_ENV=production

if not exist "client\dist\index.html" (
  echo.
  echo  O painel ainda nao foi compilado. Rodando o build uma vez...
  echo.
  call npm run build
)

if not exist "data" mkdir data

:loop
echo.
echo ============================================================
echo  Henvix Sales OS  -  http://localhost:%PORT%
echo  %date% %time%
echo ============================================================
echo.
echo [%date% %time%] iniciando >> "data\servico.log"

call npm start >> "data\servico.log" 2>&1

echo.
echo  O painel parou. Reiniciando em 10 segundos...
echo  (feche esta janela para desligar de vez)
echo.
echo [%date% %time%] caiu - reiniciando >> "data\servico.log"
timeout /t 10 /nobreak >nul
goto loop
