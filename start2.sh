#!/bin/bash
echo "Starting SSH..."
service ssh start

npm install --no-save puppeteer

echo "Starting Function Host..."
dotnet "/azure-functions-host/Microsoft.Azure.WebJobs.Script.WebHost.dll"
