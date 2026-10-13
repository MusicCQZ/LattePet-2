param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [string]$ColorReferenceImage = '',

  [switch]$ColorOnly,

  [ValidateRange(2, 64)]
  [int]$ExpectedFrames = 16,

  [ValidateRange(0, 128)]
  [int]$BottomMargin = 4,

  [ValidateRange(1, 255)]
  [int]$AlphaThreshold = 12
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'LattePet.WalkConsistencyNormalizer').Type) {
  Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace LattePet {
  public sealed class WalkFrameReport {
    public string Frame { get; set; }
    public double AppliedHorizontalScale { get; set; }
    public int BodySpanBefore { get; set; }
    public int BodySpanAfter { get; set; }
    public double BrownRedBefore { get; set; }
    public double BrownGreenBefore { get; set; }
    public double BrownBlueBefore { get; set; }
    public double BrownRedAfter { get; set; }
    public double BrownGreenAfter { get; set; }
    public double BrownBlueAfter { get; set; }
    public string WarmRgbBefore { get; set; }
    public string WarmRgbAfter { get; set; }
    public string WarmHsvBefore { get; set; }
    public string WarmHsvAfter { get; set; }
    public double NeutralLuminanceBefore { get; set; }
    public double NeutralLuminanceAfter { get; set; }
    public string BoundsAfter { get; set; }
  }

  public static class WalkConsistencyNormalizer {
    private sealed class Metrics {
      public Rectangle Bounds;
      public int BodySpan;
      public double TorsoCenterX;
      public double BrownRed;
      public double BrownGreen;
      public double BrownBlue;
      public double WarmRed;
      public double WarmGreen;
      public double WarmBlue;
      public double WarmHue;
      public double WarmSaturation;
      public double WarmValue;
      public double NeutralLuminance;
    }

    private static double Clamp(double value, double minimum, double maximum) {
      return Math.Max(minimum, Math.Min(maximum, value));
    }

    private static double GetHue(double red, double green, double blue) {
      double maximum = Math.Max(red, Math.Max(green, blue));
      double minimum = Math.Min(red, Math.Min(green, blue));
      double delta = maximum - minimum;
      if (delta <= 0) return 0;

      double hue;
      if (maximum == red) hue = 60 * (((green - blue) / delta) % 6);
      else if (maximum == green) hue = 60 * (((blue - red) / delta) + 2);
      else hue = 60 * (((red - green) / delta) + 4);
      return hue < 0 ? hue + 360 : hue;
    }

    private static int Median(int first, int second, int third) {
      if (first > second) { int swap = first; first = second; second = swap; }
      if (second > third) { int swap = second; second = third; third = swap; }
      if (first > second) { int swap = first; first = second; second = swap; }
      return second;
    }

    private static Bitmap CopyAsArgb(Bitmap sourceFile) {
      Bitmap copy = new Bitmap(sourceFile.Width, sourceFile.Height, PixelFormat.Format32bppArgb);
      using (Graphics graphics = Graphics.FromImage(copy)) {
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.DrawImageUnscaled(sourceFile, 0, 0);
      }
      return copy;
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

        if (maxX < 0 || maxY < 0) {
          throw new InvalidOperationException("No visible pixels were found.");
        }

        Rectangle bounds = Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        double torsoCount = 0;
        double torsoSumX = 0;
        int torsoBottom = bounds.Top + (int)Math.Round(bounds.Height * 0.72);
        for (int y = bounds.Top; y < Math.Min(bounds.Bottom, torsoBottom); y++) {
          int row = y * stride;
          for (int x = bounds.Left; x < bounds.Right; x++) {
            if (pixels[row + x * 4 + 3] < threshold) continue;
            torsoCount++;
            torsoSumX += x;
          }
        }

        int[] spans = new int[3];
        double[] rowRatios = { 0.33, 0.40, 0.48 };
        for (int index = 0; index < rowRatios.Length; index++) {
          int y = Math.Min(
            bounds.Bottom - 1,
            bounds.Top + (int)Math.Round((bounds.Height - 1) * rowRatios[index])
          );
          int rowMinX = bitmap.Width;
          int rowMaxX = -1;
          int row = y * stride;
          for (int x = 0; x < bitmap.Width; x++) {
            if (pixels[row + x * 4 + 3] < threshold) continue;
            rowMinX = Math.Min(rowMinX, x);
            rowMaxX = Math.Max(rowMaxX, x);
          }
          if (rowMaxX < rowMinX) {
            throw new InvalidOperationException("Could not measure the body span.");
          }
          spans[index] = rowMaxX - rowMinX + 1;
        }

        double brownCount = 0;
        double brownRed = 0;
        double brownGreen = 0;
        double brownBlue = 0;
        double warmCount = 0;
        double warmRed = 0;
        double warmGreen = 0;
        double warmBlue = 0;
        double warmHue = 0;
        double warmSaturation = 0;
        double warmValue = 0;
        double neutralCount = 0;
        double neutralLuminance = 0;
        for (int y = bounds.Top; y < bounds.Bottom; y++) {
          int row = y * stride;
          for (int x = bounds.Left; x < bounds.Right; x++) {
            int offset = row + x * 4;
            byte alpha = pixels[offset + 3];
            if (alpha < 180) continue;
            double blue = pixels[offset];
            double green = pixels[offset + 1];
            double red = pixels[offset + 2];
            double maximum = Math.Max(red, Math.Max(green, blue));
            double minimum = Math.Min(red, Math.Min(green, blue));
            double saturation = maximum > 0 ? (maximum - minimum) / maximum : 0;
            if (saturation < 0.18 && maximum > 110) {
              neutralCount++;
              neutralLuminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
            }
            if (saturation > 0.14 && red > green * 1.05 && green > blue * 0.75) {
              warmCount++;
              warmRed += red;
              warmGreen += green;
              warmBlue += blue;
              warmHue += GetHue(red, green, blue);
              warmSaturation += saturation;
              warmValue += maximum / 255.0;
            }
            if (red > 90 && red > green * 1.25 && green > blue * 0.90) {
              brownCount++;
              brownRed += red;
              brownGreen += green;
              brownBlue += blue;
            }
          }
        }

        if (brownCount < 100) {
          throw new InvalidOperationException("Not enough brown fur pixels were found for color matching.");
        }
        if (warmCount < 100) {
          throw new InvalidOperationException("Not enough warm fur pixels were found for color matching.");
        }
        if (neutralCount < 100) {
          throw new InvalidOperationException("Not enough neutral fur pixels were found for exposure matching.");
        }

        return new Metrics {
          Bounds = bounds,
          BodySpan = Median(spans[0], spans[1], spans[2]),
          TorsoCenterX = torsoCount > 0 ? torsoSumX / torsoCount : bounds.Left + bounds.Width / 2.0,
          BrownRed = brownRed / brownCount,
          BrownGreen = brownGreen / brownCount,
          BrownBlue = brownBlue / brownCount,
          WarmRed = warmRed / warmCount,
          WarmGreen = warmGreen / warmCount,
          WarmBlue = warmBlue / warmCount,
          WarmHue = warmHue / warmCount,
          WarmSaturation = warmSaturation / warmCount,
          WarmValue = warmValue / warmCount,
          NeutralLuminance = neutralLuminance / neutralCount,
        };
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    private static void HsvToRgb(
      double hue,
      double saturation,
      double value,
      out byte red,
      out byte green,
      out byte blue
    ) {
      hue = ((hue % 360) + 360) % 360;
      saturation = Clamp(saturation, 0, 1);
      value = Clamp(value, 0, 1);
      double chroma = value * saturation;
      double segment = hue / 60.0;
      double secondary = chroma * (1 - Math.Abs(segment % 2 - 1));
      double redBase = 0;
      double greenBase = 0;
      double blueBase = 0;

      if (segment < 1) { redBase = chroma; greenBase = secondary; }
      else if (segment < 2) { redBase = secondary; greenBase = chroma; }
      else if (segment < 3) { greenBase = chroma; blueBase = secondary; }
      else if (segment < 4) { greenBase = secondary; blueBase = chroma; }
      else if (segment < 5) { redBase = secondary; blueBase = chroma; }
      else { redBase = chroma; blueBase = secondary; }

      double match = value - chroma;
      red = (byte)Math.Round(Clamp((redBase + match) * 255, 0, 255));
      green = (byte)Math.Round(Clamp((greenBase + match) * 255, 0, 255));
      blue = (byte)Math.Round(Clamp((blueBase + match) * 255, 0, 255));
    }

    private static void MatchWarmFurHsv(
      Bitmap bitmap,
      double hueDelta,
      double saturationFactor,
      double valueFactor
    ) {
      Rectangle canvas = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(canvas, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      try {
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * bitmap.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        for (int y = 0; y < bitmap.Height; y++) {
          int row = y * stride;
          for (int x = 0; x < bitmap.Width; x++) {
            int offset = row + x * 4;
            if (pixels[offset + 3] == 0) continue;

            double blue = pixels[offset];
            double green = pixels[offset + 1];
            double red = pixels[offset + 2];
            double maximum = Math.Max(red, Math.Max(green, blue));
            double minimum = Math.Min(red, Math.Min(green, blue));
            if (maximum <= 0 || red <= green) continue;

            double saturation = (maximum - minimum) / maximum;
            double warmth = (red - blue) / maximum;
            double weight = Clamp((saturation - 0.08) / 0.35, 0, 1)
              * Clamp(warmth / 0.45, 0, 1);
            if (weight <= 0) continue;

            double hue = GetHue(red, green, blue);
            double value = maximum / 255.0;
            byte adjustedRed;
            byte adjustedGreen;
            byte adjustedBlue;
            HsvToRgb(
              hue + hueDelta * weight,
              saturation * (1 + (saturationFactor - 1) * weight),
              value * (1 + (valueFactor - 1) * weight),
              out adjustedRed,
              out adjustedGreen,
              out adjustedBlue
            );
            pixels[offset] = adjustedBlue;
            pixels[offset + 1] = adjustedGreen;
            pixels[offset + 2] = adjustedRed;
          }
        }
        Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    private static void MatchNeutralLuminance(Bitmap bitmap, double luminanceFactor) {
      Rectangle canvas = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
      BitmapData data = bitmap.LockBits(canvas, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      try {
        int stride = Math.Abs(data.Stride);
        byte[] pixels = new byte[stride * bitmap.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        for (int y = 0; y < bitmap.Height; y++) {
          int row = y * stride;
          for (int x = 0; x < bitmap.Width; x++) {
            int offset = row + x * 4;
            if (pixels[offset + 3] == 0) continue;

            double blue = pixels[offset];
            double green = pixels[offset + 1];
            double red = pixels[offset + 2];
            double maximum = Math.Max(red, Math.Max(green, blue));
            double minimum = Math.Min(red, Math.Min(green, blue));
            double saturation = maximum > 0 ? (maximum - minimum) / maximum : 0;
            double weight = Clamp((0.24 - saturation) / 0.12, 0, 1);
            if (weight <= 0) continue;

            double weightedFactor = 1 + (luminanceFactor - 1) * weight;
            pixels[offset] = (byte)Math.Round(Clamp(blue * weightedFactor, 0, 255));
            pixels[offset + 1] = (byte)Math.Round(Clamp(green * weightedFactor, 0, 255));
            pixels[offset + 2] = (byte)Math.Round(Clamp(red * weightedFactor, 0, 255));
          }
        }
        Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      } finally {
        bitmap.UnlockBits(data);
      }
    }

    public static WalkFrameReport Normalize(
      string sourcePath,
      string destinationPath,
      string frameName,
      int referenceBodySpan,
      double referenceBrownRed,
      double referenceBrownGreen,
      double referenceBrownBlue,
      double referenceWarmRed,
      double referenceWarmGreen,
      double referenceWarmBlue,
      double referenceWarmHue,
      double referenceWarmSaturation,
      double referenceWarmValue,
      double referenceNeutralLuminance,
      int bottomMargin,
      byte threshold
    ) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap source = CopyAsArgb(sourceFile)) {
        Metrics before = Measure(source, threshold);
        double horizontalScale = Clamp((double)referenceBodySpan / before.BodySpan, 0.90, 1.10);
        double targetCenterX = source.Width / 2.0;
        double targetBottom = source.Height - 1 - bottomMargin;

        using (Bitmap staged = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb)) {
          double destinationX = targetCenterX - before.TorsoCenterX * horizontalScale;
          double destinationY = targetBottom - (before.Bounds.Bottom - 1.0);
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
                (float)(source.Width * horizontalScale),
                source.Height
              ),
              new RectangleF(0, 0, source.Width, source.Height),
              GraphicsUnit.Pixel
            );
          }

          Metrics stagedMetrics = Measure(staged, threshold);
          int correctionX = (int)Math.Round(targetCenterX - stagedMetrics.TorsoCenterX);
          int correctionY = (int)Math.Round(targetBottom - (stagedMetrics.Bounds.Bottom - 1));
          using (Bitmap destination = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb)) {
            using (Graphics graphics = Graphics.FromImage(destination)) {
              graphics.CompositingMode = CompositingMode.SourceCopy;
              graphics.Clear(Color.Transparent);
              graphics.DrawImageUnscaled(staged, correctionX, correctionY);
            }

            Metrics colorMetrics = Measure(destination, threshold);
            for (int pass = 0; pass < 2; pass++) {
              MatchNeutralLuminance(
                destination,
                referenceNeutralLuminance / colorMetrics.NeutralLuminance
              );
              colorMetrics = Measure(destination, threshold);
            }
            MatchWarmFurHsv(
              destination,
              referenceWarmHue - colorMetrics.WarmHue,
              referenceWarmSaturation / colorMetrics.WarmSaturation,
              referenceWarmValue / colorMetrics.WarmValue
            );
            colorMetrics = Measure(destination, threshold);
            for (int pass = 0; pass < 2; pass++) {
              MatchNeutralLuminance(
                destination,
                referenceNeutralLuminance / colorMetrics.NeutralLuminance
              );
              colorMetrics = Measure(destination, threshold);
            }
            Metrics after = colorMetrics;
            if (after.Bounds.Left <= 0 || after.Bounds.Right >= destination.Width) {
              throw new InvalidOperationException("Horizontal padding is insufficient in " + sourcePath);
            }
            if (after.Bounds.Bottom - 1 != (int)targetBottom) {
              throw new InvalidOperationException("Ground baseline could not be preserved in " + sourcePath);
            }

            destination.Save(destinationPath, ImageFormat.Png);
            return new WalkFrameReport {
              Frame = frameName,
              AppliedHorizontalScale = horizontalScale,
              BodySpanBefore = before.BodySpan,
              BodySpanAfter = after.BodySpan,
              BrownRedBefore = before.BrownRed,
              BrownGreenBefore = before.BrownGreen,
              BrownBlueBefore = before.BrownBlue,
              BrownRedAfter = after.BrownRed,
              BrownGreenAfter = after.BrownGreen,
              BrownBlueAfter = after.BrownBlue,
              WarmRgbBefore = String.Format(
                "{0:F2},{1:F2},{2:F2}",
                before.WarmRed,
                before.WarmGreen,
                before.WarmBlue
              ),
              WarmRgbAfter = String.Format(
                "{0:F2},{1:F2},{2:F2}",
                after.WarmRed,
                after.WarmGreen,
                after.WarmBlue
              ),
              WarmHsvBefore = String.Format(
                "{0:F2},{1:F3},{2:F3}",
                before.WarmHue,
                before.WarmSaturation,
                before.WarmValue
              ),
              WarmHsvAfter = String.Format(
                "{0:F2},{1:F3},{2:F3}",
                after.WarmHue,
                after.WarmSaturation,
                after.WarmValue
              ),
              NeutralLuminanceBefore = before.NeutralLuminance,
              NeutralLuminanceAfter = after.NeutralLuminance,
              BoundsAfter = String.Format(
                "{0},{1}-{2},{3}",
                after.Bounds.Left,
                after.Bounds.Top,
                after.Bounds.Right - 1,
                after.Bounds.Bottom - 1
              ),
            };
          }
        }
      }
    }

    public static WalkFrameReport MatchColor(
      string sourcePath,
      string destinationPath,
      string frameName,
      double referenceWarmHue,
      double referenceWarmSaturation,
      double referenceWarmValue,
      double referenceNeutralLuminance,
      byte threshold
    ) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap destination = CopyAsArgb(sourceFile)) {
        Metrics before = Measure(destination, threshold);
        Metrics colorMetrics = before;
        for (int pass = 0; pass < 2; pass++) {
          MatchNeutralLuminance(
            destination,
            referenceNeutralLuminance / colorMetrics.NeutralLuminance
          );
          colorMetrics = Measure(destination, threshold);
        }
        MatchWarmFurHsv(
          destination,
          referenceWarmHue - colorMetrics.WarmHue,
          referenceWarmSaturation / colorMetrics.WarmSaturation,
          referenceWarmValue / colorMetrics.WarmValue
        );
        colorMetrics = Measure(destination, threshold);
        for (int pass = 0; pass < 2; pass++) {
          MatchNeutralLuminance(
            destination,
            referenceNeutralLuminance / colorMetrics.NeutralLuminance
          );
          colorMetrics = Measure(destination, threshold);
        }

        Metrics after = colorMetrics;
        destination.Save(destinationPath, ImageFormat.Png);
        return new WalkFrameReport {
          Frame = frameName,
          AppliedHorizontalScale = 1,
          BodySpanBefore = before.BodySpan,
          BodySpanAfter = after.BodySpan,
          BrownRedBefore = before.BrownRed,
          BrownGreenBefore = before.BrownGreen,
          BrownBlueBefore = before.BrownBlue,
          BrownRedAfter = after.BrownRed,
          BrownGreenAfter = after.BrownGreen,
          BrownBlueAfter = after.BrownBlue,
          WarmRgbBefore = String.Format(
            "{0:F2},{1:F2},{2:F2}",
            before.WarmRed,
            before.WarmGreen,
            before.WarmBlue
          ),
          WarmRgbAfter = String.Format(
            "{0:F2},{1:F2},{2:F2}",
            after.WarmRed,
            after.WarmGreen,
            after.WarmBlue
          ),
          WarmHsvBefore = String.Format(
            "{0:F2},{1:F3},{2:F3}",
            before.WarmHue,
            before.WarmSaturation,
            before.WarmValue
          ),
          WarmHsvAfter = String.Format(
            "{0:F2},{1:F3},{2:F3}",
            after.WarmHue,
            after.WarmSaturation,
            after.WarmValue
          ),
          NeutralLuminanceBefore = before.NeutralLuminance,
          NeutralLuminanceAfter = after.NeutralLuminance,
          BoundsAfter = String.Format(
            "{0},{1}-{2},{3}",
            after.Bounds.Left,
            after.Bounds.Top,
            after.Bounds.Right - 1,
            after.Bounds.Bottom - 1
          ),
        };
      }
    }

    public static double[] GetReference(string sourcePath, byte threshold) {
      using (Bitmap sourceFile = new Bitmap(sourcePath))
      using (Bitmap source = CopyAsArgb(sourceFile)) {
        Metrics metrics = Measure(source, threshold);
        return new double[] {
          metrics.BodySpan,
          metrics.BrownRed,
          metrics.BrownGreen,
          metrics.BrownBlue,
          metrics.WarmRed,
          metrics.WarmGreen,
          metrics.WarmBlue,
          metrics.NeutralLuminance,
          metrics.WarmHue,
          metrics.WarmSaturation,
          metrics.WarmValue,
        };
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

$geometryReference = [LattePet.WalkConsistencyNormalizer]::GetReference(
  $frames[0].FullName,
  [byte]$AlphaThreshold
)
$colorReference = if ([string]::IsNullOrWhiteSpace($ColorReferenceImage)) {
  $geometryReference
} else {
  $resolvedColorReference = (Resolve-Path -LiteralPath $ColorReferenceImage).Path
  [LattePet.WalkConsistencyNormalizer]::GetReference(
    $resolvedColorReference,
    [byte]$AlphaThreshold
  )
}
New-Item -ItemType Directory -Path $resolvedOutput | Out-Null

$report = foreach ($frame in $frames) {
  if ($ColorOnly) {
    [LattePet.WalkConsistencyNormalizer]::MatchColor(
      $frame.FullName,
      (Join-Path $resolvedOutput $frame.Name),
      $frame.Name,
      $colorReference[8],
      $colorReference[9],
      $colorReference[10],
      $colorReference[7],
      [byte]$AlphaThreshold
    )
  } else {
    [LattePet.WalkConsistencyNormalizer]::Normalize(
      $frame.FullName,
      (Join-Path $resolvedOutput $frame.Name),
      $frame.Name,
      [int]$geometryReference[0],
      $colorReference[1],
      $colorReference[2],
      $colorReference[3],
      $colorReference[4],
      $colorReference[5],
      $colorReference[6],
      $colorReference[8],
      $colorReference[9],
      $colorReference[10],
      $colorReference[7],
      $BottomMargin,
      [byte]$AlphaThreshold
    )
  }
}

$reportPath = Join-Path $resolvedOutput 'consistency-report.json'
$reportJson = $report | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
  $reportPath,
  $reportJson,
  [System.Text.UTF8Encoding]::new($false)
)
$report
