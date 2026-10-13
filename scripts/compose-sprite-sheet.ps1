param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 16)]
  [int]$Columns,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 16)]
  [int]$Rows,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedSource = (Resolve-Path -LiteralPath $SourceDirectory).Path
$resolvedDestination = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
if (Test-Path -LiteralPath $resolvedDestination) {
  throw "Destination already exists: $resolvedDestination"
}

$frames = @(Get-ChildItem -LiteralPath $resolvedSource -Filter 'frame-*.png' | Sort-Object Name)
if ($frames.Count -ne $Columns * $Rows) {
  throw "Expected $($Columns * $Rows) frames but found $($frames.Count)."
}

$firstFrame = [System.Drawing.Bitmap]::FromFile($frames[0].FullName)
try {
  $frameWidth = $firstFrame.Width
  $frameHeight = $firstFrame.Height
} finally {
  $firstFrame.Dispose()
}

$sheetWidth = $frameWidth * $Columns
$sheetHeight = $frameHeight * $Rows
$sheet = New-Object System.Drawing.Bitmap(
  $sheetWidth,
  $sheetHeight,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)

try {
  $graphics = [System.Drawing.Graphics]::FromImage($sheet)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.Clear([System.Drawing.Color]::Transparent)

    for ($index = 0; $index -lt $frames.Count; $index++) {
      $frame = [System.Drawing.Bitmap]::FromFile($frames[$index].FullName)
      try {
        if ($frame.Width -ne $frameWidth -or $frame.Height -ne $frameHeight) {
          throw "Frame dimensions do not match: $($frames[$index].FullName)"
        }

        $column = $index % $Columns
        $row = [Math]::Floor($index / $Columns)
        $graphics.DrawImageUnscaled($frame, $column * $frameWidth, $row * $frameHeight)
      } finally {
        $frame.Dispose()
      }
    }
  } finally {
    $graphics.Dispose()
  }

  $destinationDirectory = Split-Path -Parent $resolvedDestination
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  $sheet.Save($resolvedDestination, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $sheet.Dispose()
}

$resolvedDestination
