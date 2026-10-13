# Stretch v3 image-generation prompt set

Mode: built-in `imagegen`, transparent-background edit.

References for every generated midpoint:

1. `assets/latte/previews/latte-base-preview-v1.png` — sole identity, coat-color, sharpness, fur-detail, lighting, and semi-realistic style authority.
2. The preceding `frames-v2` stretch keyframe — pose reference only.
3. The following `frames-v2` stretch keyframe — pose reference only.

Prompt template:

> Create exactly one transparent-background animation frame for a desktop pet. Image 1 is the sole identity, color, fur-detail, sharpness, lighting, and semi-realistic illustration style authority for Latte, a small female brown-and-white dog. Images 2 and 3 are consecutive pose references only. Draw the exact halfway in-between pose from Image 2 to Image 3. Maintain a continuous play-bow motion: front paws stay identified and planted or slide continuously, elbows and chest lower and rise along a natural arc, hind legs remain supporting, and head, ears, shoulders, and curled tail follow without teleporting. Preserve Image 1's exact warm tan/brown and clean white fur colors, markings, face identity, body proportions, fine individual fur, crisp natural detail, and neutral saturation. Do not darken, recolor, blur, simplify, cartoonize, or add painterly texture. Full dog visible, centered with transparent padding and paw contact points aligned to one ground baseline. No shadow, floor, background, glow, text, props, clothing, extra limbs, or duplicated body parts. Output one isolated dog frame, not a grid or sprite sheet.

Four generated midpoints are inserted around the six approved keyframes, producing the final 10-frame action in `frames-v3`.
