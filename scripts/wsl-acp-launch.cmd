@echo off
setlocal EnableExtensions
REM Host launcher for WSL pure-ACP agents (Grok, customs).
REM Sets ELECTRON_RUN_AS_NODE + BABY_MENU_* then runs Electron-as-node on the proxy.
REM
REM Args:
REM   %1 electron/Baby Menu Dev.exe
REM   %2 wsl-acp-proxy.mjs
REM   %3 WSL distro (e.g. Ubuntu)
REM   %4 host extensions cwd (Windows path) for BABY_MENU_WSL_PROXY_CWD
REM   %5+ agent command tokens (e.g. grok agent stdio)

if "%~1"=="" (
  echo wsl-acp-launch: missing electron exe 1>&2
  exit /b 2
)
if "%~2"=="" (
  echo wsl-acp-launch: missing wsl-acp-proxy.mjs 1>&2
  exit /b 2
)

set "ELECTRON_RUN_AS_NODE=1"
set "EXE=%~1"
set "PROXY=%~2"
set "DISTRO=%~3"
set "BABY_MENU_WSL_DISTRO=%~3"
set "BABY_MENU_WSL_PROXY_CWD=%~4"

REM Collect agent tokens from %5 onward (shift moves the window).
set "AGENT_ARGS="
:collect
if "%~5"=="" goto run
set AGENT_ARGS=%AGENT_ARGS% %5
shift
goto collect

:run
"%EXE%" "%PROXY%" --distro "%DISTRO%" --%AGENT_ARGS%
exit /b %ERRORLEVEL%
