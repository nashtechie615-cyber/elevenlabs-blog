# Registers a Windows scheduled task that runs scripts\run-generator.bat
# every day at 12:00 AM Central Time. Run this PowerShell file once, as your user
# (not as Administrator — a user-level task is fine here).
#
# To remove the task later:  Unregister-ScheduledTask -TaskName "ElevenLabsDailyPosts" -Confirm:$false

$ErrorActionPreference = 'Stop'

$TaskName = 'ElevenLabsDailyPosts'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BatchFile = Join-Path $PSScriptRoot 'run-generator.bat'

if (-not (Test-Path $BatchFile)) {
    Write-Error "Could not find $BatchFile"
    exit 1
}

# Detect whether this machine is on Central Time. If yes, a plain 12:00 AM
# trigger fires at midnight Central. If not, translate to local time.
$tz = (Get-TimeZone).Id
$isCentral = $tz -match 'Central Standard|Central Daylight|CST|CDT'

if ($isCentral) {
    $triggerTime = '12:00AM'
    Write-Host "Machine is in $tz — scheduling for 12:00 AM local (= Central)."
} else {
    # Compute 00:00 Central as a local time on this machine.
    $centralTz = [TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
    $todayCentral = [DateTime]::UtcNow.Date.AddDays(1)  # tomorrow 00:00 UTC as a seed
    $centralMidnight = [TimeZoneInfo]::ConvertTimeToUtc(
        (Get-Date -Year (Get-Date).Year -Month (Get-Date).Month -Day (Get-Date).Day -Hour 0 -Minute 0 -Second 0),
        $centralTz
    )
    $localEquivalent = $centralMidnight.ToLocalTime()
    $triggerTime = $localEquivalent.ToString('h:mmtt')
    Write-Host "Machine is in $tz — scheduling for $triggerTime local (= 12:00 AM Central)."
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$BatchFile`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

# Remove existing task with same name if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Existing task '$TaskName' found. Replacing it."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'Generates 3 ElevenLabs blog posts daily at 12 AM Central.' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

Write-Host ""
Write-Host "Task '$TaskName' registered."
Write-Host "Next run time:"
(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).NextRunTime

Write-Host ""
Write-Host "To test immediately:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "To view the log:      Get-Content scripts\generator.log -Tail 50"
Write-Host "To remove:            Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
