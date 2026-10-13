param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [Parameter(Mandatory = $true)]
  [ValidateRange(64, 2048)]
  [int]$CanvasWidth,

  [Parameter(Mandatory = $true)]
  [ValidateRange(64, 2048)]
  [int]$CanvasHeight,

  [Parameter(Mandatory = $true)]
  [ValidateRange(16, 2048)]
  [int]$TargetWidth,

  [Parameter(Mandatory = $true)]
  [double]$TargetCenterX,

  [ValidateRange(0, 128)]
  [int]$BottomMargin = 4,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 12
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.GeneratedFramePreparer').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public static class GeneratedFramePreparer {
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

    private static Bitmap KeepLargestSubject(Bitmap source, byte threshold) {
      Bitmap cleaned = CopyAsArgb(source);
      Rectangle canvas = new Rectangle(0, 0, cleaned.Width, cleaned.Height);
      BitmapData data = cleaned.LockBits(canvas, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      try {
        int width = cleaned.Width;
        int height = cleaned.Height;
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        int[] labels = new int[width * height];
        int[] queue = new int[width * height];
        int component = 0;
        int largestComponent = 0;
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

            component++;
            int head = 0;
            int tail = 0;
            queue[tail++] = index;
            labels[index] = component;
            while (head < tail) {
              int current = queue[head++];
              int currentX = current % width;
              int currentY = current / width;
              for (int deltaY = -1; deltaY <= 1; deltaY++) {
                for (int deltaX = -1; deltaX <= 1; deltaX++) {
                  if (deltaX == 0 && deltaY == 0) continue;
                  int nextX = currentX + deltaX;
                  int nextY = currentY + deltaY;
                  if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
                  int next = nextY * width + nextX;
                  if (labels[next] != 0) continue;
                  int nextOffset = nextY * stride + nextX * 4;
                  byte nextAlpha = pixels[nextOffset + 3];
                  byte nextBlue = pixels[nextOffset];
                  byte nextGreen = pixels[nextOffset + 1];
                  byte nextRed = pixels[nextOffset + 2];
                  if (nextAlpha < coreThreshold || IsChromaArtifact(nextRed, nextGreen, nextBlue)) continue;
                  labels[next] = component;
                  queue[tail++] = next;
                }
              }
            }
            if (tail > largestSize) {
              largestSize = tail;
              largestComponent = component;
            }
          }
        }

        if (largestComponent == 0) {
          throw new InvalidOperationException("No connected subject was found.");
        }

        bool[] keep = new bool[width * height];
        for (int index = 0; index < keep.Length; index++) {
          keep[index] = labels[index] == largestComponent;
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

        for (int y = 0; y < height; y++) {
          for (int x = 0; x < width; x++) {
            int index = y * width + x;
            int offset = y * stride + x * 4;
            byte blue = pixels[offset];
            byte green = pixels[offset + 1];
            byte red = pixels[offset + 2];
            if (!keep[index] || IsChromaArtifact(red, green, blue)) {
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

    private static Rectangle Measure(Bitmap bitmap, byte threshold) {
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
        if (maxX < 0) throw new InvalidOperationException("No visible subject pixels were found.");
        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    public static string Prepare(
      string sourcePath,
      string destinationPath,
      int canvasWidth,
      int canvasHeight,
      int targetWidth,
      double targetCenterX,
      int bottomMargin,
      byte threshold
    ) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap source = CopyAsArgb(sourceFile))
      using (Bitmap cleaned = KeepLargestSubject(source, threshold)) {
        Rectangle sourceBounds = Measure(cleaned, threshold);
        double scale = (double)targetWidth / sourceBounds.Width;
        double targetBottom = canvasHeight - 1 - bottomMargin;
        double targetX = targetCenterX - (sourceBounds.Left + sourceBounds.Width / 2.0) * scale;
        double targetY = targetBottom - (sourceBounds.Bottom - 1.0) * scale;

        using (Bitmap destination = new Bitmap(canvasWidth, canvasHeight, PixelFormat.Format32bppArgb)) {
          using (Graphics graphics = Graphics.FromImage(destination)) {
            graphics.CompositingMode = CompositingMode.SourceCopy;
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(
              cleaned,
              new RectangleF(
                (float)targetX,
                (float)targetY,
                (float)(cleaned.Width * scale),
                (float)(cleaned.Height * scale)
              ),
              new RectangleF(0, 0, cleaned.Width, cleaned.Height),
              GraphicsUnit.Pixel
            );
          }

          Rectangle outputBounds = Measure(destination, threshold);
          if (outputBounds.Left <= 0 || outputBounds.Right >= canvasWidth
            || outputBounds.Top <= 0 || outputBounds.Bottom > canvasHeight) {
            throw new InvalidOperationException("Prepared subject does not fit the target canvas.");
          }
          destination.Save(destinationPath, ImageFormat.Png);
          return String.Format(
            "source={0},{1}-{2},{3}; output={4},{5}-{6},{7}; scale={8:F4}",
            sourceBounds.Left,
            sourceBounds.Top,
            sourceBounds.Right - 1,
            sourceBounds.Bottom - 1,
            outputBounds.Left,
            outputBounds.Top,
            outputBounds.Right - 1,
            outputBounds.Bottom - 1,
            scale
          );
        }
      }
    }
  }
}
'@
}

$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
$resolvedDestination = if ([System.IO.Path]::IsPathRooted($Destination)) {
  [System.IO.Path]::GetFullPath($Destination)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
}
if (Test-Path -LiteralPath $resolvedDestination) {
  throw "Destination already exists: $resolvedDestination"
}

$destinationDirectory = Split-Path -Parent $resolvedDestination
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
[LattePet.GeneratedFramePreparer]::Prepare(
  $resolvedSource,
  $resolvedDestination,
  $CanvasWidth,
  $CanvasHeight,
  $TargetWidth,
  $TargetCenterX,
  $BottomMargin,
  [byte]$AlphaThreshold
)
