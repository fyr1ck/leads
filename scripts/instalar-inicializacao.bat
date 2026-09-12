@echo off
REM ============================================================
REM  Faz o painel abrir sozinho quando o Windows liga.
REM
REM  Cria uma tarefa agendada que roda o henvix.bat no logon.
REM  Para desfazer:  schtasks /Delete /TN "Henvix Sales OS" /F
REM ============================================================

setlocal
set TAREFA=Henvix Sales OS
set ALVO=%~dp0henvix.bat

echo.
echo  Vou registrar a tarefa "%TAREFA%" para iniciar no logon:
echo    %ALVO%
echo.
choice /C SN /M "Confirma"
if errorlevel 2 goto fim

schtasks /Create /TN "%TAREFA%" /TR "\"%ALVO%\"" /SC ONLOGON /RL HIGHEST /F

if errorlevel 1 (
  echo.
  echo  Nao consegui criar a tarefa. Tente abrir este arquivo como Administrador.
) else (
  echo.
  echo  Pronto. O painel vai subir sozinho no proximo login do Windows.
  echo  Para testar agora:      schtasks /Run /TN "%TAREFA%"
  echo  Para remover depois:    schtasks /Delete /TN "%TAREFA%" /F
)

:fim
echo.
pause
endlocal
