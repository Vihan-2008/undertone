# Undertone media helper.
# Reads the Windows media session (the same one behind the volume flyout's
# media controls) and writes one JSON object per line to stdout.
# Reads commands from stdin, one per line: toggle | play | pause | next | prev
# Exits when stdin closes (the app quit or crashed).

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, [Type]$type, [int]$timeout = 3000) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($timeout)) { throw "timeout" }
  return $task.Result
}

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$tManager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$tProps = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$tStream = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$tRAS = [Windows.Storage.Streams.IRandomAccessStream]
$tCTP = [Windows.Storage.Streams.IContentTypeProvider]
$readerCtor = [Windows.Storage.Streams.DataReader].GetConstructor([Type[]]@([Windows.Storage.Streams.IInputStream]))

try {
  $manager = Await ($tManager::RequestAsync()) $tManager 10000
} catch {
  Emit @{ type = 'error'; message = "Media session unavailable: $($_.Exception.Message)" }
  exit 1
}
Emit @{ type = 'ready' }

function Pick-Session {
  $sessions = @($manager.GetSessions())
  if ($sessions.Count -eq 0) { return $null }
  # Prefer whatever is playing; fall back to the system's current session.
  foreach ($s in $sessions) {
    try { if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $s } } catch {}
  }
  $cur = $manager.GetCurrentSession()
  if ($cur) { return $cur }
  return $sessions[0]
}

function Read-Cover($props) {
  if (-not $props.Thumbnail) { return $null }
  $stream = Await ($props.Thumbnail.OpenReadAsync()) $tStream
  # PowerShell only sees the stream as a bare COM object, so call its
  # interface members through reflection.
  $size = [uint32]$tRAS.GetProperty('Size').GetValue($stream)
  if ($size -eq 0 -or $size -gt 8MB) { return $null }
  $inStream = $tRAS.GetMethod('GetInputStreamAt').Invoke($stream, @([uint64]0))
  $reader = $readerCtor.Invoke(@($inStream))
  $task = $asTaskGeneric.MakeGenericMethod([uint32]).Invoke($null, @($reader.LoadAsync($size)))
  if (-not $task.Wait(3000)) { return $null }
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  $mime = [string]$tCTP.GetProperty('ContentType').GetValue($stream)
  if (-not $mime) { $mime = 'image/png' }
  $reader.Dispose()
  return @{ mime = $mime; data = [Convert]::ToBase64String($bytes); size = $size }
}

# Console.In.ReadLineAsync blocks in Windows PowerShell; a StreamReader over
# the raw stdin stream reads on a pool thread instead.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$readTask = $stdin.ReadLineAsync()
$lastKey = $null
$lastTimeline = $null
$lastStatus = $null
$coverTries = 0
$coverSize = -1
$trackChangedAt = [DateTime]::UtcNow
$session = $null

while ($true) {
  # Commands
  while ($readTask.IsCompleted) {
    $line = $readTask.Result
    if ($null -eq $line) { exit 0 }
    $cmd = $line.Trim()
    try {
      if ($session) {
        switch ($cmd) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'play'   { $null = Await ($session.TryPlayAsync()) ([bool]) }
          'pause'  { $null = Await ($session.TryPauseAsync()) ([bool]) }
          'next'   { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'prev'   { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
        }
      }
    } catch { Emit @{ type = 'error'; message = "Command '$cmd' failed: $($_.Exception.Message)" } }
    $readTask = $stdin.ReadLineAsync()
  }

  try {
    $session = Pick-Session
    if (-not $session) {
      if ($lastKey -ne '') {
        Emit @{ type = 'none' }
        $lastKey = ''; $lastTimeline = $null; $lastStatus = $null
      }
    } else {
      $props = Await ($session.TryGetMediaPropertiesAsync()) $tProps
      $info = $session.GetPlaybackInfo()
      $status = [string]$info.PlaybackStatus
      $key = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      $changed = $key -ne $lastKey
      if ($changed) {
        $lastKey = $key
        $coverTries = 0; $coverSize = -1
        $trackChangedAt = [DateTime]::UtcNow
        Emit @{
          type = 'track'; app = [string]$session.SourceAppUserModelId
          title = [string]$props.Title; artist = [string]$props.Artist
          album = [string]$props.AlbumTitle; albumArtist = [string]$props.AlbumArtist
          canPrev = [bool]$info.Controls.IsPreviousEnabled; canNext = [bool]$info.Controls.IsNextEnabled
          canToggle = [bool]$info.Controls.IsPlayPauseToggleEnabled
        }
      }
      $tl = $session.GetTimelineProperties()
      $tlKey = "$status|$($tl.Position.Ticks)|$($tl.EndTime.Ticks)|$($tl.LastUpdatedTime.UtcTicks)"
      if ($changed -or $tlKey -ne $lastTimeline) {
        $lastTimeline = $tlKey
        Emit @{
          type = 'timeline'; status = $status
          position = $tl.Position.TotalSeconds; start = $tl.StartTime.TotalSeconds; end = $tl.EndTime.TotalSeconds
          updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds(); now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
      }
      # Apps often publish the cover a moment after the title, so look again
      # a few times after each track change.
      $age = ([DateTime]::UtcNow - $trackChangedAt).TotalMilliseconds
      if ($coverTries -lt 5 -and $age -ge (@(0, 700, 1800, 4000, 9000)[$coverTries])) {
        $coverTries++
        try {
          $cover = Read-Cover $props
          if ($cover -and $cover.size -ne $coverSize) {
            $coverSize = $cover.size
            Emit @{ type = 'cover'; key = $key; mime = $cover.mime; data = $cover.data }
          } elseif (-not $cover -and $coverTries -eq 5 -and $coverSize -lt 0) {
            Emit @{ type = 'cover'; key = $key; mime = $null; data = $null }
          }
        } catch {}
      }
    }
  } catch {
    Emit @{ type = 'error'; message = $_.Exception.Message }
    $session = $null
  }
  Start-Sleep -Milliseconds 350
}
