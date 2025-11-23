@echo off
chcp 65001 >nul
echo ========================================
echo   启动 WSL Codex
echo ========================================
echo.

set "WIN_AUTH=C:\Users\hjzjw\.codex\auth.json"
set "WSL_AUTH=/home/%USERNAME%/.codex/auth.json"

echo [检查] 验证认证文件...
wsl -d Ubuntu-24.04 bash -c "test -f %WSL_AUTH%" 2>nul
if %errorlevel% neq 0 (
    echo ⚠ WSL 中未找到认证文件，正在同步...
    echo.

    if not exist "%WIN_AUTH%" (
        echo ❌ 错误: Windows 认证文件不存在
        echo    请先在 Windows 中登录 codex
        pause
        exit /b 1
    )

    wsl -d Ubuntu-24.04 bash -c "mkdir -p ~/.codex && cat > ~/.codex/auth.json" < "%WIN_AUTH%"
    echo ✓ 认证文件已同步
    echo.
) else (
    echo ✓ 认证文件已存在
    echo.
)

echo [启动] 正在启动 Codex...
echo ========================================
echo.

wsl -d Ubuntu-24.04 bash -c "source ~/.bashrc && cd /mnt/e/ATRI && codex"
