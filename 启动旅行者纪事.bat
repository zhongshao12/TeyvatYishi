@echo off
chcp 65001 >nul
title 旅行者纪事 - 本地服务
cd /d "%~dp0"
echo ==========================================
echo   旅行者纪事 · 本地一键启动
echo   浏览器将自动打开 http://localhost:3000/
echo   关闭本窗口即可停止服务
echo ==========================================

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 pnpm。请先执行: npm install -g pnpm
  pause
  exit /b 1
)

REM 6 秒后自动打开浏览器（等服务就绪）
start "" /min cmd /c "timeout /t 6 /nobreak >nul && start "" http://localhost:3000/"

call pnpm dev

echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul
