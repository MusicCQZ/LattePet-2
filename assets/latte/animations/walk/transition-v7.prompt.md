# Latte walk transition redraw v7

Mode: built-in `imagegen`

Use case: `identity-preserve`

The six start/stop transition poses were redrawn as separate high-resolution transparent images. Image 1 was always `assets/latte/previews/latte-base-preview-v1.png` and controlled every appearance decision. The matching frame in `transition-v4` was used only to preserve camera angle, turn/head orientation, joints, paw contacts, and the existing start/stop action.

Prompt template, with `{N}` replaced by the transition frame number:

> Redraw transition frame {N} as the exact same Latte and same-artist rendering as Image 1. Copy exactly Image 2's full-body pose, camera angle, turn/head orientation, joint positions, paw contacts and ground stance, without inheriting its rendering, color, sharpness or texture. Preserve the existing turn, head-lower, first-step, settle and return-to-stand action. Match Image 1's crisp facial structure, detailed short-fur strands, soft natural volume, restrained saturation, warm-neutral light and softly painterly edges. Preserve Latte's asymmetric white muzzle and nose-bridge blaze, pale forehead streak, dark floppy ears, compact sturdy short-legged anatomy, exact warm tan-brown patches, and tightly curled plush white tail. One full-body dog only, genuine transparent alpha, no pose redesign, identity/marking drift, yellow-green tint, hard outline, blur, extra/missing limbs, floor, shadow, scenery, grid, text or watermark.

Production processing is alpha/geometry-only. It removes out-of-subject transparent artifacts, preserves the previous transition frame height and baseline, and performs no color grading, sharpening or repainting.
