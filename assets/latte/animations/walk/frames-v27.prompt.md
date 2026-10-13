# Latte walk redraw v27

Mode: built-in `imagegen`

Use case: `identity-preserve`

The sixteen production frames were generated as sixteen separate high-resolution transparent images. Every call used the same two-role input contract:

- Image 1: `assets/latte/previews/latte-base-preview-v1.png`, the sole locked master for identity, anatomy, face, proportions, markings, color, saturation, lighting, fur detail, painterly edges, and the established 70% believable-real / 30% gentle-Q rendering style.
- Image 2: the corresponding frame from `assets/latte/animations/walk/frames-v25/`, used only for pose, joint placement, paw contact, depth order, head height, body angle, and walk timing.

Prompt template, with `{N}` replaced by the frame number:

> Redraw walk frame {N} as the exact same Latte and same-artist rendering as Image 1. Copy only Image 2's exact full-body walking pose, joint positions, paw contact states, fixed near/far leg identities, and screen-right direction. Match Image 1's crisp detailed face, realistic individual short-fur strands, soft natural volume, warm-neutral light, low natural saturation, and softly painterly silhouette. Preserve the asymmetric white muzzle and nose-bridge blaze, narrow pale forehead streak, dark floppy ears, compact sturdy short-legged body, exact warm tan-brown shoulder/back and rump patches, and plush tightly curled white tail. One full-body dog only, strict side view, all four separate legs and paws visible, centered with a common ground baseline and genuine transparent alpha. Image 1 controls every appearance decision; Image 2 controls pose only. No color/style inheritance from Image 2, identity or marking drift, yellow-green tint, oversaturation, low-resolution look, hard outline, blur, extra or missing limbs, crop, floor, shadow, scenery, text, grid, or watermark.

Production processing after image generation is geometry/alpha-only: retain the largest connected dog silhouette, remove out-of-subject transparent artifacts, downsample with high-quality bicubic filtering, center on a 444×444 canvas, normalize the measured body span to 348 pixels, and set the shared ground baseline to y=439. No color grading, sharpening, repainting, or transparency blending is applied to the dog.
