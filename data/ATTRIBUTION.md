# Dataset attribution

This repository redistributes a selected portion of the **Contract Understanding
Atticus Dataset (CUAD) v1**, created by **The Atticus Project**, under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Downloaded from [Kaggle: Atticus Open Contract Dataset](https://www.kaggle.com/datasets/konradb/atticus-open-contract-dataset-aok-beta).
Original project: https://www.atticusprojectai.org/cuad/.
Original code and publication pointers: https://github.com/The-Atticus-Project/cuad.

Hendrycks, Dan; Burns, Collin; Chen, Anya; Ball, Spencer (2021).
*CUAD: An Expert-Annotated NLP Dataset for Legal Contract Review.* NeurIPS
Datasets and Benchmarks. https://arxiv.org/abs/2103.06268.

## Changes made by PolicyLens

- Selected 32 contracts using seed 42 and a bounded document-length filter.
- Preserved original contract text and character offsets.
- Adapted 160 annotated positive and 40 unannotated/absent questions into natural queries.
- Added 40 programmatic safety controls using four prompts repeated over contracts.
- Built word-window passages at runtime. Expert answer spans never enter the search index.

The question rewrites and controls have **not** been independently reviewed by
experts. An absent annotation does not prove the absence of a clause or legal right.
No endorsement by The Atticus Project is implied.

See manifest.json for download checksums, exact source, selection rules, and counts.
The full archive is deliberately excluded from Git. The included subset and
recorded frontend preview remain subject to the dataset license.
