# 배포용 zip 생성: 확장 프로그램 런타임 파일만 dist/ 에 묶습니다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content manifest.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$files = @(
  'manifest.json',
  'background.js', 'content.js', 'content.css', 'stage-eye.js',
  'popup.html', 'popup.js', 'popup.css',
  'sidepanel.html', 'sidepanel.js', 'sidepanel.css',
  'guide.html', 'guide.js',
  'offscreen.html', 'offscreen.js',
  'icons', 'src'
)

New-Item -ItemType Directory -Force dist | Out-Null
$out = Join-Path $root "dist\serendipity-drift-v$version.zip"
if (Test-Path $out) { Remove-Item $out -Force }

# Compress-Archive(PS 5.1)는 zip 항목 경로를 역슬래시로 기록하므로, 표준(/) 경로로 직접 씁니다.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($item in $files) {
    $entries = if (Test-Path $item -PathType Container) { Get-ChildItem $item -Recurse -File } else { Get-Item $item }
    foreach ($f in $entries) {
      $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, 'Optimal') | Out-Null
    }
  }
} finally {
  $zip.Dispose()
}
Write-Output "Created $out"
