@echo off
chcp 65001 >nul
echo ========================================
echo   同步 Codex 登录信息到 WSL
echo ========================================
echo.

set "WIN_AUTH=C:\Users\hjzjw\.codex\auth.json"
set "WSL_AUTH_DIR=/home/%USERNAME%/.codex"

echo [1/3] 检查 Windows 认证文件...
if not exist "%WIN_AUTH%" (
    echo ❌ 错误: Windows 认证文件不存在
    echo    路径: %WIN_AUTH%
    pause
    exit /b 1
)
echo ✓ Windows 认证文件存在

echo.
echo [2/3] 在 WSL 中创建 .codex 目录...
wsl -d Ubuntu-24.04 bash -c "mkdir -p %WSL_AUTH_DIR%"
echo ✓ 目录已创建

echo.
echo [3/3] 复制认证文件到 WSL...
wsl -d Ubuntu-24.04 bash -c "cat > %WSL_AUTH_DIR%/auth.json" < "%WIN_AUTH%"
if %errorlevel% equ 0 (
    echo ✓ 认证文件同步成功！
    echo.
    echo 验证 WSL 中的文件:
    wsl -d Ubuntu-24.04 bash -c "ls -lh %WSL_AUTH_DIR%/auth.json"
) else (
    echo ❌ 同步失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo   同步完成！
echo ========================================
pause
