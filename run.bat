@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  GLM Coding Max套餐 连续包季 抢购脚本
echo ========================================
echo.
echo [%time%] 开始执行...
node purchase.js
pause
