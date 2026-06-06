@echo off
cd /d C:\Users\Deamon\Desktop\Backup\Serveur MCP\Workflow
echo [OVERMIND STARTING] > logs\overmind-test.log
node dist\index.js >> logs\overmind-test.log 2>&1