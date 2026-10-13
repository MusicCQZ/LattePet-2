param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(0.1, 2.0)]
  [double]$RedScale = 1.0,

  [ValidateRange(0.1, 2.0)]
  [double]$GreenScale = 1.0,

  [ValidateRange(0.1, 2.0)]
  [double]$BlueScale = 1.0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.ColorAdjuster').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class ColorAdjuster {
    private static byte Scale(byte value, double factor) {
      return (byte)Math.Max(0, Math.Min(255, Math.Round(value * factor)));
    }

    public static void Apply(
      string sourcePath,
      string destinationPath,
      double redFactor,
      double greenFactor,
      double blueFactor
    ) {
      using (var sourceFile = new Bitmap(sourcePath))
      using (var bitmap = new Bitmap(sourceFile.Width, sourceFile.Height, PixelFormat.Format32bppArgb)) {
        using (var graphics = Graphics.FromImage(bitmap)) {
          graphics.CompositingMode = CompositingMode.SourceCopy;
          graphics.DrawImageUnscaled(sourceFile, 0, 0);
        }

        Rectangle canvas = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(
          canvas,
          ImageLockMode.ReadWrite,
          PixelFormat.Format32bppArgb
        );

        try {
          int stride = Math.Abs(data.Stride);
          byte[] pixels = new byte[stride * bitmap.Height];
          Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
          for (int y = 0; y < bitmap.Height; y++) {
            int row = y * stride;
            for (int x = 0; x < bitmap.Width; x++) {
              int offset = row + x * 4;
              if (pixels[offset + 3] == 0) {
                continue;
              }
              pixels[offset] = Scale(pixels[offset], blueFactor);
              pixels[offset + 1] = Scale(pixels[offset + 1], greenFactor);
              pixels[offset + 2] = Scale(pixels[offset + 2], redFactor);
            }
          }
          Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
        } finally {
          bitmap.UnlockBits(data);
        }

        bitmap.Save(destinationPath, ImageFormat.Png);
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

foreach ($frame in $frames) {
  $destination = Join-Path $resolvedOutput $frame.Name
  [LattePet.ColorAdjuster]::Apply(
    $frame.FullName,
    $destination,
    $RedScale,
    $GreenScale,
    $BlueScale
  )
}

[pscustomobject]@{
  Frames = $frames.Count
  OutputDirectory = $resolvedOutput
  RedScale = $RedScale
  GreenScale = $GreenScale
  BlueScale = $BlueScale
}
