# Sleep v3 image-generation prompt set

Mode: built-in `imagegen`, transparent-background edit.

References for every generated midpoint:

1. `assets/latte/previews/latte-base-preview-v1.png` — sole identity, coat-color, sharpness, fur-detail, lighting, and semi-realistic style authority.
2. The preceding `frames-v2` sleep keyframe — pose reference only.
3. The following `frames-v2` sleep keyframe — pose reference only.

Prompt template:

> Create exactly one transparent-background animation frame for a desktop pet. Image 1 is the sole identity, color, fur-detail, sharpness, lighting, and semi-realistic illustration style authority for Latte, a small female brown-and-white dog. Images 2 and 3 are consecutive sleep-pose references only. Draw the exact halfway in-between pose from Image 2 to Image 3. Latte remains curled on the floor with eyes closed; interpolate the ribcage, shoulders, muzzle, paws, and ear position through the gentle breathing motion. For the final-to-first midpoint, create a seamless loop-closing halfway pose. Preserve Image 1's exact warm tan/brown and clean white fur colors, markings, face identity, body proportions, fine individual fur, crisp natural detail, and neutral saturation. Do not darken, recolor, blur, simplify, cartoonize, or add painterly texture. Keep the same left-facing side/three-quarter camera angle. Full dog visible, centered with generous transparent padding and body contact aligned to one ground baseline. No shadow, floor, background, glow, text, props, clothing, extra limbs, or duplicated body parts. Output one isolated dog frame, not a grid or sprite sheet.

Generated midpoints are placed between the four approved keyframes, producing the final 8-frame loop in `frames-v3`.
