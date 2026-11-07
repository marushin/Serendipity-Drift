# 배포용 zip 생성: 확장 프로그램 런타임 파일만 dist/ 에 묶습니다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content manifest.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$files = @(
  'manifest.json',
  'background.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'popup.css',
  'sidepanel.html', 'sidepanel.js', 'sidepanel.css',
  'guide.html', 'guide.js',
  'offscreen.html', 'offscreen.js',
  'icons', 'src'
)

New-Item -ItemType Directory -Force dist | Out-Null
$out = Join-Path $root "dist\serendipity-drift-v$version.zip"
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path $files -DestinationPath $out
Write-Output "Created $out"
