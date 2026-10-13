param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 16)]
  [int]$Columns,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 16)]
  [int]$Rows,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 4
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.SpriteCleaner').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class SpriteCleaner {
    public static void KeepLargestAlphaComponent(Bitmap bitmap, byte threshold) {
      Rectangle rectangle = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(
        rectangle,
        ImageLockMode.ReadWrite,
        PixelFormat.Format32bppArgb
      );

      try {
        int width = bitmap.Width;
        int height = bitmap.Height;
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);

        int pixelCount = width * height;
        int[] labels = new int[pixelCount];
        for (int index = 0; index < labels.Length; index++) {
          labels[index] = -1;
        }
        int[] queue = new int[pixelCount];
        int component = 0;
        int largestComponent = -1;
        int largestSize = 0;

        for (int y = 0; y < height; y++) {
          for (int x = 0; x < width; x++) {
            int index = y * width + x;
            int offset = y * stride + x * 4;
            if (labels[index] >= 0 || pixels[offset + 3] < threshold) {
              continue;
            }

            int head = 0;
            int tail = 0;
            int componentSize = 0;
            queue[tail++] = index;
            labels[index] = component;

            while (head < tail) {
              int current = queue[head++];
              componentSize++;
              int currentX = current % width;
              int currentY = current / width;

              for (int deltaY = -1; deltaY <= 1; deltaY++) {
                for (int deltaX = -1; deltaX <= 1; deltaX++) {
                  if (deltaX == 0 && deltaY == 0) {
                    continue;
                  }

                  int nextX = currentX + deltaX;
                  int nextY = currentY + deltaY;
                  if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
                    continue;
                  }

                  int next = nextY * width + nextX;
                  if (labels[next] >= 0) {
                    continue;
                  }

                  int nextOffset = nextY * stride + nextX * 4;
                  if (pixels[nextOffset + 3] < threshold) {
                    continue;
                  }

                  labels[next] = component;
                  queue[tail++] = next;
                }
              }
            }

            if (componentSize > largestSize) {
              largestSize = componentSize;
              largestComponent = component;
            }
            component++;
          }
        }

        if (largestComponent < 0) {
          throw new InvalidOperationException("No visible sprite pixels were found.");
        }

        for (int y = 0; y < height; y++) {
          for (int x = 0; x < width; x++) {
            int index = y * width + x;
            int offset = y * stride + x * 4;
            if (labels[index] != largestComponent) {
              pixels[offset] = 0;
              pixels[offset + 1] = 0;
              pixels[offset + 2] = 0;
              pixels[offset + 3] = 0;
            }
          }
        }

        Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      } finally {
        bitmap.UnlockBits(data);
      }
    }
  }
}
'@
}

$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($resolvedSource)
try {
  $frameWidth = [int][Math]::Ceiling($sourceBitmap.Width / [double]$Columns)
  $frameHeight = [int][Math]::Ceiling($sourceBitmap.Height / [double]$Rows)
  $frameNumber = 1

  for ($row = 0; $row -lt $Rows; $row++) {
    $sourceTop = [int][Math]::Floor($row * $sourceBitmap.Height / [double]$Rows)
    $sourceBottom = [int][Math]::Floor(($row + 1) * $sourceBitmap.Height / [double]$Rows)
    $sourceHeight = $sourceBottom - $sourceTop

    for ($column = 0; $column -lt $Columns; $column++) {
      $sourceLeft = [int][Math]::Floor($column * $sourceBitmap.Width / [double]$Columns)
      $sourceRight = [int][Math]::Floor(($column + 1) * $sourceBitmap.Width / [double]$Columns)
      $sourceWidth = $sourceRight - $sourceLeft
      $destinationX = [int][Math]::Floor(($frameWidth - $sourceWidth) / 2)
      $destinationY = [int][Math]::Floor(($frameHeight - $sourceHeight) / 2)

      $frame = New-Object System.Drawing.Bitmap(
        $frameWidth,
        $frameHeight,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
      )
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($frame)
        try {
          $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $destinationRectangle = New-Object System.Drawing.Rectangle(
            $destinationX,
            $destinationY,
            $sourceWidth,
            $sourceHeight
          )
          $sourceRectangle = New-Object System.Drawing.Rectangle(
            $sourceLeft,
            $sourceTop,
            $sourceWidth,
            $sourceHeight
          )
          $graphics.DrawImage(
            $sourceBitmap,
            $destinationRectangle,
            $sourceRectangle,
            [System.Drawing.GraphicsUnit]::Pixel
          )
        } finally {
          $graphics.Dispose()
        }

        [LattePet.SpriteCleaner]::KeepLargestAlphaComponent(
          $frame,
          [byte]$AlphaThreshold
        )

        $destination = Join-Path $resolvedOutput ('frame-{0:D2}.png' -f $frameNumber)
        if (Test-Path -LiteralPath $destination) {
          throw "Frame already exists: $destination"
        }
        $frame.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
        $frameNumber++
      } finally {
        $frame.Dispose()
      }
    }
  }

  [pscustomobject]@{
    Source = $resolvedSource
    OutputDirectory = $resolvedOutput
    Frames = $Columns * $Rows
    FrameWidth = $frameWidth
    FrameHeight = $frameHeight
  }
} finally {
  $sourceBitmap.Dispose()
}
