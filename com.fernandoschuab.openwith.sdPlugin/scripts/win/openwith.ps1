# Open With - Windows helper (Windows PowerShell 5.1).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -STA -File openwith.ps1 -Cmd <pick|icons|apps|lang> -Arg <base64 utf-8 json>
# Output: base64 of a UTF-8 JSON object { ok: bool, ... } written to stdout.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts using the ANSI code page.
param(
    [string]$Cmd = '',
    [string]$Arg = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Result($obj) {
    $json = ConvertTo-Json -InputObject $obj -Depth 6 -Compress
    [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
}

function Read-Arg {
    if ([string]::IsNullOrEmpty($Arg)) { return New-Object PSObject }
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Arg))
    return (ConvertFrom-Json -InputObject $text)
}

function Test-NativeLoaded {
    return [bool]('OpenWithNative.Shell' -as [type])
}

# Compiles Native.cs once and caches the DLL in %LOCALAPPDATA%; falls back to in-memory compilation.
function Import-Native {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    if (Test-NativeLoaded) { return }

    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Native.cs'))
    $sha = [Security.Cryptography.SHA1]::Create()
    $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-', '').Substring(0, 12)
    $base = $env:LOCALAPPDATA
    if ([string]::IsNullOrEmpty($base)) { $base = [IO.Path]::GetTempPath() }
    $cacheDir = Join-Path $base 'com.fernandoschuab.openwith'
    $dll = Join-Path $cacheDir ('OpenWithNative-' + $hash + '.dll')
    $refs = @('System.Drawing', 'System.Windows.Forms')

    if (-not (Test-Path -LiteralPath $dll)) {
        try {
            New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
            Add-Type -TypeDefinition $source -ReferencedAssemblies $refs -OutputAssembly $dll -OutputType Library
        } catch { }
    }
    if ((-not (Test-NativeLoaded)) -and (Test-Path -LiteralPath $dll)) {
        try { Add-Type -Path $dll } catch { }
    }
    if (-not (Test-NativeLoaded)) {
        Add-Type -TypeDefinition $source -ReferencedAssemblies $refs
    }
}

function Invoke-Pick($a) {
    Import-Native
    [System.Windows.Forms.Application]::EnableVisualStyles()

    # Invisible top-most owner window so the dialog opens in front of other windows.
    $owner = New-Object System.Windows.Forms.Form
    $owner.ShowInTaskbar = $false
    $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.Opacity = 0
    $owner.TopMost = $true
    $owner.Show()
    $owner.Activate()
    [void][OpenWithNative.Shell]::SetForegroundWindow($owner.Handle)

    try {
        $folders = ([string]$a.kind -eq 'folder')
        $paths = [OpenWithNative.Shell]::Pick(
            $owner.Handle, $folders, [bool]$a.multiple,
            [string]$a.title, [string]$a.initialDir,
            [string]$a.filterName, [string]$a.filterSpec)
    } finally {
        $owner.Close()
        $owner.Dispose()
    }

    $names = @{}
    if ([string]$a.kind -eq 'app') {
        foreach ($p in $paths) {
            try {
                $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p)
                $label = $info.FileDescription
                if ([string]::IsNullOrWhiteSpace($label)) { $label = $info.ProductName }
                if (-not [string]::IsNullOrWhiteSpace($label)) { $names[$p] = $label.Trim() }
            } catch { }
        }
    }
    Write-Result @{ ok = $true; paths = @($paths); names = $names }
}

function Invoke-Icons($a) {
    $nativeOk = $true
    try { Import-Native } catch { $nativeOk = $false; Add-Type -AssemblyName System.Drawing }
    $results = New-Object System.Collections.ArrayList
    foreach ($j in @($a.jobs)) {
        $ok = $false
        $app = [string]$j.app
        $out = [string]$j.out
        $size = [int]$j.size
        if ($nativeOk) {
            try { $ok = [OpenWithNative.Shell]::SaveIcon($app, $out, $size) } catch { $ok = $false }
        }
        if (-not $ok) {
            try {
                $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($app)
                $bmp = $icon.ToBitmap()
                $dst = New-Object System.Drawing.Bitmap($size, $size)
                $g = [System.Drawing.Graphics]::FromImage($dst)
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.DrawImage($bmp, 0, 0, $size, $size)
                $g.Dispose()
                $dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
                $dst.Dispose(); $bmp.Dispose(); $icon.Dispose()
                $ok = $true
            } catch { $ok = $false }
        }
        [void]$results.Add($ok)
    }
    Write-Result @{ ok = $true; results = @($results) }
}

function Invoke-Apps {
    $roots = @(
        [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms),
        [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $shell = New-Object -ComObject WScript.Shell
    $seen = @{}
    $apps = New-Object System.Collections.ArrayList
    foreach ($root in $roots) {
        $links = Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue
        foreach ($link in $links) {
            try {
                $target = [string]$shell.CreateShortcut($link.FullName).TargetPath
                if ([string]::IsNullOrEmpty($target)) { continue }
                if (-not $target.ToLowerInvariant().EndsWith('.exe')) { continue }
                if (-not (Test-Path -LiteralPath $target)) { continue }
                $key = $target.ToLowerInvariant()
                if ($seen.ContainsKey($key)) { continue }
                $seen[$key] = $true
                [void]$apps.Add(@{ name = $link.BaseName; path = $target })
            } catch { }
        }
    }
    Write-Result @{ ok = $true; apps = @($apps) }
}

function Invoke-Lang {
    Write-Result @{
        ok      = $true
        ui      = [Globalization.CultureInfo]::CurrentUICulture.Name
        culture = [Globalization.CultureInfo]::CurrentCulture.Name
    }
}

try {
    $a = Read-Arg
    switch ($Cmd) {
        'pick'  { Invoke-Pick $a }
        'icons' { Invoke-Icons $a }
        'apps'  { Invoke-Apps }
        'lang'  { Invoke-Lang }
        default { Write-Result @{ ok = $false; error = ('Unknown command: ' + $Cmd) } }
    }
} catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message }
}
