param([string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Blender)) { throw 'Set -Blender to your installed blender.exe.' }
node (Join-Path $PSScriptRoot 'export-world-layout.mjs')
if ($LASTEXITCODE -ne 0) { throw 'World data export failed.' }
& $Blender --background --factory-startup --python (Join-Path $PSScriptRoot 'blender/build_world.py')
if ($LASTEXITCODE -ne 0) { throw 'Blender asset build failed.' }
& $Blender --background --factory-startup --python (Join-Path $PSScriptRoot 'blender/build_characters.py')
if ($LASTEXITCODE -ne 0) { throw 'Blender character build failed.' }
node (Join-Path $PSScriptRoot 'compile-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Meep asset compilation failed.' }
