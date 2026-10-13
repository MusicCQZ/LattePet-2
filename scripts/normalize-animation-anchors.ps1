param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(0, 128)]
  [int]$BottomMargin = 4,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.AnchorNormalizer').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class AnchorNormalizer {
    private static Rectangle GetAlphaBounds(Bitmap bitmap, byte threshold) {
      Rectangle canvas = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(
        canvas,
        ImageLockMode.ReadOnly,
        PixelFormat.Format32bppArgb
      );

      try {
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * bitmap.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);

        int minX = bitmap.Width;
        int minY = bitmap.Height;
        int maxX = -1;
        int maxY = -1;

        for (int y = 0; y < bitmap.Height; y++) {
          int row = y * stride;
          for (int x = 0; x < bitmap.Width; x++) {
            if (pixels[row + x * 4 + 3] < threshold) {
              continue;
            }

            minX = Math.Min(minX, x);
            minY = Math.Min(minY, y);
            maxX = Math.Max(maxX, x);
            maxY = Math.Max(maxY, y);
          }
        }

        if (maxX < 0 || maxY < 0) {
          throw new InvalidOperationException("No visible sprite pixels were found.");
        }

        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    public static int Normalize(string sourcePath, string destinationPath, int bottomMargin, byte threshold) {
      using (var sourceFile = new Bitmap(sourcePath))
      using (var source = new Bitmap(sourceFile.Width, sourceFile.Height, PixelFormat.Format32bppArgb)) {
        using (var sourceGraphics = Graphics.FromImage(source)) {
          sourceGraphics.CompositingMode = CompositingMode.SourceCopy;
          sourceGraphics.DrawImageUnscaled(sourceFile, 0, 0);
        }

        Rectangle bounds = GetAlphaBounds(source, threshold);
        int targetBottom = source.Height - 1 - bottomMargin;
        int offsetY = targetBottom - (bounds.Bottom - 1);
        if (bounds.Top + offsetY < 0 || bounds.Bottom + offsetY > source.Height) {
          throw new InvalidOperationException(
            "The requested anchor would clip visible pixels in " + sourcePath
          );
        }

        using (var destination = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(destination)) {
          graphics.CompositingMode = CompositingMode.SourceCopy;
          graphics.Clear(Color.Transparent);
          graphics.DrawImageUnscaled(source, 0, offsetY);
          destination.Save(destinationPath, ImageFormat.Png);
        }

        return offsetY;
      }
    }
  }
}
'@
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceDirectory).Path
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))

if (Test-Path -LiteralPath $resolvedOutput) {
  throw "Output directory already exists: $resolvedOutput"
}

New-Item -ItemType Directory -Path $resolvedOutput | Out-Null
$frames = @(Get-ChildItem -LiteralPath $resolvedSource -Filter 'frame-*.png' | Sort-Object Name)
if ($frames.Count -eq 0) {
  throw "No animation frames found in: $resolvedSource"
}

$results = foreach ($frame in $frames) {
  $destination = Join-Path $resolvedOutput $frame.Name
  $offsetY = [LattePet.AnchorNormalizer]::Normalize(
    $frame.FullName,
    $destination,
    $BottomMargin,
    [byte]$AlphaThreshold
  )

  [pscustomobject]@{
    Frame = $frame.Name
    VerticalOffset = $offsetY
    BottomMargin = $BottomMargin
  }
}

$results
