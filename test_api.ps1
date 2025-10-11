param(
    [string]$Question = "Quali sono i prezzi?",
    [string]$Url = "http://localhost:3001/api/chat"
)

$body = @{ question = $Question } | ConvertTo-Json
$headers = @{}
if ($env:TEST_TOKEN) { $headers.Add('X-TEST-TOKEN',$env:TEST_TOKEN) }

Write-Host "POST $Url`nQuestion: $Question"
try {
    $resp = Invoke-RestMethod -Uri $Url -Method POST -Body $body -ContentType 'application/json' -Headers $headers -ErrorAction Stop
    Write-Host "Response:`n" ($resp | ConvertTo-Json -Depth 10)
} catch {
    Write-Error "Request failed:`n$_"
}
