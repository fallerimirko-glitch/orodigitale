# set-secrets.ps1
# Interactive helper to set EXTERNAL_MODEL_URL and EXTERNAL_API_KEY on the local server
# Usage: Run this from the project root using PowerShell: .\scripts\set-secrets.ps1

Param()

Write-Host "This script will POST your programmatic endpoint and API key to the local admin API"
$endpoint = Read-Host "Programmatic endpoint URL (e.g. https://api.ai.studio/v1/apps/APP_ID/predict)"
if ([string]::IsNullOrWhiteSpace($endpoint)) { Write-Error "Endpoint is required. Aborting."; exit 1 }

# Ask for API key securely
$keySecure = Read-Host "API key (input is hidden)" -AsSecureString
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto($keyPtr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)

# Which header to use
$headerName = Read-Host "Header name to send the key (default: Authorization)"; if (-not $headerName) { $headerName = 'Authorization' }
$prefix = Read-Host "Key prefix (default: 'Bearer ')"; if (-not $prefix) { $prefix = 'Bearer ' }

# Admin password for protected endpoint
$adminPass = Read-Host "ADMIN_PASSWORD (current admin password to authorize the change)" -AsSecureString
$adminPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPass)
$adminPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($adminPtr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr)

# Build JSON body
$body = @{ EXTERNAL_MODEL_URL = $endpoint; EXTERNAL_API_KEY = $key; EXTERNAL_API_HEADER = $headerName; EXTERNAL_API_KEY_PREFIX = $prefix } | ConvertTo-Json

try {
    $headers = @{ 'X-Admin-Password' = $adminPlain; 'Content-Type' = 'application/json' }
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/admin/config' -Method Post -Headers $headers -Body $body -TimeoutSec 20
    Write-Host "Server response:`n" (ConvertTo-Json $resp -Depth 5)
    Write-Host "If OK, the server now has the runtime config and will use it immediately. I will then test /api/admin/external-preview and send a sample /api/chat query."
} catch {
    Write-Error "Failed to POST to local admin API: $_"
    Write-Host "If you don't have an ADMIN_PASSWORD set, you can run the insecure endpoint instead (not recommended):"
    Write-Host "Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/admin/config/insecure' -Method Post -Body (ConvertTo-Json @{ EXTERNAL_MODEL_URL = '$endpoint'; EXTERNAL_API_KEY = '***' }) -ContentType 'application/json'"
}

# Zero sensitive variables in memory
$key = $null; $adminPlain = $null

Write-Host "Done."