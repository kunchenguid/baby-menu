@echo off
setlocal EnableExtensions
REM ---------------------------------------------------------------------------
REM DEPRECATED for acpx registry launch (do not use as spawn command).
REM
REM acpx sets shell:true for .cmd/.bat. On Windows that re-joins argv through
REM cmd.exe /d /s /c, which breaks paths with spaces (Baby Menu Dev.exe → Baby,
REM exit 9009 / "no se reconoce como un comando").
REM
REM Production path (see agent-runtime-mode / app.ts):
REM   spawn process.execPath + wsl-acp-proxy.mjs with ELECTRON_RUN_AS_NODE=1
REM   on the parent env (CreateProcess, shell:false — spaces safe).
REM
REM This file remains for manual debugging only:
REM   set ELECTRON_RUN_AS_NODE=1
REM   set BABY_MENU_WSL_DISTRO=Ubuntu
REM   set BABY_MENU_WSL_PROXY_CWD=C:\Users\you\.baby-menu\extensions
REM   wsl-acp-launch.cmd "C:\path\Baby Menu Dev.exe" "C:\path\wsl-acp-proxy.mjs" Ubuntu "C:\path\extensions" grok agent stdio
REM ---------------------------------------------------------------------------

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
if "%DISTRO%"=="" set "DISTRO=Ubuntu"
set "BABY_MENU_WSL_DISTRO=%DISTRO%"
if not "%~4"=="" set "BABY_MENU_WSL_PROXY_CWD=%~4"

set "AGENT_ARGS="
:collect
if "%~5"=="" goto run
set AGENT_ARGS=%AGENT_ARGS% %5
shift
goto collect

:run
"%EXE%" "%PROXY%" --distro "%DISTRO%" --%AGENT_ARGS%
exit /b %ERRORLEVEL%
