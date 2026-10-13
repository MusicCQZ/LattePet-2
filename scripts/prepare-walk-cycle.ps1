param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(64, 2048)]
  [int]$CanvasSize = 444,

  [ValidateRange(0.25, 4)]
  [double]$Scale = 1.2,

  [ValidateRange(0, 2048)]
  [int]$TargetVisibleHeight = 0,

  [ValidateRange(0, 128)]
  [int]$BottomMargin = 4,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 12,

  [ValidateRange(2, 64)]
  [int]$ExpectedFrames = 16
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.WalkCyclePreparer').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class WalkCyclePreparer {
    private sealed class Metrics {
      public Rectangle Bounds;
      public double TorsoCenterX;
    }

    private static Metrics Measure(Bitmap bitmap, byte threshold) {
      Rectangle canvas = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(canvas, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);

      try {
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * bitmap.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);

        int minX = bitmap.Width;
        int minY = bitmap.Height;
        int maxX = -1;
        int maxY = -1;

        for (int y = 0; y < bitmap.Height; y++) {
          for (int x = 0; x < bitmap.Width; x++) {
            if (pixels[y * stride + x * 4 + 3] < threshold) continue;
            minX = Math.Min(minX, x);
            minY = Math.Min(minY, y);
            maxX = Math.Max(maxX, x);
            maxY = Math.Max(maxY, y);
          }
        }

        if (maxX < 0 || maxY < 0) {
          throw new InvalidOperationException("No visible sprite pixels were found.");
        }

        Rectangle bounds = Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        int torsoBottom = bounds.Top + (int)Math.Round(bounds.Height * 0.72);
        long count = 0;
        long sumX = 0;

        for (int y = bounds.Top; y < Math.Min(bounds.Bottom, torsoBottom); y++) {
          for (int x = bounds.Left; x < bounds.Right; x++) {
            if (pixels[y * stride + x * 4 + 3] < threshold) continue;
            count++;
            sumX += x;
          }
        }

        return new Metrics {
          Bounds = bounds,
          TorsoCenterX = count > 0 ? (double)sumX / count : bounds.Left + bounds.Width / 2.0,
        };
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    private static Bitmap CopyAsArgb(Bitmap sourceFile) {
      Bitmap copy = new Bitmap(sourceFile.Width, sourceFile.Height, PixelFormat.Format32bppArgb);
      using (Graphics graphics = Graphics.FromImage(copy)) {
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.DrawImageUnscaled(sourceFile, 0, 0);
      }
      return copy;
    }

    public static string Prepare(
      string sourcePath,
      string destinationPath,
      int canvasSize,
      double scale,
      int targetVisibleHeight,
      int bottomMargin,
      byte threshold
    ) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap source = CopyAsArgb(sourceFile))
      using (Bitmap staged = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb)) {
        Metrics sourceMetrics = Measure(source, threshold);
        if (targetVisibleHeight > 0) {
          scale = (double)targetVisibleHeight / sourceMetrics.Bounds.Height;
        }
        double targetBottom = canvasSize - 1 - bottomMargin;
        double targetCenterX = canvasSize / 2.0;
        double destinationX = targetCenterX - sourceMetrics.TorsoCenterX * scale;
        double destinationY = targetBottom - ((sourceMetrics.Bounds.Bottom * scale) - 1.0);

        using (Graphics graphics = Graphics.FromImage(staged)) {
          graphics.CompositingMode = CompositingMode.SourceCopy;
          graphics.CompositingQuality = CompositingQuality.HighQuality;
          graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
          graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
          graphics.SmoothingMode = SmoothingMode.HighQuality;
          graphics.Clear(Color.Transparent);
          graphics.DrawImage(
            source,
            new RectangleF(
              (float)destinationX,
              (float)destinationY,
              (float)(source.Width * scale),
              (float)(source.Height * scale)
            ),
            new RectangleF(0, 0, source.Width, source.Height),
            GraphicsUnit.Pixel
          );
        }

        Metrics stagedMetrics = Measure(staged, threshold);
        int correctionX = (int)Math.Round(targetCenterX - stagedMetrics.TorsoCenterX);
        int correctionY = (canvasSize - 1 - bottomMargin) - (stagedMetrics.Bounds.Bottom - 1);

        using (Bitmap destination = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb)) {
          using (Graphics graphics = Graphics.FromImage(destination)) {
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.Clear(Color.Transparent);
            graphics.DrawImageUnscaled(staged, correctionX, correctionY);
          }

          Metrics finalMetrics = Measure(destination, threshold);
          if (finalMetrics.Bounds.Left <= 0 || finalMetrics.Bounds.Right >= canvasSize) {
            throw new InvalidOperationException("Horizontal padding is insufficient in " + sourcePath);
          }
          if (finalMetrics.Bounds.Bottom - 1 != canvasSize - 1 - bottomMargin) {
            throw new InvalidOperationException("Ground baseline could not be normalized in " + sourcePath);
          }

          destination.Save(destinationPath, ImageFormat.Png);
          return String.Format(
            "bounds={0},{1},{2},{3}; torsoCenterX={4:F2}; correction={5},{6}",
            finalMetrics.Bounds.Left,
            finalMetrics.Bounds.Top,
            finalMetrics.Bounds.Right - 1,
            finalMetrics.Bounds.Bottom - 1,
            finalMetrics.TorsoCenterX,
            correctionX,
            correctionY
          );
        }
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

$frames = @(Get-ChildItem -LiteralPath $resolvedSource -Filter 'frame-*.png' | Sort-Object Name)
if ($frames.Count -ne $ExpectedFrames) {
  throw "A complete walk cycle requires exactly $ExpectedFrames source frames; found $($frames.Count)."
}

New-Item -ItemType Directory -Path $resolvedOutput | Out-Null
foreach ($frame in $frames) {
  $destination = Join-Path $resolvedOutput $frame.Name
  $details = [LattePet.WalkCyclePreparer]::Prepare(
    $frame.FullName,
    $destination,
    $CanvasSize,
    $Scale,
    $TargetVisibleHeight,
    $BottomMargin,
    [byte]$AlphaThreshold
  )

  [pscustomobject]@{
    Frame = $frame.Name
    Canvas = "${CanvasSize}x${CanvasSize}"
    Scale = if ($TargetVisibleHeight -gt 0) { "auto:${TargetVisibleHeight}px" } else { $Scale }
    Details = $details
  }
}

