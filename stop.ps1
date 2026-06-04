<#
.SYNOPSIS
  Stop Antigravity Proxy and revert system changes.
.DESCRIPTION
  Kills the proxy, removes hosts entries for Google APIs, and removes the
  trusted self-signed certificate from the system store.
  Run as Administrator.
#>

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $PSCommandPath
$ProxyDir = Join-Path $ScriptDir 'proxy'

function Write-Info  { Write-Host "  $args" -Foreground Cyan }
function Write-Ok    { Write-Host "  OK $args" -Foreground Green }
function Write-Warn  { Write-Host "  !! $args" -Foreground Yellow }
function Write-Step  { Write-Host "`n==> $args" -Foreground Magenta }

# -- Admin check --------------------------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
  Write-Warn "Must be run as Administrator to revert system changes."
  $choice = Read-Host "Restart as Administrator? (Y/n)"
  if ($choice -ne 'n' -and $choice -ne 'N') {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -Command Set-Location '$ScriptDir'; & '$PSCommandPath'"
    exit
  }
  Write-Warn "Running without Admin - some cleanup may fail."
}

# -- 1. Kill proxy ------------------------------------------------------------
Write-Step "Stopping proxy"
$proxyPids = @(Get-Process -Name "node", "tsx" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -match "index.ts"
} | ForEach-Object { $_.Id })

if ($proxyPids.Count -gt 0) {
  foreach ($pid in $proxyPids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Ok "Killed proxy process (PID $pid)"
  }
} else {
  # Also try by port
  $portPid = (netstat -ano | Select-String ':4040 ' | ForEach-Object { ($_ -split '\s+')[-1] }) | Where-Object { $_ -ne '0' } | Select-Object -First 1
  if ($portPid) {
    Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    Write-Ok "Killed process on port 4040 (PID $portPid)"
  } else {
    Write-Ok "No proxy process found"
  }
}

# Wait for port to free
Start-Sleep -Seconds 1

# -- 2. Remove hosts entries --------------------------------------------------
Write-Step "Cleaning hosts file"
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$domains = @('cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com')

if (Test-Path $hostsPath) {
  $hostsContent = Get-Content -Path $hostsPath -Raw
  if ([string]::IsNullOrEmpty($hostsContent)) {
    Write-Ok "No proxy hosts entries found"
  } else {
    $originalContent = $hostsContent
    foreach ($domain in $domains) {
      $hostsContent = ($hostsContent -split "`r?`n" | Where-Object { $_ -notmatch [regex]::Escape($domain) }) -join "`r`n"
    }
    if ($hostsContent -ne $originalContent) {
      Set-Content -Path $hostsPath -Value $hostsContent -Force
      Write-Ok "Removed hosts entries for Google APIs"
    } else {
      Write-Ok "No proxy hosts entries found"
    }
  }
} else {
  Write-Warn "Hosts file not found at $hostsPath"
}

# -- 3. Remove trusted cert ---------------------------------------------------
Write-Step "Removing trusted certificate"
$certFile = Join-Path (Join-Path $ProxyDir 'certs') 'cert.pem'
if (Test-Path $certFile) {
  try {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certFile
    $thumbprint = $cert.Thumbprint

    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store -ArgumentList "Root", "LocalMachine"
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }
    if ($found) {
      $store.Remove($found)
      Write-Ok "Removed certificate '$($cert.Subject)' from Trusted Root store"
    } else {
      # Also check CurrentUser store
      $store.Close()
      $store = New-Object System.Security.Cryptography.X509Certificates.X509Store -ArgumentList "Root", "CurrentUser"
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }
      if ($found) {
        $store.Remove($found)
        Write-Ok "Removed certificate '$($cert.Subject)' from CurrentUser Trusted Root store"
      } else {
        Write-Ok "Certificate not found in Trusted Root stores"
      }
    }
    $store.Close()
    $cert.Dispose()
  } catch {
    Write-Warn "Could not process certificate: $_"
  }
} else {
  Write-Ok "No certificate file at $certFile"
}

# -- Summary ------------------------------------------------------------------
Write-Step "Cleanup complete!"
Write-Info "  Proxy stopped"
Write-Info "  Hosts file restored"
Write-Info "  Certificate removed"
Write-Info ""
Write-Info "  Antigravity will now connect directly to Google APIs."
