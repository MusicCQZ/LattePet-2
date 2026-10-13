param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.ChromaKey').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class ChromaKey {
    private static byte Clamp(double value) {
      return (byte)Math.Max(0, Math.Min(255, Math.Round(value)));
    }

    public static void ExtractGreen(string sourcePath, string destinationPath) {
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
              double blue = pixels[offset];
              double green = pixels[offset + 1];
              double red = pixels[offset + 2];
              if (green > 200 && red < 64 && blue < 64) {
                pixels[offset] = 0;
                pixels[offset + 1] = 0;
                pixels[offset + 2] = 0;
                pixels[offset + 3] = 0;
                continue;
              }

              double greenExcess = green - Math.Max(red, blue);
              double alpha = 255 - Math.Max(0, Math.Min(255, greenExcess));

              if (alpha < 6) {
                pixels[offset] = 0;
                pixels[offset + 1] = 0;
                pixels[offset + 2] = 0;
                pixels[offset + 3] = 0;
                continue;
              }

              double normalizedAlpha = alpha / 255.0;
              pixels[offset] = Clamp(blue / normalizedAlpha);
              pixels[offset + 1] = Clamp((green - (1 - normalizedAlpha) * 255) / normalizedAlpha);
              pixels[offset + 2] = Clamp(red / normalizedAlpha);
              pixels[offset + 3] = Clamp(alpha);
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

$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
$resolvedDestination = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
if (Test-Path -LiteralPath $resolvedDestination) {
  throw "Destination already exists: $resolvedDestination"
}

$destinationDirectory = Split-Path -Parent $resolvedDestination
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
[LattePet.ChromaKey]::ExtractGreen($resolvedSource, $resolvedDestination)

$resolvedDestination
