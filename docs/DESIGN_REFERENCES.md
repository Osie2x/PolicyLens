# UI research and design rationale

References inspected during the build:

- [Linear product interface](https://linear.app/features): restrained navigation,
  precise spacing, quiet surfaces, and compact workspace hierarchy.
- [Perplexity Search](https://www.perplexity.ai/en-GB/hub/products/search): visible
  source citations and evidence access alongside answers.
- [Citation UX discussion](https://www.aiuxplayground.com/gallery/perplexity-citations/):
  citation chips and contextual verification.

PolicyLens uses an original sage/cream palette, a typographic question workspace,
source/evaluation/failure navigation, and a custom SVG evidence sphere. No logos,
paid templates, screenshots, or proprietary interface assets were copied.

The source inspector, unknown metadata values, explicit preview status, and benchmark
limits are product decisions: a reliability-oriented interface should expose the
information users need to check an answer.

Fonts are DM Sans and Manrope through Google Fonts, with local sans-serif fallbacks.
Icons use Lucide. Motion respects `prefers-reduced-motion`; interactive controls have
labels and keyboard focus states. Modals trap focus, restore the previous focus, and close with Escape. Expanded
screen-reader testing remains future work.
