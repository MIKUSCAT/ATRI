@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem -----------------------------------------------
rem ATRI Worker One-Click Deploy (Windows .bat)
rem - Deploy only (no resource creation)
rem - Does NOT print your secrets
rem -----------------------------------------------

rem Optional: try UTF-8 output (may still vary by terminal)
chcp 65001 >nul 2>&1

echo ========================================
echo   ATRI Worker Deploy
echo ========================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.." || goto :fail
set "ROOT_DIR=%CD%"
set "WORKER_DIR=%ROOT_DIR%\worker"

echo Project root: %ROOT_DIR%
echo Worker dir:   %WORKER_DIR%
echo.

if not exist "%WORKER_DIR%\wrangler.toml" (
  echo [ERROR] Missing: %WORKER_DIR%\wrangler.toml
  echo Please check your folder structure.
  goto :pause_fail
)

if not exist "%WORKER_DIR%\package.json" (
  echo [ERROR] Missing: %WORKER_DIR%\package.json
  echo Please check your folder structure.
  goto :pause_fail
)

rem Basic environment checks
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  goto :pause_fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please reinstall Node.js.
  goto :pause_fail
)

echo [1/4] Installing dependencies...
cd /d "%WORKER_DIR%" || goto :fail

if exist "package-lock.json" (
  call npm ci
  if errorlevel 1 (
    echo [WARN] npm ci failed, fallback to npm install...
    call npm install
    if errorlevel 1 goto :pause_fail
  )
) else (
  call npm install
  if errorlevel 1 goto :pause_fail
)

echo.
echo [2/4] Syncing prompts (optional)...
call npm run sync-prompts
if errorlevel 1 (
  echo [WARN] sync-prompts failed (Python may be missing). Continue...
)

echo.
echo [3/4] Checking Cloudflare login...
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo Not logged in. Running: wrangler login
  call npx wrangler login
  if errorlevel 1 goto :pause_fail
)

echo.
echo Checking wrangler.toml placeholders...
findstr /c:"your-account-id" "wrangler.toml" >nul 2>&1 && (
  echo [WARN] account_id is still "your-account-id". You probably need to edit worker\wrangler.toml.
)
findstr /c:"your-d1-id" "wrangler.toml" >nul 2>&1 && (
  echo [WARN] database_id is still "your-d1-id". You probably need to edit worker\wrangler.toml.
)

echo.
echo This Worker needs secrets: OPENAI_API_KEY and EMBEDDINGS_API_KEY
echo (Optional: DIARY_API_KEY, ADMIN_API_KEY, APP_TOKEN)
echo.
choice /c YN /m "Set/Update secrets now?"
if errorlevel 2 goto :deploy

echo.
echo Setting required secrets (input is hidden by wrangler)...
call npx wrangler secret put OPENAI_API_KEY
if errorlevel 1 goto :pause_fail
call npx wrangler secret put EMBEDDINGS_API_KEY
if errorlevel 1 goto :pause_fail

echo.
choice /c YN /m "Set DIARY_API_KEY (optional)?"
if errorlevel 1 (
  call npx wrangler secret put DIARY_API_KEY
  if errorlevel 1 goto :pause_fail
)

echo.
choice /c YN /m "Set ADMIN_API_KEY (optional)?"
if errorlevel 1 (
  call npx wrangler secret put ADMIN_API_KEY
  if errorlevel 1 goto :pause_fail
)

echo.
choice /c YN /m "Set APP_TOKEN (optional, protects some endpoints)?"
if errorlevel 1 (
  call npx wrangler secret put APP_TOKEN
  if errorlevel 1 goto :pause_fail
)

:deploy
echo.
echo [4/4] Deploying...
call npx wrangler deploy -c wrangler.toml
if errorlevel 1 goto :pause_fail

echo.
echo ========================================
echo   Deploy Complete
echo ========================================
echo.
echo If you changed secrets/config, it may take a moment to take effect.
echo.
pause
exit /b 0

:pause_fail
echo.
echo [ERROR] Deploy failed. Please read the messages above.
echo.
pause
exit /b 1

:fail
echo.
echo [ERROR] Unexpected failure.
echo.
pause
exit /b 1
