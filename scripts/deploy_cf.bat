@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem -----------------------------------------------
rem ATRI Worker One-Click Deploy (Windows .bat)
rem - Creates resources: D1 + R2 + Vectorize
rem - Updates worker\wrangler.toml (name/bindings/account_id/database_id)
rem - Does NOT print your secrets
rem -----------------------------------------------

rem Optional: try UTF-8 output (safe even for English-only)
chcp 65001 >nul 2>&1

echo ========================================
echo   ATRI Worker One-Click Deploy
echo ========================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.." || goto :fail
set "ROOT_DIR=%CD%"
set "WORKER_DIR=%ROOT_DIR%\worker"
set "WRANGLER_TOML=%WORKER_DIR%\wrangler.toml"

echo Project root: %ROOT_DIR%
echo Worker dir:   %WORKER_DIR%
echo.

if not exist "%WRANGLER_TOML%" (
  echo [ERROR] Missing: %WRANGLER_TOML%
  echo Please check your folder structure.
  goto :pause_fail
)

if not exist "%WORKER_DIR%\package.json" (
  echo [ERROR] Missing: %WORKER_DIR%\package.json
  echo Please check your folder structure.
  goto :pause_fail
)

if not exist "%WORKER_DIR%\db\schema.sql" (
  echo [ERROR] Missing: %WORKER_DIR%\db\schema.sql
  echo Please check your folder structure.
  goto :pause_fail
)

rem Basic environment checks
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  goto :pause_fail
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if %NODE_MAJOR% LSS 18 (
  echo [ERROR] Node.js 18+ required. Current:
  node -v
  goto :pause_fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please reinstall Node.js.
  goto :pause_fail
)

where npx >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npx not found. Please reinstall Node.js.
  goto :pause_fail
)

rem Proxy helper (optional)
if not defined HTTP_PROXY if not defined HTTPS_PROXY (
  echo.
  echo Proxy tip: if your network needs a proxy, you can set HTTP_PROXY and HTTPS_PROXY.
  echo Example: http://127.0.0.1:7890
  choice /c YN /m "Use local proxy http://127.0.0.1:7890 for this run?"
  if errorlevel 2 goto :proxy_done
  set "HTTP_PROXY=http://127.0.0.1:7890"
  set "HTTPS_PROXY=http://127.0.0.1:7890"
  set "NO_PROXY=127.0.0.1,localhost"
  echo Proxy enabled for this run.
)
:proxy_done

rem Defaults
set "WORKER_NAME=atri-worker"
set "D1_NAME=atri_diary"
set "R2_NAME=atri-media"
set "VEC_NAME=atri-memories"

echo.
echo === Resource names (press Enter for defaults) ===
set /p "WORKER_NAME=Worker name [%WORKER_NAME%]: "
if "%WORKER_NAME%"=="" set "WORKER_NAME=atri-worker"

set /p "D1_NAME=D1 database name [%D1_NAME%]: "
if "%D1_NAME%"=="" set "D1_NAME=atri_diary"

set /p "R2_NAME=R2 bucket name [%R2_NAME%]: "
if "%R2_NAME%"=="" set "R2_NAME=atri-media"

set /p "VEC_NAME=Vectorize index name [%VEC_NAME%]: "
if "%VEC_NAME%"=="" set "VEC_NAME=atri-memories"

echo [1/6] Installing dependencies...
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
echo [2/6] Syncing prompts (optional)...
call npm run sync-prompts
if errorlevel 1 (
  echo [WARN] sync-prompts failed (Python may be missing). Continue...
)

echo.
echo [3/6] Checking Cloudflare login...
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  echo Not logged in. Running: wrangler login
  call npx wrangler login
  if errorlevel 1 goto :pause_fail
)

echo.
echo [4/6] Creating / resolving resources...

set "TMP_WHOAMI=%TEMP%\atri_whoami.txt"
call npx wrangler whoami > "%TMP_WHOAMI%" 2>&1
set "ACCOUNT_ID="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$t=Get-Content -Raw '%TMP_WHOAMI%'; $m=[regex]::Match($t,'(?i)account\\s*id\\s*[:=]\\s*([0-9a-f]{32})'); if($m.Success){$m.Groups[1].Value}else{''}"`) do set "ACCOUNT_ID=%%I"

if "%ACCOUNT_ID%"=="" (
  echo [WARN] Failed to detect account_id automatically.
  echo You can find it in Cloudflare Dashboard or via: npx wrangler whoami
  set /p "ACCOUNT_ID=Enter your account_id (32 hex chars): "
)

if "%ACCOUNT_ID%"=="" (
  echo [ERROR] account_id is required.
  goto :pause_fail
)

rem D1 create / resolve
set "TMP_D1_CREATE=%TEMP%\atri_d1_create.txt"
set "D1_ID="
call npx wrangler d1 create "%D1_NAME%" > "%TMP_D1_CREATE%" 2>&1
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$t=Get-Content -Raw '%TMP_D1_CREATE%'; $m=[regex]::Match($t,'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'); if($m.Success){$m.Value}else{''}"`) do set "D1_ID=%%I"

if "%D1_ID%"=="" (
  echo [WARN] Could not get database_id from create output. Trying to find existing D1 database...
  set "TMP_D1_LIST=%TEMP%\atri_d1_list.txt"
  call npx wrangler d1 list > "%TMP_D1_LIST%" 2>&1
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$name='%D1_NAME%'; $t=Get-Content -Raw '%TMP_D1_LIST%'; $line=($t -split \"`r?`n\" | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1); if($line){ [regex]::Match($line,'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}').Value }"`) do set "D1_ID=%%I"
)

if "%D1_ID%"=="" (
  echo [ERROR] Failed to resolve D1 database_id for "%D1_NAME%".
  echo Please create it manually then paste the database_id here.
  set /p "D1_ID=Enter database_id (UUID): "
)

if "%D1_ID%"=="" (
  echo [ERROR] database_id is required.
  goto :pause_fail
)

rem R2 (ignore errors if already exists)
call npx wrangler r2 bucket create "%R2_NAME%" >nul 2>&1

rem Vectorize (ignore errors if already exists)
call npx wrangler vectorize create "%VEC_NAME%" --dimensions=1024 --metric=cosine >nul 2>&1

rem Initialize D1 schema (safe to rerun)
call npx wrangler d1 execute "%D1_NAME%" --file=db/schema.sql >nul 2>&1
if errorlevel 1 (
  echo [WARN] Failed to execute D1 schema. You may need to run it manually:
  echo   npx wrangler d1 execute "%D1_NAME%" --file=db/schema.sql
)

echo.
echo Updating wrangler.toml...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$path=$args[0];$worker=$args[1];$acct=$args[2];$d1n=$args[3];$d1id=$args[4];$r2=$args[5];$vec=$args[6];" ^
  "$utf8 = New-Object System.Text.UTF8Encoding($false);" ^
  "$c = [System.IO.File]::ReadAllText($path, $utf8);" ^
  "$c = $c -replace '(?m)^name\\s*=\\s*\"[^\"]*\"', ('name = \"' + $worker + '\"');" ^
  "$c = $c -replace '(?m)^account_id\\s*=\\s*\"[^\"]*\"', ('account_id = \"' + $acct + '\"');" ^
  "$c = $c -replace '(?m)^\\s*index_name\\s*=\\s*\"[^\"]*\"', ('index_name = \"' + $vec + '\"');" ^
  "$c = $c -replace '(?m)^\\s*bucket_name\\s*=\\s*\"[^\"]*\"', ('bucket_name = \"' + $r2 + '\"');" ^
  "$c = $c -replace '(?m)^\\s*preview_bucket_name\\s*=\\s*\"[^\"]*\"', ('preview_bucket_name = \"' + $r2 + '\"');" ^
  "$c = $c -replace '(?m)^\\s*database_name\\s*=\\s*\"[^\"]*\"', ('database_name = \"' + $d1n + '\"');" ^
  "$c = $c -replace '(?m)^\\s*database_id\\s*=\\s*\"[^\"]*\"', ('database_id = \"' + $d1id + '\"');" ^
  "[System.IO.File]::WriteAllText($path, $c, $utf8);" ^
  "%WRANGLER_TOML%" "%WORKER_NAME%" "%ACCOUNT_ID%" "%D1_NAME%" "%D1_ID%" "%R2_NAME%" "%VEC_NAME%"
if errorlevel 1 (
  echo [ERROR] Failed to update wrangler.toml automatically.
  goto :pause_fail
)

echo.
echo [5/6] Setting secrets...
echo Required: OPENAI_API_KEY, EMBEDDINGS_API_KEY (SiliconFlow embeddings for vector memory)
echo Optional: DIARY_API_KEY, ADMIN_API_KEY, APP_TOKEN, MEDIA_SIGNING_KEY
echo.
choice /c YN /m "Set/Update secrets now?"
if errorlevel 2 goto :deploy

echo.
echo Setting OPENAI_API_KEY (input is hidden by wrangler)...
call npx wrangler secret put OPENAI_API_KEY
if errorlevel 1 goto :pause_fail

echo.
echo Setting EMBEDDINGS_API_KEY (embeddings/vector memory, input is hidden)...
echo NOTE: Vector memory defaults to SiliconFlow:
echo   EMBEDDINGS_API_URL = https://api.siliconflow.cn/v1
echo   EMBEDDINGS_MODEL   = BAAI/bge-m3
echo If your chat provider is also SiliconFlow, you can re-enter the same key.
call npx wrangler secret put EMBEDDINGS_API_KEY
if errorlevel 1 goto :pause_fail

:secrets_diary
echo.
choice /c YN /m "Set DIARY_API_KEY (optional)?"
if errorlevel 2 goto :secrets_admin
call npx wrangler secret put DIARY_API_KEY
if errorlevel 1 goto :pause_fail

:secrets_admin
echo.
choice /c YN /m "Set ADMIN_API_KEY (optional)?"
if errorlevel 2 goto :secrets_app_token
call npx wrangler secret put ADMIN_API_KEY
if errorlevel 1 goto :pause_fail

:secrets_app_token
echo.
choice /c YN /m "Set APP_TOKEN (recommended, protects API)?"
if errorlevel 2 goto :secrets_media_signing
call npx wrangler secret put APP_TOKEN
if errorlevel 1 goto :pause_fail

:secrets_media_signing
echo.
choice /c YN /m "Set MEDIA_SIGNING_KEY (optional, signed media URLs)?"
if errorlevel 2 goto :deploy
call npx wrangler secret put MEDIA_SIGNING_KEY
if errorlevel 1 goto :pause_fail

:deploy
echo.
echo [6/6] Deploying...
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
