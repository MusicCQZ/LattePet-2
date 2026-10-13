param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(2, 64)]
  [int]$ExpectedFrames = 16,

  [ValidateRange(128, 2048)]
  [int]$CanvasSize = 444,

  [ValidateRange(32, 1024)]
  [int]$TargetBodySpan = 348,

  [string]$TargetSpanReport = '',

  [ValidateRange(0, 128)]
  [int]$BottomMargin = 4,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 12
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.RedrawnWalkPreparer').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public sealed class RedrawnFrameReport {
    public string Frame { get; set; }
    public int SourceBodySpan { get; set; }
    public int OutputBodySpan { get; set; }
    public double AppliedScale { get; set; }
    public string SourceBounds { get; set; }
    public string OutputBounds { get; set; }
    public int RemovedVisiblePixels { get; set; }
  }

  public static class RedrawnWalkPreparer {
    private sealed class Metrics {
      public Rectangle Bounds;
      public int BodySpan;
      public double TorsoCenterX;
    }

    private static Bitmap CopyAsArgb(Bitmap sourceFile) {
      Bitmap copy = new Bitmap(sourceFile.Width, sourceFile.Height, PixelFormat.Format32bppArgb);
      using (Graphics graphics = Graphics.FromImage(copy)) {
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.DrawImageUnscaled(sourceFile, 0, 0);
      }
      return copy;
    }

    private static bool IsChromaArtifact(byte red, byte green, byte blue) {
      bool redFringe = red >= 205 && green <= 95 && blue <= 105;
      bool yellowFringe = red >= 205 && green >= 185 && blue <= 95;
      return redFringe || yellowFringe;
    }

    private static Bitmap CleanLargestSubject(Bitmap source, byte threshold, out int removed) {
      Bitmap cleaned = CopyAsArgb(source);
      Rectangle canvas = new Rectangle(0, 0, cleaned.Width, cleaned.Height);
      BitmapData data = cleaned.LockBits(canvas, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      try {
        int width = cleaned.Width;
        int height = cleaned.Height;
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        int pixelCount = width * height;
        int[] labels = new int[pixelCount];
        int[] queue = new int[pixelCount];
        int componentId = 0;
        int largestId = 0;
        int largestSize = 0;
        byte coreThreshold = (byte)Math.Max(48, (int)threshold);

        for (int y = 0; y < height; y++) {
          for (int x = 0; x < width; x++) {
            int index = y * width + x;
            if (labels[index] != 0) continue;
            int offset = y * stride + x * 4;
            byte alpha = pixels[offset + 3];
            byte blue = pixels[offset];
            byte green = pixels[offset + 1];
            byte red = pixels[offset + 2];
            if (alpha < coreThreshold || IsChromaArtifact(red, green, blue)) continue;

            componentId++;
            int head = 0;
            int tail = 0;
            queue[tail++] = index;
            labels[index] = componentId;

            while (head < tail) {
              int current = queue[head++];
              int currentX = current % width;
              int currentY = current / width;
              int left = currentX > 0 ? current - 1 : -1;
              int right = currentX + 1 < width ? current + 1 : -1;
              int above = currentY > 0 ? current - width : -1;
              int below = currentY + 1 < height ? current + width : -1;
              int[] neighbors = { left, right, above, below };

              for (int neighborIndex = 0; neighborIndex < neighbors.Length; neighborIndex++) {
                int neighbor = neighbors[neighborIndex];
                if (neighbor < 0 || labels[neighbor] != 0) continue;
                int neighborX = neighbor % width;
                int neighborY = neighbor / width;
                int neighborOffset = neighborY * stride + neighborX * 4;
                byte neighborAlpha = pixels[neighborOffset + 3];
                byte neighborBlue = pixels[neighborOffset];
                byte neighborGreen = pixels[neighborOffset + 1];
                byte neighborRed = pixels[neighborOffset + 2];
                if (neighborAlpha < coreThreshold
                  || IsChromaArtifact(neighborRed, neighborGreen, neighborBlue)) continue;
                labels[neighbor] = componentId;
                queue[tail++] = neighbor;
              }
            }

            if (tail > largestSize) {
              largestSize = tail;
              largestId = componentId;
            }
          }
        }

        if (largestId == 0) {
          throw new InvalidOperationException("No connected subject was found.");
        }

        bool[] keep = new bool[pixelCount];
        for (int index = 0; index < pixelCount; index++) {
          keep[index] = labels[index] == largestId;
        }

        for (int pass = 0; pass < 4; pass++) {
          bool[] expanded = (bool[])keep.Clone();
          for (int y = 1; y < height - 1; y++) {
            for (int x = 1; x < width - 1; x++) {
              int index = y * width + x;
              if (keep[index]) continue;
              for (int deltaY = -1; deltaY <= 1 && !expanded[index]; deltaY++) {
                for (int deltaX = -1; deltaX <= 1; deltaX++) {
                  if (keep[(y + deltaY) * width + x + deltaX]) {
                    expanded[index] = true;
                    break;
                  }
                }
              }
            }
          }
          keep = expanded;
        }

        removed = 0;
        for (int y = 0; y < height; y++) {
          int row = y * stride;
          for (int x = 0; x < width; x++) {
            int index = y * width + x;
            int offset = row + x * 4;
            byte alpha = pixels[offset + 3];
            byte blue = pixels[offset];
            byte green = pixels[offset + 1];
            byte red = pixels[offset + 2];
            if (!keep[index] || IsChromaArtifact(red, green, blue)) {
              if (alpha >= threshold) removed++;
              pixels[offset] = 0;
              pixels[offset + 1] = 0;
              pixels[offset + 2] = 0;
              pixels[offset + 3] = 0;
            }
          }
        }

        Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      } finally {
        cleaned.UnlockBits(data);
      }
      return cleaned;
    }

    private static int Median(int first, int second, int third) {
      if (first > second) { int swap = first; first = second; second = swap; }
      if (second > third) { int swap = second; second = third; third = swap; }
      if (first > second) { int swap = first; first = second; second = swap; }
      return second;
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
          int row = y * stride;
          for (int x = 0; x < bitmap.Width; x++) {
            if (pixels[row + x * 4 + 3] < threshold) continue;
            minX = Math.Min(minX, x);
            minY = Math.Min(minY, y);
            maxX = Math.Max(maxX, x);
            maxY = Math.Max(maxY, y);
          }
        }
        if (maxX < 0) throw new InvalidOperationException("No visible subject pixels were found.");

        Rectangle bounds = Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        int[] spans = new int[3];
        double[] ratios = { 0.33, 0.40, 0.48 };
        for (int index = 0; index < ratios.Length; index++) {
          int y = Math.Min(bounds.Bottom - 1, bounds.Top + (int)Math.Round((bounds.Height - 1) * ratios[index]));
          int rowMin = bitmap.Width;
          int rowMax = -1;
          int row = y * stride;
          for (int x = bounds.Left; x < bounds.Right; x++) {
            if (pixels[row + x * 4 + 3] < threshold) continue;
            rowMin = Math.Min(rowMin, x);
            rowMax = Math.Max(rowMax, x);
          }
          if (rowMax < rowMin) throw new InvalidOperationException("Could not measure subject span.");
          spans[index] = rowMax - rowMin + 1;
        }

        double centerCount = 0;
        double centerSum = 0;
        int torsoTop = bounds.Top + (int)Math.Round(bounds.Height * 0.22);
        int torsoBottom = bounds.Top + (int)Math.Round(bounds.Height * 0.65);
        for (int y = torsoTop; y < Math.Min(bounds.Bottom, torsoBottom); y++) {
          int row = y * stride;
          for (int x = bounds.Left; x < bounds.Right; x++) {
            if (pixels[row + x * 4 + 3] < threshold) continue;
            centerCount++;
            centerSum += x;
          }
        }

        return new Metrics {
          Bounds = bounds,
          BodySpan = Median(spans[0], spans[1], spans[2]),
          TorsoCenterX = centerCount > 0 ? centerSum / centerCount : bounds.Left + bounds.Width / 2.0,
        };
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    private static string FormatBounds(Rectangle bounds) {
      return String.Format(
        "{0},{1}-{2},{3}",
        bounds.Left,
        bounds.Top,
        bounds.Right - 1,
        bounds.Bottom - 1
      );
    }

    public static RedrawnFrameReport Prepare(
      string sourcePath,
      string destinationPath,
      string frameName,
      int canvasSize,
      int targetBodySpan,
      int targetHeight,
      double requestedCenterX,
      int bottomMargin,
      byte threshold
    ) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap source = CopyAsArgb(sourceFile)) {
        int removed;
        using (Bitmap cleaned = CleanLargestSubject(source, threshold, out removed)) {
          Metrics before = Measure(cleaned, threshold);
          double scale = targetHeight > 0
            ? (double)targetHeight / before.Bounds.Height
            : (double)targetBodySpan / before.BodySpan;
          double targetCenterX = targetHeight > 0 ? requestedCenterX : canvasSize / 2.0;
          double targetBottom = canvasSize - 1 - bottomMargin;

          using (Bitmap staged = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb)) {
            using (Graphics graphics = Graphics.FromImage(staged)) {
              graphics.CompositingMode = CompositingMode.SourceCopy;
              graphics.CompositingQuality = CompositingQuality.HighQuality;
              graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
              graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
              graphics.SmoothingMode = SmoothingMode.HighQuality;
              graphics.Clear(Color.Transparent);
              graphics.DrawImage(
                cleaned,
                new RectangleF(
                  (float)(targetCenterX - before.TorsoCenterX * scale),
                  (float)(targetBottom - (before.Bounds.Bottom - 1.0) * scale),
                  (float)(cleaned.Width * scale),
                  (float)(cleaned.Height * scale)
                ),
                new RectangleF(0, 0, cleaned.Width, cleaned.Height),
                GraphicsUnit.Pixel
              );
            }

            Metrics stagedMetrics = Measure(staged, threshold);
            int correctionX = (int)Math.Round(targetCenterX - stagedMetrics.TorsoCenterX);
            int correctionY = (int)Math.Round(targetBottom - (stagedMetrics.Bounds.Bottom - 1));
            using (Bitmap destination = new Bitmap(canvasSize, canvasSize, PixelFormat.Format32bppArgb)) {
              using (Graphics graphics = Graphics.FromImage(destination)) {
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.Clear(Color.Transparent);
                graphics.DrawImageUnscaled(staged, correctionX, correctionY);
              }
              Metrics after = Measure(destination, threshold);
              if (after.Bounds.Left <= 0 || after.Bounds.Right >= canvasSize) {
                throw new InvalidOperationException("Subject does not fit the target canvas: " + sourcePath);
              }
              if (after.Bounds.Bottom - 1 != (int)targetBottom) {
                throw new InvalidOperationException("Ground baseline could not be preserved: " + sourcePath);
              }
              destination.Save(destinationPath, ImageFormat.Png);
              return new RedrawnFrameReport {
                Frame = frameName,
                SourceBodySpan = before.BodySpan,
                OutputBodySpan = after.BodySpan,
                AppliedScale = scale,
                SourceBounds = FormatBounds(before.Bounds),
                OutputBounds = FormatBounds(after.Bounds),
                RemovedVisiblePixels = removed,
              };
            }
          }
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
  throw "Expected $ExpectedFrames walk frames but found $($frames.Count)."
}

New-Item -ItemType Directory -Path $resolvedOutput | Out-Null
$targetSpans = @{}
$targetHeights = @{}
$targetCenters = @{}
if (-not [string]::IsNullOrWhiteSpace($TargetSpanReport)) {
  $referenceReport = Get-Content -LiteralPath (Resolve-Path -LiteralPath $TargetSpanReport).Path -Raw |
    ConvertFrom-Json
  foreach ($referenceFrame in $referenceReport) {
    $span = if ($null -ne $referenceFrame.BodySpanAfter) {
      [int]$referenceFrame.BodySpanAfter
    } else {
      [int]$referenceFrame.OutputBodySpan
    }
    $targetSpans[$referenceFrame.Frame] = $span
    if ($referenceFrame.BoundsAfter -match '^(\d+),(\d+)-(\d+),(\d+)$') {
      $targetHeights[$referenceFrame.Frame] = [int]$Matches[4] - [int]$Matches[2] + 1
      $targetCenters[$referenceFrame.Frame] = ([double]$Matches[1] + [double]$Matches[3]) / 2
    }
  }
}

$report = foreach ($frame in $frames) {
  $frameTargetBodySpan = if ($targetSpans.ContainsKey($frame.Name)) {
    $targetSpans[$frame.Name]
  } else {
    $TargetBodySpan
  }
  $frameTargetHeight = if ($targetHeights.ContainsKey($frame.Name)) {
    $targetHeights[$frame.Name]
  } else {
    0
  }
  $frameTargetCenter = if ($targetCenters.ContainsKey($frame.Name)) {
    $targetCenters[$frame.Name]
  } else {
    $CanvasSize / 2
  }
  [LattePet.RedrawnWalkPreparer]::Prepare(
    $frame.FullName,
    (Join-Path $resolvedOutput $frame.Name),
    $frame.Name,
    $CanvasSize,
    $frameTargetBodySpan,
    $frameTargetHeight,
    $frameTargetCenter,
    $BottomMargin,
    [byte]$AlphaThreshold
  )
}

$reportJson = $report | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
  (Join-Path $resolvedOutput 'redraw-report.json'),
  $reportJson,
  [System.Text.UTF8Encoding]::new($false)
)
$report
